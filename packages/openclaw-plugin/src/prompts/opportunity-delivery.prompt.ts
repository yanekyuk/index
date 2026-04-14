/**
 * Builds the body portion of an opportunity delivery message.
 *
 * The returned string contains the narrator remark (if any), the personalized
 * summary, and the suggested next step. Pass it as `body` to `dispatchDelivery`
 * alongside the `headline` field from the pickup payload.
 *
 * @param rendered - The rendered fields from the opportunity pickup response.
 * @returns Formatted markdown body string (no outer "relay to user" framing —
 *   that is added by `deliveryPrompt` inside `dispatchDelivery`).
 */
export function opportunityDeliveryBody(rendered: {
  personalizedSummary: string;
  suggestedAction: string;
  narratorRemark: string;
}): string {
  const lines: string[] = [];
  if (rendered.narratorRemark) {
    lines.push(`_${rendered.narratorRemark}_`);
    lines.push('');
  }
  lines.push(rendered.personalizedSummary);
  lines.push('');
  lines.push(`**Suggested next step:** ${rendered.suggestedAction}`);
  return lines.join('\n');
}
