/**
 * Index Network — OpenClaw plugin entry point.
 *
 * Registers a single plugin-authed HTTP route on the OpenClaw gateway:
 *
 *   POST /index-network/webhook
 *
 * Index Network's agent registry creates one agent with at most one webhook
 * transport that subscribes to multiple event types. The plugin therefore
 * exposes one URL and dispatches internally by reading the `X-Index-Event`
 * header:
 *
 *   - negotiation.turn_received  → silent subagent (deliver: false) runs the
 *                                  turn handler prompt. The subagent calls
 *                                  `get_negotiation` + `respond_to_negotiation`
 *                                  on the parent's Index Network MCP pool.
 *   - negotiation.completed      → if outcome.hasOpportunity is true, a
 *                                  delivered subagent (deliver: true) posts
 *                                  one short message to the user's last
 *                                  active channel. Non-accepted outcomes are
 *                                  ACKed silently.
 *
 * HMAC verification uses the shared secret from
 * `plugins.entries.indexnetwork-openclaw-plugin.config.webhookSecret`,
 * stored by the bootstrap skill.
 *
 * The subagent inherits the parent OpenClaw instance's MCP connection to
 * the Index Network MCP server, so it can call `get_negotiation`,
 * `read_user_profiles`, `read_intents`, and `respond_to_negotiation` on
 * behalf of the user without re-authenticating.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { OpenClawPluginApi } from './plugin-api.js';
import { turnPrompt } from './prompts/turn.prompt.js';
import { acceptedPrompt } from './prompts/accepted.prompt.js';
import type {
  NegotiationCompletedPayload,
  NegotiationTurnReceivedPayload,
} from './webhook/types.js';
import { verifyAndParse } from './webhook/verify.js';

const WEBHOOK_PATH = '/index-network/webhook';
const TURN_EVENT = 'negotiation.turn_received';
const COMPLETED_EVENT = 'negotiation.completed';

/**
 * OpenClaw plugin entry point. Registers a single plugin-authed HTTP route
 * (`POST /index-network/webhook`) that dispatches inbound Index Network
 * events to the turn or completed handler based on the `x-index-event`
 * header. Reads `webhookSecret` and `negotiationMode` from `api.pluginConfig`
 * on every request so that rotating the secret via
 * `openclaw config set` takes effect without a plugin reload. Logs a warning
 * at registration time if the secret is missing so operators notice before
 * live traffic arrives; inbound webhooks are still rejected until one is set.
 *
 * @param api - The OpenClaw plugin API provided by the host. `pluginConfig`,
 *   `logger`, `runtime.subagent.run`, and `registerHttpRoute` are used.
 * @returns Nothing. The side effect is the registered HTTP route.
 */
export default function register(api: OpenClawPluginApi): void {
  if (!readSecret(api)) {
    api.logger.warn(
      'Index Network webhook secret is not configured — all inbound webhooks will be rejected until bootstrap completes.',
      { plugin: api.id },
    );
  }

  api.registerHttpRoute({
    path: WEBHOOK_PATH,
    auth: 'plugin',
    match: 'exact',
    // Read secret and negotiationMode on every request so that rotating
    // webhookSecret via `openclaw config set` takes effect without a
    // plugin reload. Caching at register time silently breaks rotation.
    handler: async (req, res) => {
      const eventHeader = readHeader(req.headers['x-index-event']);
      const secret = readSecret(api);
      const negotiationMode = readNegotiationMode(api);

      if (eventHeader === TURN_EVENT) {
        return handleTurn(api, req, res, secret, negotiationMode);
      }
      if (eventHeader === COMPLETED_EVENT) {
        return handleCompleted(api, req, res, secret);
      }
      return badRequest(res);
    },
  });
}

function readSecret(api: OpenClawPluginApi): string {
  return typeof api.pluginConfig.webhookSecret === 'string'
    ? api.pluginConfig.webhookSecret
    : '';
}

function readNegotiationMode(api: OpenClawPluginApi): string {
  return typeof api.pluginConfig.negotiationMode === 'string'
    ? api.pluginConfig.negotiationMode
    : 'enabled';
}

async function handleTurn(
  api: OpenClawPluginApi,
  req: IncomingMessage,
  res: ServerResponse,
  secret: string,
  negotiationMode: string,
): Promise<boolean> {
  const payload = await verifyAndParse<NegotiationTurnReceivedPayload>(
    req,
    secret,
    TURN_EVENT,
  );
  if (!payload) return reject(res);

  if (negotiationMode === 'disabled') {
    return accept(res);
  }

  try {
    await api.runtime.subagent.run({
      sessionKey: `index:negotiation:${payload.negotiationId}`,
      message: turnPrompt(payload),
      deliver: false,
    });
  } catch (err) {
    api.logger.error('Failed to launch turn subagent', {
      plugin: api.id,
      negotiationId: payload.negotiationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail(res);
  }

  return accept(res);
}

async function handleCompleted(
  api: OpenClawPluginApi,
  req: IncomingMessage,
  res: ServerResponse,
  secret: string,
): Promise<boolean> {
  const payload = await verifyAndParse<NegotiationCompletedPayload>(
    req,
    secret,
    COMPLETED_EVENT,
  );
  if (!payload) return reject(res);

  if (payload.outcome?.hasOpportunity !== true) {
    return accept(res);
  }

  try {
    await api.runtime.subagent.run({
      sessionKey: `index:event:${payload.negotiationId}`,
      message: acceptedPrompt(payload),
      deliver: true,
    });
  } catch (err) {
    api.logger.error('Failed to launch accepted subagent', {
      plugin: api.id,
      negotiationId: payload.negotiationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail(res);
  }

  return accept(res);
}

function readHeader(raw: string | string[] | undefined): string | null {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0] ?? null;
  return null;
}

function accept(res: ServerResponse): boolean {
  res.statusCode = 202;
  res.end('accepted');
  return true;
}

function reject(res: ServerResponse): boolean {
  res.statusCode = 401;
  res.end('invalid signature');
  return true;
}

function badRequest(res: ServerResponse): boolean {
  res.statusCode = 400;
  res.end('unknown or missing x-index-event header');
  return true;
}

function fail(res: ServerResponse): boolean {
  res.statusCode = 500;
  res.end('internal error');
  return true;
}
