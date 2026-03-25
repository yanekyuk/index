/**
 * Decides whether to set {@link users.name} from Parallel `enrichment.identity.name` for ghost users.
 * @remarks Ghosts default to the email local-part as `name` ({@link ContactService.addContact}).
 * We only replace that placeholder with a multi-word enriched name, not importer-supplied names.
 */

/**
 * @param user - Current user row (must include `email`, `name`, `isGhost`)
 * @param enrichedName - `enrichment.identity.name` from Parallel (may be untrimmed)
 * @returns True if `users.name` should be updated to the enriched full name
 */
export function shouldEnrichGhostDisplayNameFromParallel(
  user: { name: string; email: string; isGhost?: boolean | null },
  enrichedName: string,
): boolean {
  if (!user.isGhost) return false;
  const trimmed = enrichedName.trim();
  if (!trimmed || trimmed.includes("@")) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;

  const emailLocal = user.email.split("@")[0]?.toLowerCase() ?? "";
  const current = user.name.trim().toLowerCase();
  if (current === trimmed.toLowerCase()) return false;

  const isPlaceholderName =
    current === emailLocal || current === user.email.trim().toLowerCase();
  return isPlaceholderName;
}
