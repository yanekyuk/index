/**
 * Drives the user's main OpenClaw agent to render a notification, returning
 * the rendered text and whether the agent suppressed delivery via NO_REPLY.
 *
 * Tries the in-process SDK first (`api.runtime.agent.runEmbeddedAgent`) and
 * falls back to the gateway HTTP hook (`POST /hooks/agent`) when the SDK
 * isn't available or the call rejects. Both paths produce the same return
 * shape so callers can stay primitive-agnostic.
 */

import type { OpenClawPluginApi } from '../openclaw/plugin-api.js';

/** Context required to dispatch a prompt to the main agent. */
export interface DispatchContext {
  prompt: string;
  idempotencyKey: string;
  /**
   * When true the prompt's caller has included a NO_REPLY clause; the helper
   * still inspects every reply for the token. When false the caller should
   * not have included the clause (used for test-message verification).
   */
  allowSuppress: boolean;
  /** Optional override for the embedded-agent timeout (ms). */
  timeoutMs?: number;
}

/** Result returned by `dispatchToMainAgent`. */
export interface DispatchResult {
  /** Rendered reply, or `null` when both paths failed. */
  deliveredText: string | null;
  /**
   * True when the agent's reply began with a NO_REPLY token, or was empty.
   * The caller MUST skip Phase 3 confirms when this is true.
   */
  suppressedByNoReply: boolean;
  /**
   * `'network_error'` when both SDK and hooks failed, used by callers to
   * signal scheduler backoff. Undefined on success or suppression.
   */
  error?: 'network_error';
}

const NO_REPLY_PATTERN = /^NO[_\s-]?REPLY\.?\s*$/i;

/**
 * Returns true when the agent reply is exactly the NO_REPLY token (case-
 * insensitive, surrounding whitespace and an optional trailing period
 * tolerated). Empty or nullish input returns false — empty replies are
 * handled separately as implicit suppression.
 *
 * The whole-string anchor avoids false positives on legitimate replies that
 * happen to start with "no reply" (e.g. "No reply yet from Bob — but...").
 *
 * @param text - Raw reply text from the agent, or null/undefined.
 */
export function detectNoReply(text: string | null | undefined): boolean {
  if (!text) return false;
  return NO_REPLY_PATTERN.test(text.trim());
}

/**
 * Sends `ctx.prompt` to the user's main agent and returns the rendered reply.
 *
 * Tries `api.runtime.agent.runEmbeddedAgent` first; on throw or when the
 * runtime is unavailable, falls back to `POST /hooks/agent` over loopback.
 * When both paths fail, returns `{ deliveredText: null, error: 'network_error' }`.
 *
 * @param api - OpenClaw plugin API instance.
 * @param ctx - Dispatch context carrying the prompt and idempotency key.
 * @returns A `DispatchResult` with `deliveredText` and `suppressedByNoReply`.
 */
export async function dispatchToMainAgent(
  api: OpenClawPluginApi,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  const sdkResult = await trySdk(api, ctx);
  if (sdkResult.outcome === 'ok') return sdkResult.value;

  const hooksResult = await tryHooks(api, ctx);
  if (hooksResult.outcome === 'ok') return hooksResult.value;

  api.logger.warn('Main-agent dispatch failed via both SDK and hooks.');
  return { deliveredText: null, suppressedByNoReply: false, error: 'network_error' };
}

type Outcome<T> = { outcome: 'ok'; value: T } | { outcome: 'unavailable' | 'error' };

async function trySdk(
  api: OpenClawPluginApi,
  ctx: DispatchContext,
): Promise<Outcome<DispatchResult>> {
  const agent = api.runtime.agent;
  if (!agent || typeof agent.runEmbeddedAgent !== 'function') {
    return { outcome: 'unavailable' };
  }
  try {
    const identity = agent.resolveAgentIdentity(api.config);
    const sessionId = identity.sessionId ?? identity.id ?? 'main';
    const agentDir = agent.resolveAgentDir(api.config).replace(/\/$/, '');
    const sessionFile = `${agentDir}/sessions/${sessionId}.jsonl`;
    const workspaceDir = agent.resolveAgentWorkspaceDir(api.config);
    const timeoutMs = ctx.timeoutMs ?? agent.resolveAgentTimeoutMs(api.config);

    const result = await agent.runEmbeddedAgent({
      sessionId,
      runId: ctx.idempotencyKey,
      sessionFile,
      workspaceDir,
      prompt: ctx.prompt,
      timeoutMs,
    });

    const text = extractReplyText(result);
    return { outcome: 'ok', value: shapeResult(text) };
  } catch (err) {
    api.logger.info(
      `runEmbeddedAgent unavailable or threw: ${err instanceof Error ? err.message : String(err)} — falling back to /hooks/agent.`,
    );
    return { outcome: 'error' };
  }
}

async function tryHooks(
  api: OpenClawPluginApi,
  ctx: DispatchContext,
): Promise<Outcome<DispatchResult>> {
  const port = api.config?.gateway?.port;
  const token = api.config?.gateway?.auth?.token;
  if (!port) {
    api.logger.warn('Cannot fall back to /hooks/agent: gateway port not in config.');
    return { outcome: 'unavailable' };
  }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/hooks/agent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'idempotency-key': ctx.idempotencyKey,
      },
      body: JSON.stringify({
        message: ctx.prompt,
        agentId: 'main',
        wakeMode: 'now',
        deliver: true,
        channel: 'last',
      }),
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120_000),
    });

    if (!res.ok) {
      api.logger.warn(`/hooks/agent returned ${res.status}.`);
      return { outcome: 'error' };
    }

    const body = (await res.json().catch(() => ({}))) as { text?: string };
    const text = typeof body?.text === 'string' ? body.text : '';
    return { outcome: 'ok', value: shapeResult(text) };
  } catch (err) {
    api.logger.warn(
      `/hooks/agent threw: ${err instanceof Error ? err.message : String(err)}.`,
    );
    return { outcome: 'error' };
  }
}

function extractReplyText(result: {
  text?: string;
  messages?: Array<{ role: string; content: unknown }>;
}): string {
  if (typeof result.text === 'string') return result.text;
  const last = result.messages?.filter((m) => m.role === 'assistant').at(-1);
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  if (Array.isArray(last.content)) {
    return (last.content as Array<{ type?: string; text?: string }>)
      .filter((b) => b?.type === 'text')
      .map((b) => b?.text ?? '')
      .join('\n')
      .trim();
  }
  return '';
}

function shapeResult(rawText: string): DispatchResult {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { deliveredText: '', suppressedByNoReply: true };
  }
  if (detectNoReply(trimmed)) {
    return { deliveredText: trimmed, suppressedByNoReply: true };
  }
  return { deliveredText: trimmed, suppressedByNoReply: false };
}
