/**
 * Produces a stable hash for a set of opportunity IDs, regardless of input order.
 */
export function hashOpportunityBatch(ids: string[]): string {
  const str = [...ids].sort().join(',');
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return (h >>> 0).toString(36);
}
