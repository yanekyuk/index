/**
 * Short-lived welcome watcher that detects onboarding completion and dispatches
 * a welcome message with initial opportunities.
 *
 * Lifecycle:
 * 1. Called from `register()` in index.ts after the onboarding dispatch.
 * 2. On start, checks `readWelcomeSent()` — if already true, returns (no-op).
 * 3. Sets a 15-second interval that:
 *    - Calls `isOnboardingComplete()`
 *    - If false → no-op, wait for next tick
 *    - If true → dispatch welcome, write `welcomeSent`, clear interval and exit
 * 4. Self-terminates after successful dispatch or if `welcomeSent` is found true.
 */

import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { dispatchToMainAgent } from '../../lib/delivery/main-agent.dispatcher.js';
import { buildMainAgentPrompt } from '../../lib/delivery/main-agent.prompt.js';
import { readMainAgentToolUse, readWelcomeSent, writeWelcomeSent, readNodeBranding } from '../../lib/delivery/config.js';
import { fetchConnectToken } from '../../lib/utils/connect-token.js';
import { isOnboardingComplete } from '../onboarding/onboarding.status.js';

export interface WelcomeWatcherConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  frontendUrl: string;
}

const PENDING_LIMIT = 20;
const POLL_INTERVAL_MS = 15_000; // 15 seconds

let intervalHandle: NodeJS.Timeout | undefined;

/**
 * Starts the welcome watcher. Returns immediately if welcomeSent is already true.
 * Otherwise, sets up a 15-second polling interval that checks onboarding completion
 * and dispatches the welcome message when ready.
 */
export async function start(
  api: OpenClawPluginApi,
  config: WelcomeWatcherConfig,
): Promise<void> {
  // If welcome was already sent, nothing to do.
  if (readWelcomeSent(api)) {
    api.logger.debug('Welcome already sent, skipping watcher.');
    return;
  }

  api.logger.debug('Starting welcome watcher.');

  intervalHandle = setInterval(() => void _tick(api, config), POLL_INTERVAL_MS);
  intervalHandle?.unref();
}

/** Single poll tick. Exported for tests. */
export async function _tick(
  api: OpenClawPluginApi,
  config: WelcomeWatcherConfig,
): Promise<void> {
  try {
    const isComplete = await isOnboardingComplete(api, {
      baseUrl: config.baseUrl,
      agentId: config.agentId,
      apiKey: config.apiKey,
    });

    if (!isComplete) {
      api.logger.debug('Welcome watcher: onboarding not yet complete.');
      return;
    }

    api.logger.info('Onboarding detected as complete, dispatching welcome.');
    clearInterval(intervalHandle);
    intervalHandle = undefined;

    const ok = await dispatchWelcome(api, config);
    if (ok) writeWelcomeSent(api);
  } catch (err) {
    api.logger.warn(
      `Welcome watcher tick errored: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Fetches pending opportunities and dispatches a welcome prompt to the main agent.
 */
async function dispatchWelcome(
  api: OpenClawPluginApi,
  config: WelcomeWatcherConfig,
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
    api.logger.warn(`Welcome fetch errored: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    api.logger.warn(`Welcome fetch failed: ${res.status} ${text}`);
    return false;
  }

  const body = (await res.json()) as {
    opportunities: Array<{
      opportunityId: string;
      counterpartUserId: string | null;
      feedCategory?: 'connection' | 'connector-flow';
      rendered: { headline: string; personalizedSummary: string; suggestedAction: string; narratorRemark: string };
    }>;
    totalPending?: number;
  };

  const totalPending = body.totalPending ?? body.opportunities.length;

  // Build candidates from opportunities.
  const candidatesRaw = await Promise.all(
    body.opportunities
      .filter((o): o is typeof o & { counterpartUserId: string } => o.counterpartUserId !== null)
      .map(async (o) => {
        const token = await fetchConnectToken(api, config.baseUrl, config.apiKey, o.opportunityId);
        if (!token) return null;

        const feedCategory = o.feedCategory ?? 'connection';
        const endpoint = feedCategory === 'connector-flow' ? 'approve-introduction' : 'connect';

        return {
          opportunityId: o.opportunityId,
          counterpartUserId: o.counterpartUserId,
          feedCategory,
          headline: o.rendered.headline,
          personalizedSummary: o.rendered.personalizedSummary,
          suggestedAction: o.rendered.suggestedAction,
          narratorRemark: o.rendered.narratorRemark,
          profileUrl: `${config.frontendUrl}/u/${o.counterpartUserId}?link_preview=false`,
          acceptUrl: `${config.baseUrl}/api/opportunities/${o.opportunityId}/${endpoint}?token=${token}&link_preview=false`,
        };
      }),
  );
  const candidates = candidatesRaw.filter((c): c is NonNullable<typeof c> => c !== null);

  const mainAgentToolUse = readMainAgentToolUse(api);
  const branding = readNodeBranding(api);
  const prompt = buildMainAgentPrompt({
    contentType: 'welcome',
    mainAgentToolUse,
    payload: { contentType: 'welcome', totalPending, candidates },
    branding,
  });

  const dispatch = await dispatchToMainAgent(api, {
    prompt,
    idempotencyKey: `index:delivery:welcome:${config.agentId}:${new Date().toISOString().slice(0, 10)}`,
  });

  if (dispatch.delivered) {
    api.logger.info(
      `Welcome dispatched: ${candidates.length} candidate(s); agent will confirm individually`,
      { agentId: config.agentId },
    );
    return true;
  }

  api.logger.warn('Welcome dispatch failed', {
    agentId: config.agentId,
    error: dispatch.error,
  });
  return false;
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = undefined;
  }
}
