import { log } from '../log';
import { syncTwitterUser, syncTwitterUsersBulk } from './providers/twitter';
import { enrichUserProfile } from './providers/profile-enrich';
import db from '../db';
import { users } from '../schema';
import { isNotNull, isNull, and, eq } from 'drizzle-orm';
import crypto from 'crypto';

export interface SocialSyncResult {
  twitter: {
    usersProcessed: number;
    intentsGenerated: number;
    locationUpdated: number;
    errors: number;
  };
  enrichment: {
    usersProcessed: number;
    intentsGenerated: number;
    locationUpdated: number;
    errors: number;
  };
}

export async function syncAllTwitterUsers(): Promise<SocialSyncResult['twitter']> {
  const stats = {
    usersProcessed: 0,
    intentsGenerated: 0,
    locationUpdated: 0,
    errors: 0,
  };

  const BATCH_SIZE = 1000;
  const FOUR_HOURS_AGO = new Date(Date.now() - 4 * 60 * 60 * 1000);

  try {
    // Get all users with Twitter URL
    const usersWithTwitter = await db.select()
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          isNotNull(users.socials)
        )
      );

    const twitterUsers = usersWithTwitter.filter(
      user => user.socials?.x
    );

    log.info('Starting Twitter sync', { userCount: twitterUsers.length, batchSize: BATCH_SIZE });

    // Process users in batches
    for (let i = 0; i < twitterUsers.length; i += BATCH_SIZE) {
      const batch = twitterUsers.slice(i, i + BATCH_SIZE);
      log.info(`Processing Twitter sync batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(twitterUsers.length / BATCH_SIZE)}`, {
        batchStart: i + 1,
        batchEnd: Math.min(i + BATCH_SIZE, twitterUsers.length),
        totalUsers: twitterUsers.length,
      });

      // Process batch using bulk operations
      try {
        const batchResult = await syncTwitterUsersBulk(batch, FOUR_HOURS_AGO);
        stats.usersProcessed += batchResult.usersProcessed;
        stats.intentsGenerated += batchResult.intentsGenerated;
        stats.locationUpdated += batchResult.locationUpdated;
        stats.errors += batchResult.errors;
      } catch (error) {
        stats.errors += batch.length;
        log.error('Twitter sync batch error', { 
          batchStart: i + 1, 
          batchSize: batch.length,
          error: (error as Error).message 
        });
      }
    }

    log.info('Twitter sync complete', stats);
    return stats;
  } catch (error) {
    log.error('Twitter sync batch error', { error: (error as Error).message });
    return stats;
  }
}

export async function enrichAllUsers(): Promise<SocialSyncResult['enrichment']> {
  const stats = {
    usersProcessed: 0,
    intentsGenerated: 0,
    locationUpdated: 0,
    errors: 0,
  };

  try {
    // Get all users with LinkedIn or Twitter profiles for enrichment
    const usersForEnrichment = await db.select()
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          isNotNull(users.socials)
        )
      );

    const eligibleUsers = usersForEnrichment.filter(
      user => user.socials?.linkedin || user.socials?.x
    );

    log.info('Starting user enrichment', { userCount: eligibleUsers.length });

    for (const user of eligibleUsers) {
      try {
        const result = await enrichUserProfile(user.id);
        stats.usersProcessed++;
        
        if (result.success) {
          if (result.intentsGenerated > 0) stats.intentsGenerated++;
          if (result.locationUpdated) stats.locationUpdated++;
        } else {
          stats.errors++;
          log.warn('User enrichment failed', { userId: user.id, error: result.error });
        }
      } catch (error) {
        stats.errors++;
        log.error('User enrichment error', { userId: user.id, error: (error as Error).message });
      }
    }

    log.info('User enrichment complete', stats);
    return stats;
  } catch (error) {
    log.error('User enrichment batch error', { error: (error as Error).message });
    return stats;
  }
}

export async function syncAllSocialMedia(): Promise<SocialSyncResult> {
  log.info('Starting full social media sync');

  const [twitter, enrichment] = await Promise.all([
    syncAllTwitterUsers(),
    enrichAllUsers(),
  ]);

  return {
    twitter,
    enrichment,
  };
}


/**
 * Trigger social media sync when user updates their socials field
 * This runs asynchronously and doesn't block the API response
 */
export async function triggerSocialSync(userId: string, socialType: 'twitter' | 'enrichment'): Promise<void> {
  // Run syncs asynchronously without blocking
  setImmediate(async () => {
    try {
      if (socialType === 'twitter') {
        log.info('Triggering Twitter sync (profile update)', { userId });
        // For profile update trigger, fetch all tweets (no timestamp filter)
        await syncTwitterUser(userId, null);
      } else if (socialType === 'enrichment') {
        log.info('Triggering enrichment sync', { userId });
        await enrichUserProfile(userId); // Includes intro generation and intent generation from biography
      }
    } catch (error) {
      log.error('Social sync trigger error', { userId, socialType, error: (error as Error).message });
    }
  });
}

/**
 * Generate hash for name+email combination to track enrichment per parameter set
 */
function generateEnrichmentHash(name: string, email: string): string {
  return crypto.createHash('sha256')
    .update(`${name}:${email}`)
    .digest('hex');
}

/**
 * Check if user meets enrichment criteria and trigger enrichment
 * - Don't enrich if user has customized their intro
 * - Only enrich once per name+email combination
 * This runs asynchronously and doesn't block the API response
 */
export async function checkAndTriggerEnrichment(userId: string): Promise<void> {
  // Run check asynchronously without blocking
  setImmediate(async () => {
    try {
      // Fetch current user state from database
      const userRecords = await db.select({
        name: users.name,
        email: users.email,
        intro: users.intro,
        onboarding: users.onboarding,
      })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .limit(1);

      if (userRecords.length === 0) {
        log.warn('User not found for enrichment check', { userId });
        return;
      }

      const user = userRecords[0];
      
      // Don't enrich if user has customized their intro
      if (user.intro) {
        log.info('User has customized intro, skipping enrichment', { userId });
        return;
      }

      // Check if enrichment condition is met: name exists AND email exists
      if (!user.name || !user.email) {
        log.info('Enrichment condition not met: missing name or email', { userId });
        return;
      }

      // Generate hash for current name+email combination
      const currentHash = generateEnrichmentHash(user.name, user.email);
      
      // Get existing enrichment hash from onboarding
      const onboarding = (user.onboarding || {}) as any;
      const existingHash = onboarding.enrichmentHash;
      
      // Only enrich if we haven't enriched for this name+email combination before
      if (existingHash === currentHash) {
        log.info('Enrichment already done for this name+email combination', { userId, hash: currentHash });
        return;
      }

      // Update enrichment hash atomically
      // Note: Multiple processes might update simultaneously, so we'll verify after update
      await db.update(users)
        .set({
          onboarding: {
            ...onboarding,
            enrichmentHash: currentHash,
          },
        })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)));
      
      // Re-fetch immediately to check if hash was successfully set
      // This helps detect race conditions where another process might have set it first
      const verifyRecords = await db.select({
        name: users.name,
        email: users.email,
        intro: users.intro,
        onboarding: users.onboarding,
      })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .limit(1);
      
      if (verifyRecords.length === 0) {
        log.warn('User not found after hash update', { userId });
        return;
      }
      
      const verifyUser = verifyRecords[0];
      const verifyOnboarding = (verifyUser.onboarding || {}) as any;
      const verifyHash = verifyOnboarding.enrichmentHash;
      
      // Final checks before triggering enrichment:
      // 1. Hash must match what we tried to set
      // 2. Hash must have changed from what we saw initially (proves we were the one who set it)
      // 3. User still doesn't have intro (hasn't customized)
      // 4. Name and email still exist
      // This prevents duplicate enrichment if another process already enriched
      const hashWasUpdated = verifyHash === currentHash && existingHash !== currentHash;
      
      if (hashWasUpdated && !verifyUser.intro && verifyUser.name && verifyUser.email) {
        log.info('Enrichment condition met, triggering enrichment', { userId, hash: currentHash });
        await triggerSocialSync(userId, 'enrichment');
      } else {
        if (verifyHash !== currentHash) {
          log.info('Enrichment hash was updated by another process, skipping enrichment', { 
            userId, 
            expectedHash: currentHash,
            actualHash: verifyHash 
          });
        } else if (!hashWasUpdated && existingHash === currentHash) {
          log.info('Enrichment hash was already set before update, skipping enrichment', { userId, hash: currentHash });
        } else if (verifyUser.intro) {
          log.info('User customized intro during enrichment check, skipping enrichment', { userId });
        } else {
          log.info('Enrichment condition no longer met, skipping enrichment', { userId });
        }
      }
    } catch (error) {
      log.error('Enrichment check error', { userId, error: (error as Error).message });
    }
  });
}

/**
 * Check if socials field changed and trigger appropriate syncs
 * Twitter sync is triggered when Twitter changes
 * Enrichment is checked when socials are updated (but triggered based on name/email/intro condition)
 */
export function checkAndTriggerSocialSync(
  userId: string,
  oldSocials: { x?: string; linkedin?: string } | null,
  newSocials: { x?: string; linkedin?: string } | null
): void {
  if (!oldSocials && !newSocials) return;

  const oldTwitter = oldSocials?.x;
  const newTwitter = newSocials?.x;

  // Check if Twitter changed - only trigger Twitter sync on Twitter changes
  if (newTwitter && newTwitter !== oldTwitter) {
    triggerSocialSync(userId, 'twitter');
  }

  // Check enrichment eligibility when socials are updated
  // (enrichment triggers based on name/email/intro condition, not social changes)
  checkAndTriggerEnrichment(userId);
}

