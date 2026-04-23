import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { readModel } from '../../lib/openclaw/plugin-api.js';
import { isDeliveryConfigured, dispatchDelivery } from '../../lib/delivery/delivery.dispatcher.js';
import { hashOpportunityBatch } from '../../lib/utils/hash.js';
import { digestEvaluatorPrompt } from './digest-evaluator.prompt.js';

/** Milliseconds to wait for the evaluator subagent to complete. */
const EVALUATOR_TIMEOUT_MS = 120_000;

export interface DailyDigestConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  maxCount: number;
}

/**
 * Handles one daily digest cycle using a two-phase pipeline:
 *
 * Phase 1 — Evaluator subagent (deliver: false, date-scoped session):
 *   Ranks candidates by value, calls confirm_opportunity_delivery for top N,
 *   outputs plain content. Session key includes date so each day starts fresh.
 *
 * Phase 2 — Delivery (via dispatchDelivery):
 *   Captures evaluator output via waitForRun + getSessionMessages, then
 *   dispatches it through the delivery dispatcher which applies channel styling.
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
  let runId: string;
  try {
    const evalResult = await api.runtime.subagent.run({
      sessionKey: evaluatorSessionKey,
      idempotencyKey: `index:eval:daily-digest:${config.agentId}:${dateStr}:${batchHash}`,
      message: digestEvaluatorPrompt(
        body.opportunities.map((o) => ({
          opportunityId: o.opportunityId,
          headline: o.rendered.headline,
          personalizedSummary: o.rendered.personalizedSummary,
          suggestedAction: o.rendered.suggestedAction,
          narratorRemark: o.rendered.narratorRemark,
        })),
        effectiveMax,
      ),
      deliver: false,
      model,
    });
    runId = evalResult.runId;
  } catch (err) {
    api.logger.warn(
      `Daily digest evaluator dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  // Wait for the evaluator to finish.
  try {
    await api.runtime.subagent.waitForRun({ runId, timeoutMs: EVALUATOR_TIMEOUT_MS });
  } catch (err) {
    api.logger.warn(
      `Daily digest evaluator timed out or failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  // Capture evaluator output — the last assistant message in the session.
  const { messages } = await api.runtime.subagent.getSessionMessages({
    sessionKey: evaluatorSessionKey,
    limit: 10,
  });
  const content = messages.filter((m) => m.role === 'assistant').at(-1)?.content ?? '';

  if (!content) {
    api.logger.debug('Daily digest evaluator produced no output — skipping delivery.');
    return false;
  }

  // Phase 2: dispatch to user via delivery dispatcher.
  const dispatchResult = await dispatchDelivery(api, {
    contentType: 'daily_digest',
    content,
    idempotencyKey: `index:delivery:daily-digest:${config.agentId}:${dateStr}:${batchHash}`,
  });

  if (dispatchResult === null) {
    return false;
  }

  api.logger.info(
    `Daily digest dispatched: ${body.opportunities.length} candidate(s), max ${effectiveMax} delivered`,
    { agentId: config.agentId },
  );

  return true;
}
