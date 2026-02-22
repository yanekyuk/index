/**
 * Strips UUID patterns from user-facing text to prevent internal ID leaks.
 */

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function stripUuids(text: string): string {
  return text
    .replace(/\(([^)]*)\)/g, (_match, inner: string) => {
      if (!UUID_PATTERN.test(inner)) {
        UUID_PATTERN.lastIndex = 0;
        return _match;
      }
      UUID_PATTERN.lastIndex = 0;
      const cleaned = inner
        .replace(UUID_PATTERN, '')
        .replace(/,\s*,/g, ',')
        .replace(/\b(?:from|and)\b/gi, '')
        .replace(/^[\s,]+|[\s,]+$/g, '');
      return cleaned ? `(${cleaned})` : '';
    })
    .replace(UUID_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
