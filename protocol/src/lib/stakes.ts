import { eq, sql, inArray } from 'drizzle-orm';
import db from './drizzle/drizzle';
import { intents, intentStakes, intentStakeItems, indexMembers, userConnectionEvents, intentIndexes } from '../schemas/database.schema';
import { getUserAccessibleIndexIds } from './index-access';

// ============================================================================
// TYPES
// ============================================================================

export interface Stake {
  id: string;
  stake: bigint;
  reasoning: string | null;
  items: Array<{
    intentId: string;
    userId: string;
    payload: string;
    summary: string | null;
    createdAt: Date;
  }>;
}

export interface GetConnectingStakesOptions {
  authenticatedUserId: string;
  userIds: string[];
  requireAllUsers?: boolean;
  indexIds?: string[];
  intentIds?: string[];
  excludeConnected?: boolean;
  limit?: number;
  createdAfter?: Date;
}

// ============================================================================
// DATA LOADERS
// ============================================================================
/**
 * @deprecated
 */
async function loadStakesForUsers(userIds: string[], createdAfter?: Date): Promise<Stake[]> {
  let whereClause = sql`${intentStakes.id} IN (
      SELECT stake_id FROM intent_stake_items 
      WHERE user_id = ANY(ARRAY[${sql.join(userIds.map(id => sql`${id}`), sql`, `)}]::uuid[])
    )`;

  if (createdAfter) {
    whereClause = sql`${whereClause} AND ${intentStakes.createdAt} > ${createdAfter.toISOString()}`;
  }

  const rows = await db
    .select({
      stakeId: intentStakes.id,
      stake: intentStakes.stake,
      reasoning: intentStakes.reasoning,
      intentId: intentStakeItems.intentId,
      userId: intentStakeItems.userId,
      payload: intents.payload,
      summary: intents.summary,
      createdAt: intents.createdAt,
    })
    .from(intentStakes)
    .innerJoin(intentStakeItems, eq(intentStakeItems.stakeId, intentStakes.id))
    .innerJoin(intents, eq(intents.id, intentStakeItems.intentId))
    .where(whereClause);

  const stakeMap = new Map<string, Stake>();
  for (const row of rows) {
    if (!stakeMap.has(row.stakeId)) {
      stakeMap.set(row.stakeId, { id: row.stakeId, stake: row.stake, reasoning: row.reasoning, items: [] });
    }
    stakeMap.get(row.stakeId)!.items.push({
      intentId: row.intentId,
      userId: row.userId,
      payload: row.payload,
      summary: row.summary,
      createdAt: row.createdAt,
    });
  }
  return [...stakeMap.values()];
}

/**
 * @deprecated
 */
async function loadUserIndexes(userIds: string[]): Promise<Map<string, Set<string>>> {
  const rows = await db
    .select({ userId: indexMembers.userId, indexId: indexMembers.indexId })
    .from(indexMembers)
    .where(inArray(indexMembers.userId, userIds));

  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!map.has(row.userId)) map.set(row.userId, new Set());
    map.get(row.userId)!.add(row.indexId);
  }
  return map;
}

/**
 * @deprecated
 */
async function loadConnectedUsers(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ initiator: userConnectionEvents.initiatorUserId, receiver: userConnectionEvents.receiverUserId })
    .from(userConnectionEvents)
    .where(sql`${userConnectionEvents.initiatorUserId} = ${userId} OR ${userConnectionEvents.receiverUserId} = ${userId}`);

  const connected = new Set<string>();
  for (const row of rows) {
    if (row.initiator !== userId) connected.add(row.initiator);
    if (row.receiver !== userId) connected.add(row.receiver);
  }
  return connected;
}

/**
 * @deprecated
 */
async function loadIntentIndexes(intentIds: string[]): Promise<Map<string, Set<string>>> {
  if (!intentIds.length) return new Map();
  const rows = await db
    .select({ intentId: intentIndexes.intentId, indexId: intentIndexes.indexId })
    .from(intentIndexes)
    .where(inArray(intentIndexes.intentId, intentIds));

  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!map.has(row.intentId)) map.set(row.intentId, new Set());
    map.get(row.intentId)!.add(row.indexId);
  }
  return map;
}

// ============================================================================
// MAIN QUERY
// ============================================================================

/**
 * @deprecated
 */
export async function getConnectingStakes(options: GetConnectingStakesOptions): Promise<Stake[]> {
  const { authenticatedUserId, userIds, requireAllUsers = false, indexIds, intentIds, excludeConnected = false, limit } = options;

  // Load data
  const stakes = await loadStakesForUsers(userIds, options.createdAfter);
  const allUserIds = [...new Set(stakes.flatMap(s => s.items.map(i => i.userId)))];
  const allIntentIds = [...new Set(stakes.flatMap(s => s.items.map(i => i.intentId)))];
  const userIndexes = await loadUserIndexes(allUserIds);
  const intentIndexesMap = await loadIntentIndexes(allIntentIds);
  const accessibleIndexIds = new Set(indexIds ?? await getUserAccessibleIndexIds(authenticatedUserId));
  const connectedUsers = excludeConnected ? await loadConnectedUsers(authenticatedUserId) : new Set<string>();

  return stakes
    // Filter by intentIds if specified
    .filter(stake => {
      if (!intentIds?.length) return true;
      return stake.items.some(i => intentIds.includes(i.intentId));
    })

    // Multi-user stakes only
    .filter(stake => new Set(stake.items.map(i => i.userId)).size > 1)

    // Contains specified users
    .filter(stake => {
      const stakeUserIds = new Set(stake.items.map(i => i.userId));
      return requireAllUsers
        ? userIds.every(id => stakeUserIds.has(id))
        : userIds.some(id => stakeUserIds.has(id));
    })

    // All users share at least one common accessible index
    .filter(stake => {
      const stakeUserIds = [...new Set(stake.items.map(i => i.userId))];
      const sharedIndexes = stakeUserIds
        .map(uid => userIndexes.get(uid) ?? new Set<string>())
        .reduce((a, b) => new Set([...a].filter(x => b.has(x))));
      return [...sharedIndexes].some(idx => accessibleIndexIds.has(idx));
    })

    // All intents must share at least one common accessible index
    .filter(stake => {
      const stakeIntentIds = stake.items.map(i => i.intentId);
      // Get index sets for each intent, filtered to accessible indexes
      const intentIndexSets = stakeIntentIds.map(intentId => {
        const intentIdxs = intentIndexesMap.get(intentId) ?? new Set<string>();
        return new Set([...intentIdxs].filter(idx => accessibleIndexIds.has(idx)));
      });
      // Find intersection - at least one index must contain ALL intents
      const commonIndexes = intentIndexSets.reduce((acc, set) =>
        new Set([...acc].filter(idx => set.has(idx)))
      );
      return commonIndexes.size > 0;
    })

    // Exclude already connected
    .filter(stake => {
      if (!excludeConnected) return true;
      return !stake.items.some(i => i.userId !== authenticatedUserId && connectedUsers.has(i.userId));
    })

    // Sort by stake desc
    .sort((a, b) => Number(b.stake - a.stake))

    // Limit
    .slice(0, limit ?? 1000);
}

// ============================================================================
// HELPERS (for consumers)
// ============================================================================

/**
 * @deprecated
 */
export function stakeUsers(stake: Stake): string[] {
  return [...new Set(stake.items.map(i => i.userId))];
}

/**
 * @deprecated
 */
export function stakeOtherUsers(stake: Stake, excludeUserId: string): string[] {
  return stakeUsers(stake).filter(id => id !== excludeUserId);
}

/**
 * @deprecated
 */
export function stakeUserItems(stake: Stake, userId: string) {
  return stake.items.filter(i => i.userId === userId);
}

/**
 * @deprecated
 */
export function stakeBuildPairs(stake: Stake, userA: string, userB: string) {
  const itemsA = stakeUserItems(stake, userA);
  const itemsB = stakeUserItems(stake, userB);

  if (itemsA.length === 1 && itemsB.length === 1) {
    return [{
      stake: Number(stake.stake),
      contextUserIntent: { id: itemsA[0].intentId, payload: itemsA[0].payload, createdAt: itemsA[0].createdAt },
      targetUserIntent: { id: itemsB[0].intentId, payload: itemsB[0].payload, createdAt: itemsB[0].createdAt },
    }];
  }
  return [];
}
