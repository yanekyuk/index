/**
 * Strips UUID patterns from user-facing text to prevent internal ID leaks.
 */

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function stripUuids(text: string): string {
  return text
    .replace(UUID_PATTERN, '')
    .replace(/\(\s*(?:from\s*)?\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
