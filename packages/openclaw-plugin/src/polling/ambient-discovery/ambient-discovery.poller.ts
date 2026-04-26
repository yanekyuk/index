import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { dispatchToMainAgent } from '../../lib/delivery/main-agent.dispatcher.js';
import { buildMainAgentPrompt, type MainAgentToolUse } from '../../lib/delivery/main-agent.prompt.js';
import { extractSelectedIds, confirmDeliveredBatch } from '../../lib/delivery/post-delivery-confirm.js';
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
 *  2. Hash the batch; skip if identical to last dispatch (dedup).
 *  3. Build the ambient-discovery prompt and hand it to the user's main OpenClaw
 *     agent via dispatchToMainAgent (SDK first, /hooks/agent fallback).
 *  4. If the agent didn't suppress via NO_REPLY, scrape opportunity IDs from
 *     the rendered text and confirm the batch.
 *
 * @returns `true` when a dispatch was attempted (delivered or suppressed),
 *          `false` when nothing was eligible or the batch was unchanged.
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

  const mainAgentToolUse = readToolUseConfig(api);

  const prompt = buildMainAgentPrompt({
    contentType: 'ambient_discovery',
    mainAgentToolUse,
    allowSuppress: true,
    payload: { contentType: 'ambient_discovery', maxToSurface: candidates.length, candidates },
  });

  const dispatch = await dispatchToMainAgent(api, {
    prompt,
    idempotencyKey: `index:delivery:opportunity-batch:${config.agentId}:${dateStr}:${batchHash}`,
    allowSuppress: true,
  });

  if (dispatch.error === 'network_error') {
    return false;
  }

  // Update the hash after any non-network-error outcome so a suppressed or empty
  // batch isn't re-tried on the next cycle.
  lastOpportunityBatchHash = batchHash;

  if (dispatch.suppressedByNoReply) {
    api.logger.info('Ambient discovery: agent suppressed via NO_REPLY.');
    return true;
  }

  if (!dispatch.deliveredText) {
    api.logger.debug('Ambient discovery: empty rendered text.');
    return true;
  }

  const batchIds = candidates.map((c) => c.opportunityId);
  const selectedIds = extractSelectedIds(dispatch.deliveredText, batchIds);

  if (selectedIds.length === 0) {
    api.logger.debug('Ambient discovery: rendered text has no recognizable IDs.');
    return true;
  }

  await confirmDeliveredBatch({
    baseUrl: config.baseUrl,
    agentId: config.agentId,
    apiKey: config.apiKey,
    opportunityIds: selectedIds,
    logger: api.logger,
  });

  api.logger.info(
    `Ambient discovery dispatched: ${candidates.length} candidate(s); ${selectedIds.length} confirmed`,
    { agentId: config.agentId },
  );

  return true;
}

function readToolUseConfig(api: OpenClawPluginApi): MainAgentToolUse {
  const v = api.pluginConfig['mainAgentToolUse'];
  return v === 'enabled' ? 'enabled' : 'disabled';
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  lastOpportunityBatchHash = null;
}
