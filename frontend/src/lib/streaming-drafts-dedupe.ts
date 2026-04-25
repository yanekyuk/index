/**
 * Cards already embedded in the assistant message as ```opportunity``` blocks must
 * not be repeated from streaming draft metadata (same turn).
 */
export function filterStreamingDraftsForDisplay<T extends { opportunityId: string }>(
  drafts: T[],
  opportunityIdsInMessageContent: Set<string>,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const d of drafts) {
    if (opportunityIdsInMessageContent.has(d.opportunityId)) continue;
    if (seen.has(d.opportunityId)) continue;
    seen.add(d.opportunityId);
    out.push(d);
  }
  return out;
}
