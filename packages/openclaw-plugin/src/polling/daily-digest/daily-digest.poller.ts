import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { readModel } from '../../lib/openclaw/plugin-api.js';
import { isDeliveryConfigured, dispatchDelivery, EVALUATOR_TIMEOUT_MS } from '../../lib/delivery/delivery.dispatcher.js';
import { extractSelectedIds, confirmDeliveredBatch } from '../../lib/delivery/post-delivery-confirm.js';
import { hashOpportunityBatch } from '../../lib/utils/hash.js';
import { digestEvaluatorPrompt } from './digest-evaluator.prompt.js';

/** Startup nonce — prevents idempotency collisions across gateway restarts. */
const startupNonce = Date.now().toString(36);

export interface DailyDigestConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  frontendUrl: string;
  maxCount: number;
}

/**
 * Handles one daily digest cycle using a three-phase pipeline:
 *
 * Phase 1 — Evaluator subagent (deliver: false, date-scoped session):
 *   Ranks candidates by value, outputs plain content with selected opportunity
 *   IDs. Session key includes date so each day starts fresh.
 *
 * Phase 2 — Delivery (via dispatchDelivery):
 *   Captures evaluator output via waitForRun + getSessionMessages, then
 *   dispatches it through the delivery dispatcher which applies channel styling.
 *   Waits for delivery to complete before proceeding.
 *
 * Phase 3 — Confirm (direct HTTP):
 *   After delivery succeeds, extracts selected opportunity IDs from the
 *   evaluator output and confirms them via the batch-confirm backend endpoint.
 *
 * @returns `true` if a digest was dispatched, `false` otherwise.
 */
export async function handle(
  api: OpenClawPluginApi,
  config: DailyDigestConfig,
): Promise<boolean> {
  const pendingUrl = `${config.baseUrl}/api/agents/${config.agentId}/opportunities/pending`;

  let res: Response;
  try {
    res = await fetch(pendingUrl, {
      method: 'GET',
      headers: { 'x-api-key': config.apiKey },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    api.logger.warn(
      `Daily digest fetch errored: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    api.logger.warn(`Daily digest fetch failed: ${res.status} ${text}`);
    return false;
  }

  const body = (await res.json()) as {
    opportunities: Array<{
      opportunityId: string;
      counterpartUserId: string | null;
      rendered: {
        headline: string;
        personalizedSummary: string;
        suggestedAction: string;
        narratorRemark: string;
      };
    }>;
  };

  if (!body.opportunities.length) {
    api.logger.info('Daily digest: no pending opportunities');
    return false;
  }

  // Fail fast before running the evaluator if delivery is not configured.
  if (!isDeliveryConfigured(api)) {
    api.logger.warn(
      'Daily digest: delivery routing not configured — skipping. ' +
        'Set pluginConfig.deliveryChannel and pluginConfig.deliveryTarget.',
    );
    return false;
  }

  const effectiveMax = Math.min(config.maxCount, body.opportunities.length);
  const batchHash = hashOpportunityBatch(body.opportunities.map((o) => o.opportunityId));
  const dateStr = new Date().toISOString().slice(0, 10);
  const model = await readModel(api);

  // Date-scoped session key — each day starts a fresh session with no carryover.
  const evaluatorSessionKey = `index:daily-digest:${config.agentId}:${dateStr}`;

  // Phase 1: run evaluator silently.
  api.logger.info(`Daily digest eval: sessionKey=${evaluatorSessionKey} batchHash=${batchHash} nonce=${startupNonce}`);
  let runId: string;
  try {
    const evalResult = await api.runtime.subagent.run({
      sessionKey: evaluatorSessionKey,
      idempotencyKey: `index:eval:daily-digest:${config.agentId}:${dateStr}:${batchHash}:${startupNonce}`,
      message: digestEvaluatorPrompt(
        body.opportunities
          .filter((o): o is typeof o & { counterpartUserId: string } => o.counterpartUserId !== null)
          .map((o) => ({
            opportunityId: o.opportunityId,
            userId: o.counterpartUserId,
            headline: o.rendered.headline,
            personalizedSummary: o.rendered.personalizedSummary,
            suggestedAction: o.rendered.suggestedAction,
            narratorRemark: o.rendered.narratorRemark,
            profileUrl: `${config.frontendUrl}/u/${o.counterpartUserId}`,
            acceptUrl: `${config.frontendUrl}/opportunities/${o.opportunityId}/accept`,
            skipUrl: `${config.frontendUrl}/opportunities/${o.opportunityId}/skip`,
          })),
        effectiveMax,
      ),
      deliver: false,
      model,
    });
    runId = evalResult.runId;
    api.logger.info(`Daily digest eval dispatched: runId=${runId}`);
  } catch (err) {
    api.logger.warn(
      `Daily digest evaluator dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  // Wait for the evaluator to finish.
  try {
    api.logger.info(`Daily digest eval waiting: runId=${runId}`);
    await api.runtime.subagent.waitForRun({ runId, timeoutMs: EVALUATOR_TIMEOUT_MS });
    api.logger.info(`Daily digest eval completed: runId=${runId}`);
  } catch (err) {
    api.logger.warn(
      `Daily digest evaluator timed out or failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  // Capture evaluator output — the last assistant message in the session.
  let content: string;
  try {
    const { messages } = await api.runtime.subagent.getSessionMessages({
      sessionKey: evaluatorSessionKey,
      limit: 10,
    });
    const rawContent = messages.filter((m) => m.role === 'assistant').at(-1)?.content ?? '';
    content = extractTextContent(rawContent);
    api.logger.info(`Daily digest eval session: ${messages.length} msgs, content length=${content.length}`);
  } catch (err) {
    api.logger.warn(
      `Daily digest session read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  if (!content) {
    api.logger.debug('Daily digest evaluator produced no output — skipping delivery.');
    return false;
  }

  // Phase 2: dispatch to user via delivery dispatcher.
  // Idempotency key uses the eval runId so a new eval run busts the cache.
  const dispatchResult = await dispatchDelivery(api, {
    contentType: 'daily_digest',
    content,
    idempotencyKey: `index:delivery:daily-digest:${config.agentId}:${dateStr}:${runId}`,
  });

  if (dispatchResult === null) {
    return false;
  }

  // Wait for delivery to complete before confirming.
  try {
    await api.runtime.subagent.waitForRun({
      runId: dispatchResult.runId,
      timeoutMs: EVALUATOR_TIMEOUT_MS,
    });
  } catch (err) {
    api.logger.warn(
      `Daily digest delivery timed out or failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  api.logger.info(
    `Daily digest dispatched: ${body.opportunities.length} candidate(s), max ${effectiveMax} delivered`,
    { agentId: config.agentId },
  );

  // Phase 3: confirm selected opportunities after successful delivery.
  const batchIds = body.opportunities.map((o) => o.opportunityId);
  const selectedIds = extractSelectedIds(content, batchIds);
  await confirmDeliveredBatch({
    baseUrl: config.baseUrl,
    agentId: config.agentId,
    apiKey: config.apiKey,
    opportunityIds: selectedIds,
    logger: api.logger,
  });

  return true;
}

/**
 * Extracts plain text from a session message content field.
 * OpenClaw may return structured content blocks (`[{type:"text", text:"..."}]`)
 * or a plain string. This normalises both to a trimmed string.
 */
function extractTextContent(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw
      .filter((b: { type?: string }) => b?.type === 'text')
      .map((b: { text?: string }) => b?.text ?? '')
      .join('\n')
      .trim();
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return extractTextContent(parsed);
    } catch {
      // Not JSON — treat as plain text.
    }
    return trimmed;
  }
  return '';
}
