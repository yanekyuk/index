import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { dispatchToMainAgent } from '../../lib/delivery/main-agent.dispatcher.js';
import { buildMainAgentPrompt } from '../../lib/delivery/main-agent.prompt.js';
import { readMainAgentToolUse } from '../../lib/delivery/config.js';
import { confirmDeliveredBatch } from '../../lib/delivery/post-delivery-confirm.js';
import { hashOpportunityBatch } from '../../lib/utils/hash.js';

export interface DailyDigestConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  frontendUrl: string;
  maxCount: number;
}

const PENDING_LIMIT = 20;

/**
 * Handles one daily digest cycle. Single-pass:
 *  1. GET /opportunities/pending?limit=20
 *  2. Build the digest prompt and hand it to the user's main OpenClaw agent
 *     via `dispatchToMainAgent` (POST /hooks/agent → user's last channel).
 *  3. On dispatch success, confirm the entire batch via /confirm-batch.
 *
 * Trade-off: the agent decides which subset to surface, but the plugin
 * cannot see what was rendered (the gateway delivers asynchronously and
 * returns only `{status: "sent"}`). We therefore confirm every candidate
 * in the batch on success — items the agent didn't surface this cycle do
 * not roll over. The dedup hash prevents back-to-back redispatch of the
 * same set, so this matches the user's effective experience: "the digest
 * already saw these; show new ones tomorrow".
 *
 * @returns `true` when a digest was attempted (delivered or empty),
 *          `false` when nothing was eligible or dispatch failed.
 */
export async function handle(
  api: OpenClawPluginApi,
  config: DailyDigestConfig,
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
    api.logger.warn(`Daily digest fetch errored: ${err instanceof Error ? err.message : String(err)}`);
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
      rendered: { headline: string; personalizedSummary: string; suggestedAction: string; narratorRemark: string };
    }>;
  };

  if (!body.opportunities.length) {
    api.logger.info('Daily digest: no pending opportunities');
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
  const maxToSurface = Math.max(1, Math.min(config.maxCount, candidates.length));
  const mainAgentToolUse = readMainAgentToolUse(api);

  const prompt = buildMainAgentPrompt({
    contentType: 'daily_digest',
    mainAgentToolUse,
    payload: { contentType: 'daily_digest', maxToSurface, candidates },
  });

  const dispatch = await dispatchToMainAgent(api, {
    prompt,
    idempotencyKey: `index:delivery:daily-digest:${config.agentId}:${dateStr}:${batchHash}`,
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
      'Daily digest: confirm failed; the agent already received the dispatch but the ledger was not updated.',
    );
    return true;
  }

  api.logger.info(
    `Daily digest dispatched and confirmed: ${batchIds.length} candidate(s)`,
    { agentId: config.agentId },
  );

  return true;
}
