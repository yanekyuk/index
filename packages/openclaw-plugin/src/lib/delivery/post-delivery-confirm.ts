import type { PluginLogger } from '../openclaw/plugin-api.js';

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Extracts opportunity IDs from evaluator output by matching UUIDs
 * and filtering against the known batch.
 *
 * @param content - Evaluator text output containing opportunityId references.
 * @param batchIds - The full list of opportunity IDs in the evaluated batch.
 * @returns Opportunity IDs that appear in both the content and the batch.
 */
export function extractSelectedIds(content: string, batchIds: string[]): string[] {
  const batchSet = new Set(batchIds.map((id) => id.toLowerCase()));
  const found = content.match(UUID_RE) ?? [];
  const unique = new Set<string>();
  for (const id of found) {
    const lower = id.toLowerCase();
    if (batchSet.has(lower) && !unique.has(lower)) {
      unique.add(lower);
    }
  }
  return [...unique];
}

/**
 * Confirms delivered opportunities via the batch-confirm backend endpoint.
 * Best-effort — logs warnings on failure but never throws.
 *
 * @returns `true` when the backend acknowledged the confirm, `false` on any
 *          error (network, non-2xx, parse). Callers use this to decide
 *          whether to advance local state (e.g. dedup hash) or retry next cycle.
 */
export async function confirmDeliveredBatch(
  opts: {
    baseUrl: string;
    agentId: string;
    apiKey: string;
    opportunityIds: string[];
    logger: PluginLogger;
  },
): Promise<boolean> {
  if (!opts.opportunityIds.length) return true;

  try {
    const res = await fetch(
      `${opts.baseUrl}/api/agents/${opts.agentId}/opportunities/confirm-batch`,
      {
        method: 'POST',
        headers: {
          'x-api-key': opts.apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ opportunityIds: opts.opportunityIds }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      opts.logger.warn(`Post-delivery confirm failed: ${res.status} ${text}`);
      return false;
    }
    const result = (await res.json()) as { confirmed: number; alreadyDelivered: number };
    opts.logger.info(
      `Post-delivery confirm: ${result.confirmed} confirmed, ${result.alreadyDelivered} already delivered`,
    );
    return true;
  } catch (err) {
    opts.logger.warn(
      `Post-delivery confirm errored: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
