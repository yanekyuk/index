import { StakeGenerator } from '../agents/intent/stake/generator/stake.generator';
import { introMaker, type IntroMakerData } from '../agents/external/intro_maker';
import { cache } from '../lib/redis';
import db from '../lib/db';
import { users as usersTable } from '../lib/schema';
import { inArray, eq } from 'drizzle-orm';
import crypto from 'crypto';
import { getConnectingStakes, stakeBuildPairs, stakeUserItems } from '../lib/stakes';
import { log } from '../lib/log';

export interface SynthesisOptions {
  initiatorId?: string;
  intentIds?: string[];
  indexIds?: string[];
  vibeOptions?: any; // To keep compatibility, but StakeGenerator takes mostly structured input
}

/**
 * SynthesisService
 * 
 * Manages the generation of "Synthesized Narratives" (Vibe Checks) and "Intros".
 * 
 * CORE FEATURES:
 * - Vibe Check: "Why do these two people match?" (Uses `StakeGenerator`).
 * - Email Intro: "Here is an email copy to introduce them" (Uses `IntroMaker`).
 * - Caching: Heavily caches results in Redis (`synthesis` hash) to avoid re-generating expensive LLM text.
 */
export class SynthesisService {
  private static stakeGenerator = new StakeGenerator();

  private static createCacheHash(data: any, options?: any): string {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify({ data, options: options || {} }))
      .digest('hex');
  }

  /**
   * Generates a "Vibe Check" (Synthesis) for a pair of users.
   * 
   * LOGIC:
   * 1. Check Cache (Redis).
   * 2. If Miss: 
   *    - Fetch Users.
   *    - Find Connecting Stakes (Why are they related?).
   *    - Flatten Stakes into "Intent Pairs".
   *    - Call `StakeGenerator` agent.
   * 3. Cache Result & Return.
   * 
   * @param contextUserId - Validates the requestor's permission/perspective.
   * @param targetUserId - The person being looked at.
   * @param opts - Config options.
   */
  static async generateSynthesis(
    contextUserId: string,
    targetUserId: string,
    opts: SynthesisOptions = {}
  ): Promise<{ synthesis: string; subject: string }> {
    try {
      const { initiatorId, intentIds, indexIds, vibeOptions } = opts;
      const isThirdPerson = vibeOptions?.style === 'newsletter';

      log.info(`[SynthesisService] Starting synthesis`, { contextUserId, targetUserId, isThirdPerson });

      // 1. Get user profiles
      const userIds = initiatorId ? [targetUserId, initiatorId] : [targetUserId];
      // Only need name/intro for cache key and agent input
      const users = await db
        .select({ id: usersTable.id, name: usersTable.name, intro: usersTable.intro })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds));

      if (!users.length) return { synthesis: "", subject: "" };

      const targetUser = users.find(u => u.id === targetUserId);
      const initiatorUser = initiatorId ? users.find(u => u.id === initiatorId) : undefined;

      // For first-person checks, contextUserId is usually the initiator ("you").
      // If initiatorId is provided (e.g. asking on behalf of someone?), we use it. 
      // Otherwise, if first person, 'initiator' name might strictly be "You" or contextUser's name.
      // But StakeGeneratorInput expects 'initiator' string name.

      // If we don't have initiatorUser loaded (because contextUserId wasn't passed in userIds), load contextUser?
      // Actually, standard usage of vibeCheck usually implies contextUser IS the initiator.
      // Let's refine loading.

      let contextUser = initiatorUser;
      if (!contextUser && contextUserId !== targetUserId) {
        const [cu] = await db.select({ id: usersTable.id, name: usersTable.name, intro: usersTable.intro })
          .from(usersTable).where(eq(usersTable.id, contextUserId));
        contextUser = cu;
      }

      if (!targetUser || !contextUser) {
        log.warn(`[SynthesisService] Users not found: Target=${targetUserId}, Context=${contextUserId}`);
        return { synthesis: "", subject: "" };
      }

      // 2. Get connecting stakes
      const stakes = await getConnectingStakes({
        authenticatedUserId: contextUserId,
        userIds: [contextUserId, targetUserId],
        requireAllUsers: true,
        indexIds,
        intentIds,
        limit: 10
      });

      if (!stakes.length) {
        log.info('[SynthesisService] No connecting stakes found');
        return { synthesis: "", subject: "" };
      }

      // 3. Build intent pairs
      const intentPairs = stakes
        .flatMap(stake => stakeBuildPairs(stake, contextUserId, targetUserId))
        .filter(p => p !== null)
      // Map to format required by StakeGenerator calls (though stakeBuildPairs returns mostly compatible content)
      // We need 'createdAt'. stakeBuildPairs returns { contextUserIntent, targetUserIntent, stake }
      // contextUserIntent has { id, payload, createdAt? } - wait, check stakes.ts for stakeBuildPairs return type

      if (!intentPairs.length) {
        log.info('[SynthesisService] No intent pairs built');
        return { synthesis: "", subject: "" };
      }

      // Deduplicate pairs to ensure diversity (avoid same intent matching multiple times or duplicates crowding top 3)
      // unique key: contextIntentId + targetIntentId is strict.
      // But here we have different contextIntentIds with SAME payload.
      // So we should deduplicate by PAYLOAD to ensure topic diversity.
      const seenPayloads = new Set<string>();
      const uniqueIntentPairs: typeof intentPairs = [];

      for (const pair of intentPairs) {
        const key = `${pair.contextUserIntent.payload.trim()}::${pair.targetUserIntent.payload.trim()}`;
        if (!seenPayloads.has(key)) {
          seenPayloads.add(key);
          uniqueIntentPairs.push(pair);
        }
      }

      // 4. Prepare Agent Input
      const vibeData = {
        initiator: contextUser.name,
        target: targetUser.name,
        targetIntro: targetUser.intro || "",
        isThirdPerson,
        intentPairs: uniqueIntentPairs.map(p => ({
          contextUserIntent: {
            id: p.contextUserIntent.id,
            payload: p.contextUserIntent.payload,
            createdAt: p.contextUserIntent.createdAt || new Date()
          },
          targetUserIntent: {
            id: p.targetUserIntent.id,
            payload: p.targetUserIntent.payload,
            createdAt: p.targetUserIntent.createdAt || new Date()
          }
        }))
      };

      // 5. Check Cache
      const cacheKey = this.createCacheHash(vibeData, vibeOptions);
      const cached = await cache.hget('synthesis', cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed.synthesis === 'string') {
            log.info('[SynthesisService] Returning cached synthesis');
            return parsed;
          }
        } catch { }
      }

      // 6. Generate
      // 6. Generate
      log.debug('[SynthesisService] Calling StakeGenerator agent - VIBE DATA INPUT', {
        intentPairsCount: vibeData.intentPairs.length,
        vibeData
      });

      const result = await this.stakeGenerator.run(vibeData);

      log.debug('[SynthesisService] STAKE GENERATOR OUTPUT', { result });

      if (result && result.body) {
        const output = { synthesis: result.body, subject: result.subject };
        await cache.hset('synthesis', cacheKey, JSON.stringify(output));
        return output;
      }

      return { synthesis: "", subject: "" };

    } catch (error) {
      log.error('[SynthesisService] Error generating synthesis:', { error });
      return { synthesis: "", subject: "" };
    }
  }

  /**
   * Generates an intro message.
   * Currently uses the legacy IntroMaker agent.
   */
  static async generateIntro(
    senderUserId: string,
    recipientUserId: string,
    indexIds?: string[]
  ): Promise<string> {
    try {
      const users = await db
        .select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable)
        .where(inArray(usersTable.id, [senderUserId, recipientUserId]));

      if (users.length !== 2) return "";

      const sender = users.find(u => u.id === senderUserId)!;
      const recipient = users.find(u => u.id === recipientUserId)!;

      const stakes = await getConnectingStakes({
        authenticatedUserId: senderUserId,
        userIds: [senderUserId, recipientUserId],
        requireAllUsers: true,
        indexIds
      });

      if (!stakes.length) return "";

      const senderReasonings: string[] = [];
      const recipientReasonings: string[] = [];

      for (const stake of stakes) {
        if (!stake.reasoning) continue;
        const senderItems = stakeUserItems(stake, senderUserId);
        const recipientItems = stakeUserItems(stake, recipientUserId);
        if (senderItems.length) senderReasonings.push(stake.reasoning);
        if (recipientItems.length) recipientReasonings.push(stake.reasoning);
      }

      if (!senderReasonings.length || !recipientReasonings.length) return "";

      const introData: IntroMakerData = {
        sender: { id: sender.id, userName: sender.name, reasonings: senderReasonings },
        recipient: { id: recipient.id, userName: recipient.name, reasonings: recipientReasonings }
      };

      const result = await introMaker(introData);
      return result.success && result.synthesis ? result.synthesis : "";
    } catch (error) {
      log.error('[SynthesisService] Error generating intro:', { error });
      return "";
    }
  }
}
