import { vibeCheck, vibeCheckNewsletter, type VibeCheckOptions } from '../agents/external/vibe_checker';
import { introMaker, type IntroMakerData } from '../agents/external/intro_maker';
import { cache } from './redis';
import db from './db';
import { users as usersTable } from './schema';
import { inArray } from 'drizzle-orm';
import crypto from 'crypto';
import { getConnectingStakes, stakeBuildPairs, stakeUserItems } from './stakes';

interface SynthesisOptions extends VibeCheckOptions { }

function createCacheHash(data: any, options?: any): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ data, options: options || {} }))
    .digest('hex');
}

// ============================================================================
// VIBE CHECK: Analyzes how targetUser can help with contextUser's intents
// ============================================================================

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

    console.log('[vibecheck] Starting synthesis', { contextUserId, targetUserId, initiatorId, intentIds, indexIds });

    // Get user profiles
    const userIds = initiatorId ? [targetUserId, initiatorId] : [targetUserId];
    const users = await db
      .select({ id: usersTable.id, name: usersTable.name, intro: usersTable.intro })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds));

    if (!users.length) {
      return { synthesis: "", subject: "" };
    }

    const targetUser = users.find(u => u.id === targetUserId);
    const initiatorUser = initiatorId ? users.find(u => u.id === initiatorId) : undefined;

    if (!targetUser) {
      console.log('[vibecheck] Target user not found:', targetUserId);
      return { synthesis: "", subject: "" };
    }

    // Get stakes connecting both users (with privacy checks)
    const stakes = await getConnectingStakes({
      authenticatedUserId: contextUserId,
      userIds: [contextUserId, targetUserId],
      requireAllUsers: true,  // stake must contain BOTH users
      indexIds,
      intentIds,
      limit: 3
    });

    if (!stakes.length) {
      console.log('[vibecheck] No connecting stakes found');
      return { synthesis: "", subject: "" };
    }

    console.log('[vibecheck] Found stakes:', stakes.length);

    // Build intent pairs from stakes
    const intentPairs = stakes
      .flatMap(stake => stakeBuildPairs(stake, contextUserId, targetUserId))
      .filter(p => p !== null);

    if (!intentPairs.length) {
      console.log('[vibecheck] No intent pairs built');
      return { synthesis: "", subject: "" };
    }

    console.log('[vibecheck] Intent pairs built:', intentPairs.length);

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
          console.log('[vibecheck] Returning cached synthesis');
          return parsed;
        }
      } catch {
        // Ignore error and proceed to regenerate
      }
    }

    // Generate synthesis
    console.log('[vibecheck] Calling vibeCheck agent');
    const result = await vibeCheck(vibeData, vibeOptions);

    if (result.success && result.synthesis) {
      console.log('[vibecheck] Synthesis generated successfully');
      const cacheValue = { synthesis: result.synthesis, subject: result.subject || "" };
      await cache.hset('synthesis', cacheKey, JSON.stringify(cacheValue));
      return cacheValue;
    }

    console.log('[vibecheck] vibeCheck failed or returned empty synthesis:', result);
    return { synthesis: "", subject: "" };
  } catch (error) {
    console.error('[vibecheck] Synthesis error:', error);
    return { synthesis: "", subject: "" };
  }
}

export async function synthesizeNewsletterVibeCheck(
  contextUserId: string,
  targetUserId: string,
  opts?: {
    initiatorId?: string;
    intentIds?: string[];
    indexIds?: string[];
    vibeOptions?: SynthesisOptions;
  }
): Promise<{ synthesis: string; subject: string }> {
  // Reuse logic from synthesizeVibeCheck but call vibeCheckNewsletter
  // To avoid code duplication we could abstract the preparation logic, but for now copying is safer 
  // and allows for divergence if needed (which is often the case for newsletters).

  try {
    const { initiatorId, intentIds, indexIds, vibeOptions } = opts || {};

    console.log('[newsletter-vibecheck] Starting synthesis', { contextUserId, targetUserId, initiatorId, intentIds, indexIds });

    // Get user profiles
    const userIds = initiatorId ? [targetUserId, initiatorId] : [targetUserId];
    const users = await db
      .select({ id: usersTable.id, name: usersTable.name, intro: usersTable.intro })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds));

    if (!users.length) {
      return { synthesis: "", subject: "" };
    }

    const targetUser = users.find(u => u.id === targetUserId);
    const initiatorUser = initiatorId ? users.find(u => u.id === initiatorId) : undefined;

    if (!targetUser) {
      console.log('[newsletter-vibecheck] Target user not found:', targetUserId);
      return { synthesis: "", subject: "" };
    }

    // Get stakes connecting both users
    const stakes = await getConnectingStakes({
      authenticatedUserId: contextUserId,
      userIds: [contextUserId, targetUserId],
      requireAllUsers: true,
      indexIds,
      intentIds,
      limit: 3
    });

    if (!stakes.length) {
      console.log('[newsletter-vibecheck] No connecting stakes found');
      return { synthesis: "", subject: "" };
    }

    // Build intent pairs from stakes
    const intentPairs = stakes
      .flatMap(stake => stakeBuildPairs(stake, contextUserId, targetUserId))
      .filter(p => p !== null);

    if (!intentPairs.length) {
      console.log('[newsletter-vibecheck] No intent pairs built');
      return { synthesis: "", subject: "" };
    }

    // Prepare vibe check data
    const vibeData = {
      id: targetUser.id,
      name: targetUser.name,
      intro: targetUser.intro || "",
      intentPairs,
      initiatorName: initiatorUser?.name
    };

    // Check cache - Use a distinct prefix or key for newsletter style
    const newsletterVibeOptions = { ...vibeOptions, style: 'newsletter' };
    const cacheKey = createCacheHash({ ...vibeData, initiatorId }, newsletterVibeOptions);
    const cached = await cache.hget('synthesis', cacheKey);

    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed.synthesis === 'string' && typeof parsed.subject === 'string') {
          console.log('[newsletter-vibecheck] Returning cached synthesis');
          return parsed;
        }
      } catch { }
    }

    // Generate synthesis
    console.log('[newsletter-vibecheck] Calling vibeCheckNewsletter agent');

    // Using import from top-level (to be added)
    const result = await vibeCheckNewsletter(vibeData, vibeOptions);

    if (result.success && result.synthesis) {
      console.log('[newsletter-vibecheck] Synthesis generated successfully');
      const cacheValue = { synthesis: result.synthesis, subject: result.subject || "" };
      await cache.hset('synthesis', cacheKey, JSON.stringify(cacheValue));
      return cacheValue;
    }

    console.log('[newsletter-vibecheck] vibeCheck failed or returned empty synthesis:', result);
    return { synthesis: "", subject: "" };
  } catch (error) {
    console.error('[newsletter-vibecheck] Synthesis error:', error);
    return { synthesis: "", subject: "" };
  }
}

// ============================================================================
// INTRO: Generates introduction message between sender and recipient
// ============================================================================

export async function synthesizeIntro(
  senderUserId: string,
  recipientUserId: string,
  indexIds?: string[]
): Promise<string> {
  try {
    // Get user profiles
    const users = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(inArray(usersTable.id, [senderUserId, recipientUserId]));

    if (users.length !== 2) return "";

    const sender = users.find(u => u.id === senderUserId)!;
    const recipient = users.find(u => u.id === recipientUserId)!;

    // Get stakes connecting both users
    const stakes = await getConnectingStakes({
      authenticatedUserId: senderUserId,
      userIds: [senderUserId, recipientUserId],
      requireAllUsers: true,
      indexIds
    });

    if (!stakes.length) return "";

    // Group reasonings by user
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
    console.error('Intro synthesis error:', error);
    return "";
  }
}
