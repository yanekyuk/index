import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { readModel } from '../../lib/openclaw/plugin-api.js';
import { buildDeliverySessionKey } from '../../lib/delivery/delivery.dispatcher.js';
import { opportunityEvaluatorPrompt } from './opportunity-evaluator.prompt.js';

/** Hash of the last opportunity batch dispatched. Used to skip unchanged batches. */
let lastOpportunityBatchHash: string | null = null;

export interface AmbientDiscoveryConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
}

/**
 * Fetches all undelivered pending opportunities in one request, then launches
 * a single evaluator+delivery subagent that scores them and delivers one message.
 *
 * @param api - The OpenClaw plugin API instance.
 * @param config - Configuration for the ambient discovery poller.
 * @returns `true` if a subagent was launched, `false` if no candidates or no routing.
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

  const sessionKey = buildDeliverySessionKey(api);
  if (!sessionKey) {
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

  try {
    await api.runtime.subagent.run({
      sessionKey,
      idempotencyKey: `index:delivery:opportunity-batch:${config.agentId}:${dateStr}:${batchHash}`,
      message: opportunityEvaluatorPrompt(
        body.opportunities.map((o) => ({
          opportunityId: o.opportunityId,
          headline: o.rendered.headline,
          personalizedSummary: o.rendered.personalizedSummary,
          suggestedAction: o.rendered.suggestedAction,
          narratorRemark: o.rendered.narratorRemark,
        })),
      ),
      deliver: true,
      model,
    });
    lastOpportunityBatchHash = batchHash;
  } catch (err) {
    api.logger.warn(
      `Opportunity batch subagent dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  api.logger.info(
    `Opportunity batch dispatched: ${body.opportunities.length} candidate(s) for evaluation`,
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

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  lastOpportunityBatchHash = null;
}
