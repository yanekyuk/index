/**
 * Sanitize a counterparty-authored string so it cannot break out of the fenced
 * candidate block or forge a new candidate row. Collapses newlines and neutralizes
 * any occurrence of the fence token or candidate-row prefix.
 */
export function sanitizeField(value: string): string {
  return value
    .replace(/\r?\n/g, ' ')
    .replace(/=====/g, '= = = = =')
    .replace(/\[(\d+)\]\s*opportunityId:/gi, '[$1] opportunity_id:');
}
