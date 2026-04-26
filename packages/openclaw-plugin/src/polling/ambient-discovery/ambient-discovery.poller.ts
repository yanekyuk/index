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
 * @returns
 *   - `'dispatched'` — a dispatch landed (or dispatched but confirm failed; either way, backend was reachable and content moved).
 *   - `'empty'` — backend reached, but nothing to dispatch (no opportunities, all filtered out, or batch unchanged since last cycle). This is a healthy idle state, not a failure.
 *   - `'error'` — the backend was unreachable or returned an error, OR dispatch to the main agent failed. The scheduler should back off only on this case.
 */
export type AmbientDiscoveryOutcome = 'dispatched' | 'empty' | 'error';

export async function handle(
  api: OpenClawPluginApi,
  config: AmbientDiscoveryConfig,
): Promise<AmbientDiscoveryOutcome> {
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
    return 'error';
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    api.logger.warn(`Ambient discovery fetch failed: ${res.status} ${text}`);
    return 'error';
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
    return 'empty';
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

  if (!candidates.length) return 'empty';

  const dateStr = new Date().toISOString().slice(0, 10);
  const batchHash = hashOpportunityBatch(candidates.map((c) => c.opportunityId));

  if (batchHash === lastOpportunityBatchHash) {
    api.logger.info('Opportunity batch unchanged since last poll — skipping main-agent dispatch.');
    return 'empty';
  }

  const mainAgentToolUse = readMainAgentToolUse(api);

  const prompt = buildMainAgentPrompt({
    contentType: 'ambient_discovery',
    mainAgentToolUse,
    payload: { contentType: 'ambient_discovery', ambientDeliveredToday: null, candidates },
  });

  const dispatch = await dispatchToMainAgent(api, {
    prompt,
    idempotencyKey: `index:delivery:opportunity-batch:${config.agentId}:${dateStr}:${batchHash}`,
  });

  if (!dispatch.delivered) {
    return 'error';
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
    return 'dispatched';
  }

  lastOpportunityBatchHash = batchHash;

  api.logger.info(
    `Ambient discovery dispatched and confirmed: ${batchIds.length} candidate(s)`,
    { agentId: config.agentId },
  );

  return 'dispatched';
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  lastOpportunityBatchHash = null;
}
