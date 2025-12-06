import { vibeCheck, type VibeCheckOptions } from '../agents/external/vibe_checker';
import { introMaker, type IntroMakerData } from '../agents/external/intro_maker';
import { cache } from './redis';
import db from './db';
import { users as usersTable, intents, intentStakes, intentStakeItems, agents, intentIndexes } from './schema';
import { eq, isNull, and, sql, inArray } from 'drizzle-orm';
import crypto from 'crypto';
import { getAccessibleIntents } from './intent-access';

interface SynthesisOptions extends VibeCheckOptions { }

function createCacheHash(data: any, options?: any): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ data, options: options || {} }))
    .digest('hex');
}

// Main synthesis function - analyzes how targetUser can help with contextUser's intents
export async function synthesizeVibeCheck(
  contextUserId: string,
  targetUserId: string,
  opts?: {
    initiatorId?: string;
    intentIds?: string[];
    indexIds?: string[];
    vibeOptions?: SynthesisOptions;
  }
): Promise<{ synthesis: string; subject: string }> {
  try {
    const { initiatorId, intentIds, indexIds, vibeOptions } = opts || {};

    // Get target user info
    const userIds = initiatorId ? [targetUserId, initiatorId] : [targetUserId];
    const users = await db
      .select({ id: usersTable.id, name: usersTable.name, intro: usersTable.intro })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds));

    if (!users.length) return { synthesis: "", subject: "" };

    const targetUser = users.find(u => u.id === targetUserId);
    const initiatorUser = initiatorId ? users.find(u => u.id === initiatorId) : undefined;

    if (!targetUser) return { synthesis: "", subject: "" };

    // Get context intents using secure access control
    const contextIntents = await getAccessibleIntents(contextUserId, {
      indexIds,
      intentIds,
      includeOwnIntents: true
    });


    const contextIntentIds = contextIntents.intents.map(i => i.id);

    if (!contextIntentIds.length) return { synthesis: "", subject: "" };

    // Get top 3 stakes connecting context and target user intents
    // Uses denormalized user_id in intentStakeItems for fast indexed lookups
    // Optional index filtering via LEFT JOIN (null = not in index)
    const stakes = await db
      .select({ 
        stakeId: intentStakes.id,
        stake: intentStakes.stake, 
        stakeIntents: intentStakes.intents 
      })
      .from(intentStakes)
      .innerJoin(agents, eq(intentStakes.agentId, agents.id))
      .innerJoin(intentStakeItems, eq(intentStakeItems.stakeId, intentStakes.id))
      .leftJoin(intentIndexes, eq(intentIndexes.intentId, intentStakeItems.intentId))
      .where(and(
        isNull(agents.deletedAt),
        // Filter to stakes involving both users
        inArray(intentStakeItems.userId, [contextUserId, targetUserId]),
        // At least one intent must be in contextIntentIds
        inArray(intentStakeItems.intentId, contextIntentIds),
        // Index filtering (if specified)
        ...(indexIds?.length ? [inArray(intentIndexes.indexId, indexIds)] : [])
      ))
      .groupBy(intentStakes.id, intentStakes.stake, intentStakes.intents)
      .having(and(
        // Exactly 2 intents (pair stake)
        sql`COUNT(DISTINCT ${intentStakeItems.intentId}) = 2`,
        // Both users must be present
        sql`COUNT(DISTINCT ${intentStakeItems.userId}) = 2`
      ))
      .orderBy(sql`${intentStakes.stake} DESC`)
      .limit(3);

    if (!stakes.length) return { synthesis: "", subject: "" };

    // Fetch intent details and build pairs
    const allIntentIds = stakes.flatMap(s => s.stakeIntents);
    const intentDetails = await db
      .select({ id: intents.id, payload: intents.payload, userId: intents.userId, createdAt: intents.createdAt })
      .from(intents)
      .where(inArray(intents.id, allIntentIds));

    type IntentPair = {
      stake: number;
      contextUserIntent: { id: string; payload: string; createdAt: Date };
      targetUserIntent: { id: string; payload: string; createdAt: Date };
    };

    const intentPairs = stakes
      .map(stake => {
        const [id1, id2] = stake.stakeIntents;
        const intent1 = intentDetails.find(i => i.id === id1);
        const intent2 = intentDetails.find(i => i.id === id2);

        const contextIntent = intent1?.userId === contextUserId ? intent1 : intent2;
        const targetIntent = intent1?.userId === targetUserId ? intent1 : intent2;

        if (!contextIntent || !targetIntent) return null;

        return {
          stake: Number(stake.stake),
          contextUserIntent: {
            id: contextIntent.id,
            payload: contextIntent.payload,
            createdAt: contextIntent.createdAt
          },
          targetUserIntent: {
            id: targetIntent.id,
            payload: targetIntent.payload,
            createdAt: targetIntent.createdAt
          }
        };
      })
      .filter((p): p is IntentPair => p !== null);

    // Prepare vibe check data
    const vibeData = {
      id: targetUser.id,
      name: targetUser.name,
      intro: targetUser.intro || "",
      intentPairs,
      initiatorName: initiatorUser?.name
    };

    // Check cache
    const cacheData = initiatorId ? { ...vibeData, initiatorId } : vibeData;
    const cacheKey = createCacheHash(cacheData, vibeOptions);
    const cached = await cache.hget('synthesis', cacheKey);

    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        // Only return if it matches the expected object structure
        if (parsed && typeof parsed.synthesis === 'string' && typeof parsed.subject === 'string') {
          return parsed;
        }
      } catch {
        // Ignore error and proceed to regenerate
      }
    }

    // Generate synthesis
    const result = await vibeCheck(vibeData, vibeOptions);

    if (result.success && result.synthesis) {
      const cacheValue = { synthesis: result.synthesis, subject: result.subject || "" };
      await cache.hset('synthesis', cacheKey, JSON.stringify(cacheValue));
      return cacheValue;
    }

    return { synthesis: "", subject: "" };
  } catch (error) {
    console.error('Synthesis error:', error);
    return { synthesis: "", subject: "" };
  }
}

// Intro synthesis function - handles all data preparation internally
export async function synthesizeIntro(
  senderUserId: string,
  recipientUserId: string,
  indexIds?: string[]
): Promise<string> {
  try {
    // Get users
    const users = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(inArray(usersTable.id, [senderUserId, recipientUserId]));

    if (users.length !== 2) return "";

    const sender = users.find(u => u.id === senderUserId)!;
    const recipient = users.find(u => u.id === recipientUserId)!;

    // Get shared stakes between both users
    // Uses denormalized user_id for fast indexed lookups
    const stakes = await db
      .select({ reasoning: intentStakes.reasoning, stakeIntents: intentStakes.intents })
      .from(intentStakes)
      .innerJoin(agents, eq(intentStakes.agentId, agents.id))
      .innerJoin(intentStakeItems, eq(intentStakeItems.stakeId, intentStakes.id))
      .where(and(
        isNull(agents.deletedAt),
        // Filter to stakes involving both users
        inArray(intentStakeItems.userId, [senderUserId, recipientUserId])
      ))
      .groupBy(intentStakes.id, intentStakes.reasoning, intentStakes.intents)
      .having(and(
        // Multi-intent stakes only (not single confidence stakes)
        sql`COUNT(DISTINCT ${intentStakeItems.intentId}) > 1`,
        // Both users must be present
        sql`COUNT(DISTINCT ${intentStakeItems.userId}) = 2`
      ));

    if (!stakes.length) return "";

    // Get intent IDs for both users
    const [senderIntentIds, recipientIntentIds] = await Promise.all([
      db.select({ id: intents.id }).from(intents).where(eq(intents.userId, senderUserId)).then(r => r.map(i => i.id)),
      db.select({ id: intents.id }).from(intents).where(eq(intents.userId, recipientUserId)).then(r => r.map(i => i.id))
    ]);

    // Group reasonings by user
    const senderReasonings: string[] = [];
    const recipientReasonings: string[] = [];

    stakes.forEach(stake => {
      if (stake.stakeIntents.some(id => senderIntentIds.includes(id))) {
        senderReasonings.push(stake.reasoning);
      }
      if (stake.stakeIntents.some(id => recipientIntentIds.includes(id))) {
        recipientReasonings.push(stake.reasoning);
      }
    });

    if (!senderReasonings.length || !recipientReasonings.length) return "";

    const introData: IntroMakerData = {
      sender: { id: sender.id, userName: sender.name, reasonings: senderReasonings },
      recipient: { id: recipient.id, userName: recipient.name, reasonings: recipientReasonings }
    };

    const result = await introMaker(introData);
    return result.success && result.synthesis ? result.synthesis : "";

  } catch (error) {
    console.error('Intro synthesis error:', error);
    return "";
  }
}
