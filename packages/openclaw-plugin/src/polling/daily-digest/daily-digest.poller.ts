import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { dispatchToMainAgent } from '../../lib/delivery/main-agent.dispatcher.js';
import { buildMainAgentPrompt, type MainAgentToolUse } from '../../lib/delivery/main-agent.prompt.js';
import { extractSelectedIds, confirmDeliveredBatch } from '../../lib/delivery/post-delivery-confirm.js';
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
 *     via dispatchToMainAgent (SDK first, /hooks/agent fallback).
 *  3. If the agent didn't suppress via NO_REPLY, scrape opportunity IDs from
 *     the rendered text and confirm the batch.
 *
 * @returns `true` when a digest was attempted (delivered or suppressed),
 *          `false` when nothing was eligible.
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
  const mainAgentToolUse = readToolUseConfig(api);

  const prompt = buildMainAgentPrompt({
    contentType: 'daily_digest',
    mainAgentToolUse,
    allowSuppress: true,
    payload: { contentType: 'daily_digest', maxToSurface, candidates },
  });

  const dispatch = await dispatchToMainAgent(api, {
    prompt,
    idempotencyKey: `index:delivery:daily-digest:${config.agentId}:${dateStr}:${batchHash}`,
    allowSuppress: true,
  });

  if (dispatch.error === 'network_error') {
    return false;
  }

  if (dispatch.suppressedByNoReply) {
    api.logger.info('Daily digest: agent suppressed via NO_REPLY.');
    return true;
  }

  if (!dispatch.deliveredText) {
    api.logger.debug('Daily digest: empty rendered text.');
    return true;
  }

  const batchIds = candidates.map((c) => c.opportunityId);
  const selectedIds = extractSelectedIds(dispatch.deliveredText, batchIds);

  if (selectedIds.length === 0) {
    api.logger.debug('Daily digest: rendered text has no recognizable IDs.');
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
    `Daily digest dispatched: ${candidates.length} candidate(s); ${selectedIds.length} confirmed`,
    { agentId: config.agentId },
  );

  return true;
}

function readToolUseConfig(api: OpenClawPluginApi): MainAgentToolUse {
  const v = api.pluginConfig['mainAgentToolUse'];
  return v === 'enabled' ? 'enabled' : 'disabled';
}
