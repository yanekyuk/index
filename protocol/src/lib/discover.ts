import { inArray } from 'drizzle-orm';
import db from './drizzle/drizzle';
import { users } from '../schemas/database.schema';
import { getConnectingStakes, stakeUserItems, stakeOtherUsers } from './stakes';

export interface DiscoverFilters {
  authenticatedUserId: string;
  intentIds?: string[];
  userIds?: string[];
  indexIds?: string[];
  sources?: Array<{ type: 'file' | 'integration' | 'link'; id: string }>;
  excludeDiscovered?: boolean;
  page?: number;
  limit?: number;
}

export interface DiscoverResult {
  user: {
    id: string;
    name: string;
    email: string | null;
    avatar: string | null;
    intro: string | null;
  };
  totalStake: number;
  intents: Array<{
    intent: {
      id: string;
      payload: string;
      summary?: string | null;
      createdAt: Date;
    };
    totalStake: number;
    reasonings: string[];
  }>;
}

export async function discoverUsers(filters: DiscoverFilters): Promise<{
  results: DiscoverResult[];
  pagination: { page: number; limit: number; hasNext: boolean; hasPrev: boolean };
}> {
  const {
    authenticatedUserId,
    intentIds,
    userIds,
    indexIds,
    excludeDiscovered = true,
    page = 1,
    limit = 50
  } = filters;

  // Get stakes where I'm a participant (with privacy checks built-in)
  const stakes = await getConnectingStakes({
    authenticatedUserId,
    userIds: [authenticatedUserId],
    requireAllUsers: true,
    indexIds,
    intentIds,
    excludeConnected: excludeDiscovered
  });

  if (!stakes.length) {
    return { results: [], pagination: { page, limit, hasNext: false, hasPrev: page > 1 } };
  }

  // Aggregate by discovered user
  const userMap = new Map<string, {
    totalStake: number;
    intentMap: Map<string, {
      intent: { id: string; payload: string; summary: string | null; createdAt: Date };
      totalStake: number;
      reasonings: string[];
    }>;
  }>();

  for (const stake of stakes) {
    const myIntents = stakeUserItems(stake, authenticatedUserId);
    const otherUserIds = stakeOtherUsers(stake, authenticatedUserId);

    for (const discoveredUserId of otherUserIds) {
      // Apply user filter if specified
      if (userIds?.length && !userIds.includes(discoveredUserId)) continue;

      if (!userMap.has(discoveredUserId)) {
        userMap.set(discoveredUserId, { totalStake: 0, intentMap: new Map() });
      }

      const userData = userMap.get(discoveredUserId)!;
      userData.totalStake += Number(stake.stake);

      for (const item of myIntents) {
        if (!userData.intentMap.has(item.intentId)) {
          userData.intentMap.set(item.intentId, {
            intent: {
              id: item.intentId,
              payload: item.payload,
              summary: item.summary,
              createdAt: item.createdAt
            },
            totalStake: 0,
            reasonings: []
          });
        }
        const intentData = userData.intentMap.get(item.intentId)!;
        intentData.totalStake += Number(stake.stake);
        if (stake.reasoning && !intentData.reasonings.includes(stake.reasoning)) {
          intentData.reasonings.push(stake.reasoning);
        }
      }
    }
  }

  // Fetch user profiles
  const discoveredUserIds = [...userMap.keys()];
  if (!discoveredUserIds.length) {
    return { results: [], pagination: { page, limit, hasNext: false, hasPrev: page > 1 } };
  }

  const profiles = await db
    .select({ id: users.id, name: users.name, email: users.email, avatar: users.avatar, intro: users.intro })
    .from(users)
    .where(inArray(users.id, discoveredUserIds));

  const profileMap = new Map(profiles.map(p => [p.id, p]));

  // Build results
  const results: DiscoverResult[] = [];
  for (const userId of discoveredUserIds) {
    const profile = profileMap.get(userId);
    const data = userMap.get(userId);
    if (!profile || !data) continue;
    
    results.push({
      user: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        avatar: profile.avatar,
        intro: profile.intro
      },
      totalStake: data.totalStake,
      intents: Array.from(data.intentMap.values())
    });
  }
  results.sort((a, b) => b.totalStake - a.totalStake);

  // Paginate
  const startIdx = (page - 1) * limit;
  return {
    results: results.slice(startIdx, startIdx + limit),
    pagination: { page, limit, hasNext: startIdx + limit < results.length, hasPrev: page > 1 }
  };
}
