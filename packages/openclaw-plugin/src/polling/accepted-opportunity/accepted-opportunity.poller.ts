import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { dispatchToMainAgent } from '../../lib/delivery/main-agent.dispatcher.js';
import { buildMainAgentPrompt } from '../../lib/delivery/main-agent.prompt.js';
import { readMainAgentToolUse, readNodeBranding } from '../../lib/delivery/config.js';
import { hashOpportunityBatch } from '../../lib/utils/hash.js';
import { isOnboardingComplete } from '../onboarding/onboarding.status.js';

export interface AcceptedOpportunityConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
}

const ACCEPTED_LIMIT = 10;

let lastAcceptedBatchHash: string | null = null;

export type AcceptedOpportunityOutcome = 'dispatched' | 'empty' | 'error';

export async function handle(
  api: OpenClawPluginApi,
  config: AcceptedOpportunityConfig,
): Promise<AcceptedOpportunityOutcome> {
  if (!await isOnboardingComplete(api, config)) {
    api.logger.debug('Accepted opportunity: onboarding not complete, skipping.');
    return 'empty';
  }

  const acceptedUrl = `${config.baseUrl}/api/agents/${config.agentId}/opportunities/accepted?limit=${ACCEPTED_LIMIT}`;

  let res: Response;
  try {
    res = await fetch(acceptedUrl, {
      method: 'GET',
      headers: { 'x-api-key': config.apiKey },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    api.logger.warn('Accepted opportunity fetch errored', {
      url: acceptedUrl,
      agentId: config.agentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 'error';
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const detail = { url: acceptedUrl, status: res.status, body: text, agentId: config.agentId };
    if (res.status === 401 || res.status === 403) {
      api.logger.error('Accepted opportunity fetch unauthorized', detail);
    } else {
      api.logger.warn('Accepted opportunity fetch failed', detail);
    }
    return 'error';
  }

  const body = (await res.json()) as {
    opportunities: Array<{
      opportunityId: string;
      accepterUserId: string;
      accepterName: string;
      conversationUrl: string;
      telegramHandle: string | null;
      rendered: { headline: string; personalizedSummary: string };
    }>;
  };

  if (!body.opportunities.length) {
    api.logger.info('Accepted opportunity poll: nothing new');
    return 'empty';
  }

  const candidates = body.opportunities.map((o) => ({
    opportunityId: o.opportunityId,
    accepterName: o.accepterName,
    conversationUrl: o.conversationUrl,
    telegramHandle: o.telegramHandle,
    headline: o.rendered.headline,
    personalizedSummary: o.rendered.personalizedSummary,
  }));

  const dateStr = new Date().toISOString().slice(0, 10);
  const batchHash = hashOpportunityBatch(candidates.map((c) => c.opportunityId));

  if (batchHash === lastAcceptedBatchHash) {
    api.logger.info('Accepted opportunity batch unchanged since last poll — skipping.');
    return 'empty';
  }

  const mainAgentToolUse = readMainAgentToolUse(api);
  const branding = readNodeBranding(api);

  const prompt = buildMainAgentPrompt({
    contentType: 'accepted_opportunity',
    mainAgentToolUse,
    payload: { contentType: 'accepted_opportunity', candidates },
    branding,
  });

  const dispatch = await dispatchToMainAgent(api, {
    prompt,
    idempotencyKey: `index:delivery:accepted-batch:${config.agentId}:${dateStr}:${batchHash}`,
  });

  if (!dispatch.delivered) {
    return 'error';
  }

  lastAcceptedBatchHash = batchHash;

  api.logger.info(
    `Accepted opportunity dispatched: ${candidates.length} candidate(s)`,
    { agentId: config.agentId },
  );

  return 'dispatched';
}

export function _resetForTesting(): void {
  lastAcceptedBatchHash = null;
}
