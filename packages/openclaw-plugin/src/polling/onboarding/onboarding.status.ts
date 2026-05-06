import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';

export interface OnboardingStatusConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
}

let cachedComplete: boolean | undefined = undefined;
let cachedForApiKey: string | undefined = undefined;

/**
 * Returns true when the user has completed onboarding (`onboardingCompletedAt`
 * is set on the backend). Caches `true` forever for the same API key — onboarding
 * completion is a one-way transition. Re-queries when the API key changes.
 * Returns `false` conservatively on network errors or non-2xx responses so
 * dispatches remain gated on a flaky connection.
 */
export async function isOnboardingComplete(
  api: OpenClawPluginApi,
  config: OnboardingStatusConfig,
): Promise<boolean> {
  if (cachedComplete === true && cachedForApiKey === config.apiKey) return true;

  try {
    const res = await fetch(`${config.baseUrl}/api/agents/me`, {
      headers: { 'x-api-key': config.apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      api.logger.warn('Onboarding status check failed', { status: res.status });
      return false;
    }
    const body = (await res.json()) as { onboardingCompletedAt?: string | null };
    const complete = body.onboardingCompletedAt != null;
    if (complete) {
      cachedComplete = true;
      cachedForApiKey = config.apiKey;
    }
    return complete;
  } catch (err) {
    api.logger.warn('Onboarding status check errored', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  cachedComplete = undefined;
  cachedForApiKey = undefined;
}
