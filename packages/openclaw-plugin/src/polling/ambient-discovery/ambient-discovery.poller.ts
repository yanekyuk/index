import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { readModel } from '../../lib/openclaw/plugin-api.js';
import { isDeliveryConfigured, dispatchDelivery, EVALUATOR_TIMEOUT_MS } from '../../lib/delivery/delivery.dispatcher.js';
import { hashOpportunityBatch } from '../../lib/utils/hash.js';
import { opportunityEvaluatorPrompt } from './opportunity-evaluator.prompt.js';

/** Hash of the last opportunity batch dispatched. Used to skip unchanged batches. */
let lastOpportunityBatchHash: string | null = null;

export interface AmbientDiscoveryConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  frontendUrl: string;
}

/**
 * Handles one ambient discovery poll cycle using a two-phase pipeline:
 *
 * Phase 1 — Evaluator subagent (deliver: false, own session):
 *   Evaluates candidates, calls confirm_opportunity_delivery for selected ones,
 *   outputs plain content with no formatting instructions.
 *
 * Phase 2 — Delivery (via dispatchDelivery):
 *   Captures evaluator output via waitForRun + getSessionMessages, then
 *   dispatches it through the delivery dispatcher which applies channel styling.
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
    api.logger.debug('Opportunity batch unchanged since last poll — skipping subagent.');
    return false;
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const model = await readModel(api);
  const evaluatorSessionKey = `index:ambient-discovery:${config.agentId}`;

  // Phase 1: run evaluator silently in its own session.
  let runId: string;
  try {
    const evalResult = await api.runtime.subagent.run({
      sessionKey: evaluatorSessionKey,
      idempotencyKey: `index:eval:opportunity-batch:${config.agentId}:${dateStr}:${batchHash}`,
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
          })),
      ),
      deliver: false,
      model,
    });
    runId = evalResult.runId;
  } catch (err) {
    api.logger.warn(
      `Opportunity evaluator dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  // Wait for the evaluator to finish.
  try {
    await api.runtime.subagent.waitForRun({ runId, timeoutMs: EVALUATOR_TIMEOUT_MS });
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
    content = messages.filter((m) => m.role === 'assistant').at(-1)?.content ?? '';
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
  const dispatchResult = await dispatchDelivery(api, {
    contentType: 'ambient_discovery',
    content,
    idempotencyKey: `index:delivery:opportunity-batch:${config.agentId}:${dateStr}:${batchHash}`,
    frontendUrl: config.frontendUrl,
  });

  if (dispatchResult === null) {
    return false;
  }

  lastOpportunityBatchHash = batchHash;

  api.logger.info(
    `Opportunity batch dispatched: ${body.opportunities.length} candidate(s) evaluated`,
    { agentId: config.agentId },
  );

  return true;
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  lastOpportunityBatchHash = null;
}
