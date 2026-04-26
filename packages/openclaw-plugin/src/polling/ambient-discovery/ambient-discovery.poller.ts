import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { dispatchToMainAgent } from '../../lib/delivery/main-agent.dispatcher.js';
import { buildMainAgentPrompt } from '../../lib/delivery/main-agent.prompt.js';
import { readMainAgentToolUse } from '../../lib/delivery/config.js';
import { confirmDeliveredBatch } from '../../lib/delivery/post-delivery-confirm.js';
import { hashOpportunityBatch } from '../../lib/utils/hash.js';

export interface AmbientDiscoveryConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  frontendUrl: string;
}

const PENDING_LIMIT = 10;

/** Hash of the last opportunity batch dispatched. Used to skip unchanged batches. */
let lastOpportunityBatchHash: string | null = null;

/**
 * Handles one ambient discovery poll cycle. Single-pass:
 *  1. GET /opportunities/pending?limit=10
 *  2. Hash the batch; skip if identical to last successful dispatch (dedup).
 *  3. Build the ambient-discovery prompt and hand it to the user's main
 *     OpenClaw agent via `dispatchToMainAgent` (POST /hooks/agent →
 *     user's last channel).
 *  4. On dispatch success, confirm the entire batch via /confirm-batch
 *     and advance the dedup hash.
 *
 * Trade-off: the agent decides which subset to surface, but the plugin
 * cannot see what was rendered (the gateway delivers asynchronously).
 * We therefore confirm every candidate in the dispatched batch — items
 * the agent didn't surface this cycle do not roll over. The dedup hash
 * prevents back-to-back redispatch of the same set.
 *
 * @returns `true` when a dispatch landed, `false` when nothing was
 *          eligible, the batch was unchanged, or dispatch failed.
 */
export async function handle(
  api: OpenClawPluginApi,
  config: AmbientDiscoveryConfig,
): Promise<boolean> {
  const pendingUrl = `${config.baseUrl}/api/agents/${config.agentId}/opportunities/pending?limit=${PENDING_LIMIT}`;

  let res: Response;
  try {
    res = await fetch(pendingUrl, {
      method: 'GET',
      headers: { 'x-api-key': config.apiKey },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    api.logger.warn(`Ambient discovery fetch errored: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    api.logger.warn(`Ambient discovery fetch failed: ${res.status} ${text}`);
    return false;
  }

  const body = (await res.json()) as {
    opportunities: Array<{
      opportunityId: string;
      counterpartUserId: string | null;
      rendered: { headline: string; personalizedSummary: string; suggestedAction: string; narratorRemark: string };
    }>;
  };

  if (!body.opportunities.length) {
    api.logger.info('Ambient discovery: no pending opportunities');
    return false;
  }

  const candidates = body.opportunities
    .filter((o): o is typeof o & { counterpartUserId: string } => o.counterpartUserId !== null)
    .map((o) => ({
      opportunityId: o.opportunityId,
      counterpartUserId: o.counterpartUserId,
      headline: o.rendered.headline,
      personalizedSummary: o.rendered.personalizedSummary,
      suggestedAction: o.rendered.suggestedAction,
      narratorRemark: o.rendered.narratorRemark,
      profileUrl: `${config.frontendUrl}/u/${o.counterpartUserId}`,
      acceptUrl: `${config.frontendUrl}/opportunities/${o.opportunityId}/accept`,
      skipUrl: `${config.frontendUrl}/opportunities/${o.opportunityId}/skip`,
    }));

  if (!candidates.length) return false;

  const dateStr = new Date().toISOString().slice(0, 10);
  const batchHash = hashOpportunityBatch(candidates.map((c) => c.opportunityId));

  if (batchHash === lastOpportunityBatchHash) {
    api.logger.info('Opportunity batch unchanged since last poll — skipping main-agent dispatch.');
    return false;
  }

  const mainAgentToolUse = readMainAgentToolUse(api);

  const prompt = buildMainAgentPrompt({
    contentType: 'ambient_discovery',
    mainAgentToolUse,
    payload: { contentType: 'ambient_discovery', maxToSurface: candidates.length, candidates },
  });

  const dispatch = await dispatchToMainAgent(api, {
    prompt,
    idempotencyKey: `index:delivery:opportunity-batch:${config.agentId}:${dateStr}:${batchHash}`,
  });

  if (!dispatch.delivered) {
    return false;
  }

  const batchIds = candidates.map((c) => c.opportunityId);
  const confirmed = await confirmDeliveredBatch({
    baseUrl: config.baseUrl,
    agentId: config.agentId,
    apiKey: config.apiKey,
    opportunityIds: batchIds,
    logger: api.logger,
  });

  if (!confirmed) {
    api.logger.warn(
      'Ambient discovery: confirm failed; leaving dedup hash unchanged so the batch retries next cycle.',
    );
    return true;
  }

  lastOpportunityBatchHash = batchHash;

  api.logger.info(
    `Ambient discovery dispatched and confirmed: ${batchIds.length} candidate(s)`,
    { agentId: config.agentId },
  );

  return true;
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  lastOpportunityBatchHash = null;
}
