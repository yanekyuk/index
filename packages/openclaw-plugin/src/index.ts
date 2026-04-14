/**
 * Index Network — OpenClaw plugin entry point.
 *
 * Polls the Index Network backend for pending negotiation turns via:
 *
 *   POST /agents/:agentId/negotiations/pickup
 *
 * Because `api.runtime.subagent.run()` is request-scoped in OpenClaw (only
 * available inside an HTTP route handler), the plugin registers a route at
 * `POST /index-network/poll` and the background interval triggers it via a
 * local fetch. This gives each poll cycle a proper request scope.
 *
 * When a turn is found, dispatches a silent subagent that calls
 * `get_negotiation` + `respond_to_negotiation` on the parent's Index Network
 * MCP pool to decide and submit the response.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { OpenClawPluginApi } from './plugin-api.js';
import { turnPrompt } from './prompts/turn.prompt.js';

/** Base polling interval: 30 seconds. */
const POLL_INTERVAL_MS = 30_000;

/** Max backoff multiplier (caps at ~8 minutes). */
const MAX_BACKOFF_MULTIPLIER = 16;

const POLL_PATH = '/index-network/poll';

/** Tracks in-flight turns so we don't re-launch subagents for already-claimed work. */
const inflight = new Set<string>();

/** Prevents double-registration when OpenClaw calls register() more than once. */
let registered = false;

/** Current backoff multiplier — increases on consecutive failures, resets on success. */
let backoffMultiplier = 1;

/** Handle returned by setInterval, stored so tests can inspect or clear it. */
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * OpenClaw plugin entry point. Registers an internal HTTP route for polling
 * and starts a background interval that triggers it.
 *
 * @param api - The OpenClaw plugin API provided by the host.
 */
export default function register(api: OpenClawPluginApi): void {
  if (registered) {
    api.logger.debug('Index Network plugin already registered, skipping duplicate call.');
    return;
  }
  registered = true;

  const agentId = readConfig(api, 'agentId');
  const apiKey = readConfig(api, 'apiKey');

  if (!agentId || !apiKey) {
    api.logger.warn(
      'Index Network polling requires agentId and apiKey in plugin config. Polling will not start.',
    );
    return;
  }

  const baseUrl = readConfig(api, 'protocolUrl') || 'http://localhost:3001';
  const gatewayPort = process.env.OPENCLAW_GATEWAY_PORT || '18789';
  const gatewayToken = readGatewayToken();

  // Route MUST use auth: 'gateway' (not 'plugin') — subagent.run() requires
  // operator.write scope, which only gateway-authed routes receive.
  api.registerHttpRoute({
    path: POLL_PATH,
    auth: 'gateway',
    match: 'exact',
    handler: async (req, res) => {
      try {
        await poll(api, baseUrl, agentId, apiKey);
        res.statusCode = 200;
        res.end('ok');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api.logger.error(`Poll handler error: ${msg}`);
        res.statusCode = 500;
        res.end(msg);
      }
      return true;
    },
  });

  api.logger.info('Index Network polling started', {
    plugin: api.id,
    agentId,
    intervalMs: POLL_INTERVAL_MS,
  });

  // Trigger polling via self-POST to the registered route
  const triggerPoll = () => {
    const url = `http://127.0.0.1:${gatewayPort}${POLL_PATH}`;
    fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
      },
      signal: AbortSignal.timeout(30_000),
    }).catch((err) => {
      api.logger.error(`Poll trigger failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  // Schedule polling with dynamic backoff
  const scheduleNext = () => {
    const delay = POLL_INTERVAL_MS * backoffMultiplier;
    pollTimer = setTimeout(() => {
      triggerPoll();
      scheduleNext();
    }, delay);
  };

  scheduleNext();

  // First poll after a short delay to let the gateway fully start.
  // This initial poll also runs a reachability check on the backend.
  setTimeout(() => {
    checkBackendReachability(api, baseUrl);
    triggerPoll();
  }, 5_000);
}

async function poll(
  api: OpenClawPluginApi,
  baseUrl: string,
  agentId: string,
  apiKey: string,
): Promise<void> {
  const negotiationMode = readConfig(api, 'negotiationMode') || 'enabled';
  if (negotiationMode === 'disabled') return;

  const pickupUrl = `${baseUrl}/api/agents/${agentId}/negotiations/pickup`;

  const res = await fetch(pickupUrl, {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 204) {
    // Nothing pending — reset backoff on successful communication
    backoffMultiplier = 1;
    return;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    api.logger.warn(`Pickup request failed: ${res.status} ${body}`);
    increaseBackoff(api);
    return;
  }

  // Successful pickup — reset backoff
  backoffMultiplier = 1;

  const turn = (await res.json()) as {
    negotiationId: string;
    taskId: string;
    opportunity: { id: string; reasoning: string } | null;
    turn: {
      number: number;
      deadline: string;
      history: Array<{ turnNumber: number; agent: string; action: string; message?: string | null }>;
      counterpartyAction: string;
    };
    context: import('./prompts/turn.prompt.js').TurnContext | null;
  };

  const inflightKey = `${turn.taskId}:${turn.turn.number}`;
  if (inflight.has(inflightKey)) {
    api.logger.debug(`Turn ${inflightKey} already in-flight, skipping.`);
    return;
  }
  inflight.add(inflightKey);

  api.logger.info(`Negotiation turn picked up: ${turn.taskId} turn ${turn.turn.number}`);

  const lastEntry = turn.turn.history.length > 0
    ? turn.turn.history[turn.turn.history.length - 1]
    : null;

  try {
    await api.runtime.subagent.run({
      sessionKey: `index:negotiation:${turn.negotiationId}`,
      idempotencyKey: `index:turn:${turn.taskId}:${turn.turn.number}`,
      message: turnPrompt({
        negotiationId: turn.taskId,
        turnNumber: turn.turn.number,
        counterpartyAction: turn.turn.counterpartyAction,
        counterpartyMessage: lastEntry?.message ?? null,
        deadline: turn.turn.deadline,
        context: turn.context,
      }),
      deliver: false,
    });
    api.logger.info(`Subagent launched for negotiation ${turn.taskId}`);
  } catch (err) {
    // Remove from in-flight so it can be retried on the next poll
    inflight.delete(inflightKey);
    increaseBackoff(api);
    throw err;
  }
}

function increaseBackoff(api: OpenClawPluginApi): void {
  if (backoffMultiplier < MAX_BACKOFF_MULTIPLIER) {
    backoffMultiplier = Math.min(backoffMultiplier * 2, MAX_BACKOFF_MULTIPLIER);
    api.logger.info(
      `Backing off — next poll in ${(POLL_INTERVAL_MS * backoffMultiplier / 1000).toFixed(0)}s`,
    );
  }
}

/**
 * One-time startup check: verifies the backend is reachable. Logs an
 * actionable warning if it isn't, so users catch misconfigurations early.
 */
function checkBackendReachability(api: OpenClawPluginApi, baseUrl: string): void {
  fetch(`${baseUrl}/api/health`, {
    method: 'GET',
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {
    api.logger.warn(
      `Cannot reach Index Network backend at ${baseUrl}. ` +
      `Check that the backend is running and protocolUrl is correct in plugin config.`,
    );
  });
}

function readConfig(api: OpenClawPluginApi, key: string): string {
  const val = api.pluginConfig[key];
  return typeof val === 'string' ? val : '';
}

function readGatewayToken(): string {
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const configPath = path.join(process.env.HOME || '', '.openclaw', 'openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return config?.gateway?.auth?.token ?? '';
  } catch {
    return '';
  }
}

/**
 * Reset module-level state. Exposed for tests only — not part of public API.
 * @internal
 */
export function _resetForTesting(): void {
  registered = false;
  backoffMultiplier = 1;
  inflight.clear();
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}
