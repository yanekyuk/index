/** UUID format: 8-4-4-4-12 hex chars. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates that a string is a well-formed UUID (8-4-4-4-12 hex format with dashes).
 *
 * @param value - The string to validate
 * @returns true if the string matches UUID format
 */
export function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}
