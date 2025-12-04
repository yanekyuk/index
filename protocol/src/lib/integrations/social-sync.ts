import { log } from '../log';
import { syncTwitterUser, syncTwitterUsersBulk } from './providers/twitter';
import db from '../db';
import { users, userIntegrations } from '../schema';
import { isNotNull, isNull, and, eq } from 'drizzle-orm';
import { extractTwitterUsername } from '../snowflake';
import { IntegrationConfigType } from '../schema';

export interface SocialSyncResult {
  twitter: {
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

  try {
    // Get all Twitter integrations (connected, not deleted)
    const twitterIntegrations = await db.select({
      integration: userIntegrations,
      user: users,
    })
      .from(userIntegrations)
      .innerJoin(users, eq(userIntegrations.userId, users.id))
      .where(
        and(
          eq(userIntegrations.integrationType, 'twitter'),
          eq(userIntegrations.status, 'connected'),
          isNull(userIntegrations.indexId), // Twitter is user-level
          isNull(userIntegrations.deletedAt),
          isNull(users.deletedAt)
        )
      );

    log.info('Starting Twitter sync', { userCount: twitterIntegrations.length, batchSize: BATCH_SIZE });

    // Process integrations in batches
    for (let i = 0; i < twitterIntegrations.length; i += BATCH_SIZE) {
      const batch = twitterIntegrations.slice(i, i + BATCH_SIZE);
      log.info(`Processing Twitter sync batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(twitterIntegrations.length / BATCH_SIZE)}`, {
        batchStart: i + 1,
        batchEnd: Math.min(i + BATCH_SIZE, twitterIntegrations.length),
        totalUsers: twitterIntegrations.length,
      });

      // Process batch using bulk operations
      // Pass undefined to use each integration's lastSyncAt
      try {
        const batchResult = await syncTwitterUsersBulk(batch, undefined);
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

export async function syncAllSocialMedia(): Promise<SocialSyncResult> {
  log.info('Starting full social media sync');

  const twitter = await syncAllTwitterUsers();

  return {
    twitter,
  };
}


/**
 * Trigger social media sync when user updates their socials field
 * This runs asynchronously and doesn't block the API response
 */
export async function triggerSocialSync(userId: string): Promise<void> {
  // Run syncs asynchronously without blocking
  setImmediate(async () => {
    try {
      log.info('Triggering Twitter sync (profile update)', { userId });
      // For profile update trigger, fetch all tweets (no timestamp filter)
      await syncTwitterUser(userId, null);
    } catch (error) {
      log.error('Social sync trigger error', { userId, error: (error as Error).message });
    }
  });
}

/**
 * Ensure Twitter integration record exists for a user
 * Creates or updates integration record when user adds/updates Twitter URL
 */
async function ensureTwitterIntegration(userId: string, twitterUrl: string): Promise<typeof userIntegrations.$inferSelect | null> {
  try {
    const username = extractTwitterUsername(twitterUrl);
    if (!username) {
      log.warn('Invalid Twitter URL format', { userId, twitterUrl });
      return null;
    }

    // Check if integration record already exists
    const existing = await db.select()
      .from(userIntegrations)
      .where(
        and(
          eq(userIntegrations.userId, userId),
          eq(userIntegrations.integrationType, 'twitter'),
          isNull(userIntegrations.indexId), // Twitter is user-level, not index-level
          isNull(userIntegrations.deletedAt)
        )
      )
      .limit(1);

    const config: IntegrationConfigType = {
      twitter: { username }
    };

    if (existing.length > 0) {
      // Update existing integration
      const [updated] = await db.update(userIntegrations)
        .set({
          config,
          status: 'connected',
          updatedAt: new Date(),
          deletedAt: null, // Restore if it was soft-deleted
        })
        .where(eq(userIntegrations.id, existing[0].id))
        .returning();

      log.info('Updated Twitter integration', { userId, integrationId: updated.id, username });
      return updated;
    } else {
      // Create new integration
      const [created] = await db.insert(userIntegrations)
        .values({
          userId,
          integrationType: 'twitter',
          status: 'connected',
          config,
          connectedAt: new Date(),
        })
        .returning();

      log.info('Created Twitter integration', { userId, integrationId: created.id, username });
      return created;
    }
  } catch (error) {
    log.error('Failed to ensure Twitter integration', { userId, error: (error as Error).message });
    return null;
  }
}

/**
 * Check if socials field changed and trigger appropriate syncs
 * Twitter sync is triggered when Twitter changes
 */
export function checkAndTriggerSocialSync(
  userId: string,
  oldSocials: { x?: string; linkedin?: string } | null,
  newSocials: { x?: string; linkedin?: string } | null
): void {
  if (!oldSocials && !newSocials) return;

  const oldTwitter = oldSocials?.x;
  const newTwitter = newSocials?.x;

  // Handle Twitter integration record creation/update/deletion
  setImmediate(async () => {
    try {
      if (newTwitter && newTwitter !== oldTwitter) {
        // Twitter URL added or changed - create/update integration record
        await ensureTwitterIntegration(userId, newTwitter);
        triggerSocialSync(userId);
      } else if (!newTwitter && oldTwitter) {
        // Twitter URL removed - soft-delete integration record
        await db.update(userIntegrations)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(userIntegrations.userId, userId),
              eq(userIntegrations.integrationType, 'twitter'),
              isNull(userIntegrations.indexId),
              isNull(userIntegrations.deletedAt)
            )
          );
        log.info('Soft-deleted Twitter integration', { userId });
      }
    } catch (error) {
      log.error('Error managing Twitter integration', { userId, error: (error as Error).message });
    }
  });
}

/**
 * Migrate existing users with Twitter URLs to create integration records
 * This should be run once to migrate existing data
 */
export async function migrateTwitterUsersToIntegrations(): Promise<{ migrated: number; errors: number }> {
  let migrated = 0;
  let errors = 0;

  try {
    log.info('Starting Twitter users migration to integrations');

    // Get all users with Twitter URL
    const allUsersWithTwitter = await db.select({
      id: users.id,
      socials: users.socials,
    })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          isNotNull(users.socials)
        )
      );

    // Get all existing Twitter integrations
    const existingIntegrations = await db.select({
      userId: userIntegrations.userId,
    })
      .from(userIntegrations)
      .where(
        and(
          eq(userIntegrations.integrationType, 'twitter'),
          isNull(userIntegrations.indexId),
          isNull(userIntegrations.deletedAt)
        )
      );

    const existingUserIds = new Set(existingIntegrations.map(i => i.userId));

    // Filter users who have Twitter URL but no integration
    const usersToMigrate = allUsersWithTwitter.filter(
      (row) => row.socials && (row.socials as any).x && !existingUserIds.has(row.id)
    );

    log.info('Found users to migrate', { count: usersToMigrate.length });

    for (const row of usersToMigrate) {
      try {
        const twitterUrl = row.socials?.x;
        if (!twitterUrl) continue;
        const integration = await ensureTwitterIntegration(row.id, twitterUrl);
        if (integration) {
          migrated++;
          if (migrated % 100 === 0) {
            log.info('Migration progress', { migrated, total: usersToMigrate.length });
          }
        } else {
          errors++;
        }
      } catch (error) {
        errors++;
        log.error('Migration error for user', { userId: row.id, error: (error as Error).message });
      }
    }

    log.info('Twitter users migration complete', { migrated, errors, total: usersToMigrate.length });
    return { migrated, errors };
  } catch (error) {
    log.error('Twitter users migration failed', { error: (error as Error).message });
    return { migrated, errors };
  }
}
