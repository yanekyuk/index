import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { readModel } from '../../lib/openclaw/plugin-api.js';
import { buildDeliverySessionKey } from '../../lib/delivery/delivery.dispatcher.js';
import { digestEvaluatorPrompt } from './digest-evaluator.prompt.js';

export interface DailyDigestConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  maxCount: number;
}

/**
 * Fetches all undelivered pending opportunities and delivers a daily digest
 * of the top N ranked by value.
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

  const sessionKey = buildDeliverySessionKey(api);
  if (!sessionKey) {
    api.logger.warn(
      'Daily digest: delivery routing not configured — skipping. ' +
        'Set pluginConfig.deliveryChannel and pluginConfig.deliveryTarget.',
    );
    return false;
  }

  const batchHash = hashOpportunityBatch(body.opportunities.map((o) => o.opportunityId));
  const effectiveMax = Math.min(config.maxCount, body.opportunities.length);
  const dateStr = new Date().toISOString().slice(0, 10);
  const model = await readModel(api);

  try {
    await api.runtime.subagent.run({
      sessionKey,
      idempotencyKey: `index:delivery:daily-digest:${config.agentId}:${dateStr}:${batchHash}`,
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
      deliver: true,
      model,
    });
  } catch (err) {
    api.logger.warn(
      `Daily digest subagent dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  api.logger.info(
    `Daily digest dispatched: ${body.opportunities.length} candidate(s), max ${effectiveMax} to deliver`,
    { agentId: config.agentId },
  );

  return true;
}

function hashOpportunityBatch(ids: string[]): string {
  const str = [...ids].sort().join(',');
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return (h >>> 0).toString(36);
}
