import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { readModel } from '../../lib/openclaw/plugin-api.js';
import { isDeliveryConfigured, dispatchDelivery, EVALUATOR_TIMEOUT_MS } from '../../lib/delivery/delivery.dispatcher.js';
import { extractSelectedIds, confirmDeliveredBatch } from '../../lib/delivery/post-delivery-confirm.js';
import { hashOpportunityBatch } from '../../lib/utils/hash.js';
import { opportunityEvaluatorPrompt } from './opportunity-evaluator.prompt.js';

/** Hash of the last opportunity batch dispatched. Used to skip unchanged batches. */
let lastOpportunityBatchHash: string | null = null;

/** Startup nonce — prevents idempotency collisions across gateway restarts. */
const startupNonce = Date.now().toString(36);

export interface AmbientDiscoveryConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  frontendUrl: string;
}

/**
 * Handles one ambient discovery poll cycle using a three-phase pipeline:
 *
 * Phase 1 — Evaluator subagent (deliver: false, own session):
 *   Evaluates candidates, selects high-value ones, and outputs plain content.
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
 * @param api - The OpenClaw plugin API instance.
 * @param config - Configuration for the ambient discovery poller.
 * @returns `true` if delivery was dispatched, `false` otherwise.
 */
export async function handle(
  api: OpenClawPluginApi,
  config: AmbientDiscoveryConfig,
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
      `Opportunity pending fetch errored: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    api.logger.warn(`Opportunity pending fetch failed: ${res.status} ${text}`);
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
    return false;
  }

  // Fail fast before running the evaluator if delivery is not configured.
  if (!isDeliveryConfigured(api)) {
    api.logger.warn(
      'Index Network delivery routing not configured — skipping opportunity batch. ' +
        'Set pluginConfig.deliveryChannel and pluginConfig.deliveryTarget.',
    );
    return false;
  }

  const batchHash = hashOpportunityBatch(body.opportunities.map((o) => o.opportunityId));

  if (batchHash === lastOpportunityBatchHash) {
    api.logger.info('Opportunity batch unchanged since last poll — skipping subagent.');
    return false;
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const model = await readModel(api);
  const evaluatorSessionKey = `index:ambient-discovery:${config.agentId}`;

  // Phase 1: run evaluator silently in its own session.
  api.logger.info(`Ambient eval: sessionKey=${evaluatorSessionKey} batchHash=${batchHash} nonce=${startupNonce}`);
  let runId: string;
  try {
    const evalResult = await api.runtime.subagent.run({
      sessionKey: evaluatorSessionKey,
      idempotencyKey: `index:eval:opportunity-batch:${config.agentId}:${dateStr}:${batchHash}:${startupNonce}`,
      message: opportunityEvaluatorPrompt(
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
      ),
      deliver: false,
      model,
    });
    runId = evalResult.runId;
    api.logger.info(`Ambient eval dispatched: runId=${runId}`);
  } catch (err) {
    api.logger.warn(
      `Opportunity evaluator dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  // Wait for the evaluator to finish.
  try {
    api.logger.info(`Ambient eval waiting: runId=${runId}`);
    await api.runtime.subagent.waitForRun({ runId, timeoutMs: EVALUATOR_TIMEOUT_MS });
    api.logger.info(`Ambient eval completed: runId=${runId}`);
  } catch (err) {
    api.logger.warn(
      `Opportunity evaluator timed out or failed: ${err instanceof Error ? err.message : String(err)}`,
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
    api.logger.info(`Ambient eval session: ${messages.length} msgs, content length=${content.length}`);
  } catch (err) {
    api.logger.warn(
      `Opportunity evaluator session read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  if (!content) {
    api.logger.debug('Opportunity evaluator produced no output — skipping delivery.');
    lastOpportunityBatchHash = batchHash;
    return false;
  }

  // Phase 2: dispatch to user via delivery dispatcher.
  // Idempotency key uses the eval runId so a new eval run busts the cache.
  const dispatchResult = await dispatchDelivery(api, {
    contentType: 'ambient_discovery',
    content,
    idempotencyKey: `index:delivery:opportunity-batch:${config.agentId}:${dateStr}:${runId}`,
    previewShieldUrl: config.frontendUrl,
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
      `Ambient delivery timed out or failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  lastOpportunityBatchHash = batchHash;

  api.logger.info(
    `Opportunity batch dispatched: ${body.opportunities.length} candidate(s) evaluated`,
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

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  lastOpportunityBatchHash = null;
}
