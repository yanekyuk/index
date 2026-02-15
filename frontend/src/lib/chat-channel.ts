export async function getDirectChannelId(
  firstUserId: string,
  secondUserId: string,
): Promise<string> {
  const sortedIds = [firstUserId, secondUserId].sort().join('_');
  if (sortedIds.length <= 64) {
    return sortedIds;
  }

  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(sortedIds);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    return hex.slice(0, 64);
  }

  // Fallback for environments without Web Crypto support.
  return sortedIds.slice(0, 64);
}
