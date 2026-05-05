import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { dispatchToMainAgent } from '../../lib/delivery/main-agent.dispatcher.js';
import { buildMainAgentPrompt } from '../../lib/delivery/main-agent.prompt.js';
import { readMainAgentToolUse } from '../../lib/delivery/config.js';
import { hashOpportunityBatch } from '../../lib/utils/hash.js';

export interface DailyDigestConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  frontendUrl: string;
}

const PENDING_LIMIT = 20;

/**
 * Daily digest cycle. Fetches everything still pending (i.e. everything the
 * ambient pass passed on), dispatches the prompt, and returns. The agent
 * confirms each opportunity it surfaces via `confirm_opportunity_delivery`
 * (trigger='digest'); the plugin does not call any confirm endpoint.
 *
 * @returns true on successful dispatch, false on empty or error.
 */
/**
 * Mint a connect token for an opportunity via the backend.
 * Returns the token string, or null on failure (candidate will be skipped).
 */
async function fetchConnectToken(
  baseUrl: string,
  apiKey: string,
  opportunityId: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/api/opportunities/${opportunityId}/connect-token`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: string };
    return body.token ?? null;
  } catch {
    return null;
  }
}

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

  const candidatesRaw = await Promise.all(
    body.opportunities
      .filter((o): o is typeof o & { counterpartUserId: string } => o.counterpartUserId !== null)
      .map(async (o) => {
        const token = await fetchConnectToken(config.baseUrl, config.apiKey, o.opportunityId);
        if (!token) return null;

        return {
          opportunityId: o.opportunityId,
          counterpartUserId: o.counterpartUserId,
          headline: o.rendered.headline,
          personalizedSummary: o.rendered.personalizedSummary,
          suggestedAction: o.rendered.suggestedAction,
          narratorRemark: o.rendered.narratorRemark,
          profileUrl: `${config.frontendUrl}/u/${o.counterpartUserId}`,
          acceptUrl: `${config.baseUrl}/api/opportunities/${o.opportunityId}/connect?token=${token}`,
        };
      }),
  );
  const candidates = candidatesRaw.filter((c): c is NonNullable<typeof c> => c !== null);

  if (!candidates.length) return false;

  const dateStr = new Date().toISOString().slice(0, 10);
  const batchHash = hashOpportunityBatch(candidates.map((c) => c.opportunityId));
  const mainAgentToolUse = readMainAgentToolUse(api);

  const prompt = buildMainAgentPrompt({
    contentType: 'daily_digest',
    mainAgentToolUse,
    payload: { contentType: 'daily_digest', candidates },
  });

  const dispatch = await dispatchToMainAgent(api, {
    prompt,
    idempotencyKey: `index:delivery:daily-digest:${config.agentId}:${dateStr}:${batchHash}`,
  });

  if (!dispatch.delivered) {
    return false;
  }

  api.logger.info(
    `Daily digest dispatched: ${candidates.length} candidate(s); agent will confirm individually`,
    { agentId: config.agentId },
  );

  return true;
}
