/**
 * Dispatches a render prompt to the user's main OpenClaw agent via the
 * gateway's `POST /hooks/agent` endpoint. The endpoint is documented at
 * https://github.com/openclaw/openclaw/blob/main/docs/gateway/configuration-reference.md
 *
 * The hook performs three things synchronously from the plugin's view:
 *  - Routes the prompt to the user's default agent (the one they actually
 *    chat with), so persona / voice / channel preferences carry through.
 *  - Runs an isolated turn against the user's main session.
 *  - Delivers the agent's reply to whichever channel the user last used
 *    (`channel: 'last'`).
 *
 * Required gateway config (bootstrapped by `openclaw index-network setup`):
 *  - `hooks.enabled = true`
 *  - `hooks.token`   = a non-empty secret distinct from `gateway.auth.token`
 *  - `hooks.path`    = a sub-path, defaulting to `/hooks`
 *
 * The endpoint returns only `{ status: "sent" }` — the agent's rendered
 * text is delivered to the channel asynchronously and is not available
 * to the plugin synchronously. Callers therefore cannot scrape rendered
 * text; the `confirm-batch` step uses the full set of dispatched IDs.
 */

import type { OpenClawPluginApi } from '../openclaw/plugin-api.js';

/** Context required to dispatch a prompt to the main agent. */
export interface DispatchContext {
  /** The fully-rendered prompt to hand to the agent. */
  prompt: string;
  /** Idempotency key sent as the `idempotency-key` header. */
  idempotencyKey: string;
  /** Optional per-call timeout. Defaults to 120 seconds. */
  timeoutMs?: number;
}

/** Outcome of `dispatchToMainAgent`. */
export interface DispatchResult {
  /** True when the gateway acknowledged the dispatch (HTTP 2xx). */
  delivered: boolean;
  /**
   * Set when delivery failed in a way callers should react to:
   *  - `config_error`: missing gateway port or hooks.token → setup not run.
   *  - `unauthorized`: hooks.token rejected (401/403) → token mismatch.
   *  - `network_error`: any other failure (5xx, fetch threw, parse).
   */
  error?: 'config_error' | 'unauthorized' | 'network_error';
}

/**
 * Dispatches `ctx.prompt` to the user's main OpenClaw agent via
 * `POST /hooks/agent` with `deliver: true, channel: 'last'`. The gateway
 * routes the agent's reply to the channel the user last interacted with.
 *
 * @param api - Plugin API. Reads `api.config.gateway.port` and `api.config.hooks.{enabled,token,path}`.
 * @param ctx - Prompt + idempotency key + optional timeout.
 * @returns A `DispatchResult`. On `error`, `delivered` is `false`.
 */
export async function dispatchToMainAgent(
  api: OpenClawPluginApi,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  const port = api.config?.gateway?.port;
  const hooks = api.config?.hooks;
  const hooksEnabled = hooks?.enabled === true;
  const hooksToken = typeof hooks?.token === 'string' ? hooks.token : '';
  const hooksPath = (typeof hooks?.path === 'string' && hooks.path
    ? hooks.path
    : '/hooks'
  ).replace(/\/+$/, '');

  if (!port) {
    api.logger.warn(
      'Cannot dispatch to main agent: gateway.port is missing from api.config.',
    );
    return { delivered: false, error: 'config_error' };
  }
  if (!hooksEnabled || !hooksToken) {
    api.logger.warn(
      'Cannot dispatch to main agent: hooks.enabled=false or hooks.token unset. ' +
        'Run `openclaw index-network setup` to bootstrap hooks.',
    );
    return { delivered: false, error: 'config_error' };
  }

  const url = `http://127.0.0.1:${port}${hooksPath}/agent`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${hooksToken}`,
        'idempotency-key': ctx.idempotencyKey,
      },
      body: JSON.stringify({
        message: ctx.prompt,
        wakeMode: 'now',
        deliver: true,
        channel: 'last',
      }),
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120_000),
    });
  } catch (err) {
    api.logger.warn(
      `${url} threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { delivered: false, error: 'network_error' };
  }

  if (res.status === 401 || res.status === 403) {
    api.logger.warn(
      `${url} returned ${res.status}: hooks.token rejected. ` +
        'Verify hooks.token in ~/.openclaw/openclaw.json matches what the plugin reads.',
    );
    return { delivered: false, error: 'unauthorized' };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    api.logger.warn(`${url} returned ${res.status}: ${body.slice(0, 200)}`);
    return { delivered: false, error: 'network_error' };
  }

  return { delivered: true };
}
