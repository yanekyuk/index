/**
 * Hook called when a user is added to an index.
 * Set by main.ts to enqueue profile HyDE job so discovery can find the member.
 */
export const IndexMembershipEvents = {
  onMemberAdded: (_userId: string, _indexId: string): void => {},
};
