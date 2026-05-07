import type { OpenClawPluginApi } from '../openclaw/plugin-api.js';

/**
 * Mint a connect token for an opportunity via the backend.
 * Returns the token string, or null on failure (candidate will be skipped).
 */
export async function fetchConnectToken(
  api: OpenClawPluginApi,
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
    if (!res.ok) {
      api.logger.warn('Connect token mint failed', { opportunityId, status: res.status });
      return null;
    }
    const body = (await res.json()) as { token?: string };
    return body.token ?? null;
  } catch (err) {
    api.logger.warn('Connect token mint errored', {
      opportunityId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
