import { log } from '../../log';
import { fetchTwitterProfile, fetchTwitterTweets, fetchTwitterProfilesBulk, fetchTwitterTweetsBulk, extractTwitterUsername } from '../../snowflake';
import { addGenerateIntentsJob } from '../../queue/llm-queue';
import db from '../../db';
import { users, userIntegrations } from '../../schema';
import { eq, isNull, and, inArray } from 'drizzle-orm';

export interface TwitterSyncResult {
  intentsGenerated: number;
  locationUpdated: boolean;
  success: boolean;
  error?: string;
}

export async function syncTwitterUser(userId: string, sinceTimestamp?: Date | null, integrationId?: string): Promise<TwitterSyncResult> {
  try {
    let integration: typeof userIntegrations.$inferSelect | null = null;
    let username: string | null = null;

    // Try to get integration record if integrationId provided, otherwise fetch by userId
    if (integrationId) {
      const integrationRecords = await db.select()
        .from(userIntegrations)
        .where(
          and(
            eq(userIntegrations.id, integrationId),
            eq(userIntegrations.userId, userId),
            eq(userIntegrations.integrationType, 'twitter'),
            isNull(userIntegrations.deletedAt)
          )
        )
        .limit(1);
      
      if (integrationRecords.length > 0) {
        integration = integrationRecords[0];
        username = (integration.config as any)?.twitter?.username || null;
      }
    } else {
      // Fallback: fetch integration by userId
      const integrationRecords = await db.select()
        .from(userIntegrations)
        .where(
          and(
            eq(userIntegrations.userId, userId),
            eq(userIntegrations.integrationType, 'twitter'),
            isNull(userIntegrations.indexId),
            isNull(userIntegrations.deletedAt)
          )
        )
        .limit(1);
      
      if (integrationRecords.length > 0) {
        integration = integrationRecords[0];
        username = (integration.config as any)?.twitter?.username || null;
      }
    }

    // Fallback: if no integration found, check socials.x
    if (!username) {
      const userRecords = await db.select()
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .limit(1);

      if (userRecords.length === 0) {
        return { intentsGenerated: 0, locationUpdated: false, success: false, error: 'User not found' };
      }

      const user = userRecords[0];
      const twitterUrl = user.socials?.x;

      if (!twitterUrl) {
        return { intentsGenerated: 0, locationUpdated: false, success: false, error: 'No Twitter URL found' };
      }

      username = extractTwitterUsername(twitterUrl);
      if (!username) {
        return { intentsGenerated: 0, locationUpdated: false, success: false, error: 'Invalid Twitter username format' };
      }
    }

    // Get user from database
    const userRecords = await db.select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (userRecords.length === 0) {
      return { intentsGenerated: 0, locationUpdated: false, success: false, error: 'User not found' };
    }

    const user = userRecords[0];

    // Determine sync behavior:
    // - If sinceTimestamp is null (profile update): fetch all tweets (no timestamp filter)
    // - If sinceTimestamp is provided: use it (explicit timestamp)
    // - Otherwise: use integration's lastSyncAt if available, or undefined (fetch all for first sync)
    let syncSince: Date | undefined;
    let fetchAllTweets = false;
    
    if (sinceTimestamp === null) {
      // Profile update scenario - fetch all tweets
      fetchAllTweets = true;
      syncSince = undefined;
      log.info('Syncing Twitter user (profile update, fetching all tweets)', { userId, username });
    } else if (sinceTimestamp) {
      // Explicit timestamp provided
      syncSince = sinceTimestamp;
      log.info('Syncing Twitter user', { userId, username, syncSince: syncSince.toISOString() });
    } else {
      // Worker mode: always use integration's lastSyncAt if available
      if (integration?.lastSyncAt) {
        syncSince = new Date(integration.lastSyncAt);
        log.info('Syncing Twitter user (using lastSyncAt)', { userId, username, syncSince: syncSince.toISOString() });
      } else {
        // First sync: fetch all tweets
        fetchAllTweets = true;
        syncSince = undefined;
        log.info('Syncing Twitter user (first sync, fetching all tweets)', { userId, username });
      }
    }

    // Fetch profile from Snowflake
    const profile = await fetchTwitterProfile(username);
    if (!profile) {
      return { intentsGenerated: 0, locationUpdated: false, success: false, error: 'Profile not found in Snowflake' };
    }

    log.info('Twitter profile fetched', { 
      username, 
      profileId: profile.ID,
      displayName: profile.DISPLAY_NAME,
      hasLocation: !!profile.LOCATION,
      hasBio: !!profile.BIO
    });

    // Update location if user hasn't manually set it (only if location is empty)
    let locationUpdated = false;
    if (profile.LOCATION && !user.location) {
      await db.update(users)
        .set({ location: profile.LOCATION, updatedAt: new Date() })
        .where(eq(users.id, userId));
      locationUpdated = true;
      log.info('Updated user location from Twitter', { userId, location: profile.LOCATION });
    }

    // Fetch tweets
    // For profile updates: fetch all tweets, no timestamp filter
      // Otherwise: use syncSince timestamp filter
      const tweets = await fetchTwitterTweets(profile.ID, 100, fetchAllTweets ? undefined : syncSince, false);
      if (tweets.length === 0) {
      return { intentsGenerated: 0, locationUpdated, success: true };
    }


    // Prepare tweet objects for intent generation
    const tweetObjects = tweets.map(tweet => ({
      text: tweet.TEXT,
      timestamp: tweet.TIMESTAMP,
      likes: tweet.LIKES,
      reposts: tweet.REPOSTS,
      views: tweet.VIEWS,
    }));

    // Generate intents from tweets
    await addGenerateIntentsJob({
      userId,
      sourceId: userId, // Use userId as sourceId for social-generated intents
      sourceType: 'integration',
      objects: tweetObjects,
      instruction: 'Generate intents from Twitter tweets',
    }, 6);

    // Update integration's lastSyncAt
    if (integration) {
      await db.update(userIntegrations)
        .set({ lastSyncAt: new Date() })
        .where(eq(userIntegrations.id, integration.id));
    }

    log.info('Twitter sync complete', { userId, username, tweetsProcessed: tweets.length, locationUpdated });

    return {
      intentsGenerated: 1, // Job queued, actual count will be determined by processor
      locationUpdated,
      success: true,
    };
  } catch (error) {
    log.error('Twitter sync error', { userId, error: (error as Error).message });
    return {
      intentsGenerated: 0,
      locationUpdated: false,
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Sync multiple Twitter users in bulk (optimized for batch processing)
 * Fetches profiles and tweets for all users in one query each
 * @param integrationBatch Array of integration records with joined user records (from syncAllTwitterUsers)
 * @param sinceTimestamp Optional explicit timestamp (if provided, overrides lastSyncAt)
 */
export async function syncTwitterUsersBulk(
  integrationBatch: Array<{ integration: typeof userIntegrations.$inferSelect; user: typeof users.$inferSelect }>,
  sinceTimestamp?: Date
): Promise<{ usersProcessed: number; intentsGenerated: number; locationUpdated: number; errors: number }> {
  const stats = {
    usersProcessed: 0,
    intentsGenerated: 0,
    locationUpdated: 0,
    errors: 0,
  };

  try {
    // Extract usernames and create mapping
    const usernameToData = new Map<string, { user: typeof users.$inferSelect; integration: typeof userIntegrations.$inferSelect; lastSyncAt?: Date; fetchAll?: boolean }>();
    const usernames: string[] = [];

    for (const { integration, user } of integrationBatch) {
      const config = integration.config as any;
      const username = config?.twitter?.username;

      if (!username) {
        stats.errors++;
        log.warn('Twitter integration missing username in config', { userId: user.id, integrationId: integration.id });
        continue;
      }

      // Worker mode: always use integration's lastSyncAt if available
      // If explicit sinceTimestamp provided, use that instead
      let effectiveSinceTimestamp: Date | undefined;
      let fetchAll = false;
      
      if (sinceTimestamp) {
        // Explicit timestamp provided (overrides lastSyncAt)
        effectiveSinceTimestamp = sinceTimestamp;
      } else if (integration.lastSyncAt) {
        // Use integration's lastSyncAt (incremental sync)
        effectiveSinceTimestamp = new Date(integration.lastSyncAt);
      } else {
        // First sync: fetch all tweets
        fetchAll = true;
        effectiveSinceTimestamp = undefined;
      }

      usernameToData.set(username, { user, integration, lastSyncAt: effectiveSinceTimestamp, fetchAll });
      usernames.push(username);
    }

    if (usernames.length === 0) {
      return stats;
    }

    // Group integrations by sync timestamp for efficient bulk fetching
    const syncTimestampGroups = new Map<string, string[]>();
    const fetchAllUsernames: string[] = [];
    
    for (const username of usernames) {
      const data = usernameToData.get(username);
      if (!data) continue;
      
      if (data.fetchAll) {
        // First sync: fetch all tweets
        fetchAllUsernames.push(username);
      } else if (data.lastSyncAt) {
        // Incremental sync: group by timestamp
        const syncKey = data.lastSyncAt.toISOString();
        if (!syncTimestampGroups.has(syncKey)) {
          syncTimestampGroups.set(syncKey, []);
        }
        syncTimestampGroups.get(syncKey)!.push(username);
      }
    }

    log.info('Syncing Twitter users bulk', { 
      userCount: usernames.length,
      incrementalSyncGroups: syncTimestampGroups.size,
      firstSyncCount: fetchAllUsernames.length
    });

    // Fetch all profiles in one query
    const profilesMap = await fetchTwitterProfilesBulk(usernames);
    
    // Fetch tweets for incremental sync groups (by timestamp)
    const tweetsMap = new Map<string, any[]>();
    for (const [syncKey, groupUsernames] of syncTimestampGroups.entries()) {
      const sampleData = usernameToData.get(groupUsernames[0]);
      const syncSince = sampleData?.lastSyncAt;
      
      if (syncSince) {
        // Use TWITTER_TWEETS_3_DAY for worker sync
        const groupTweetsMap = await fetchTwitterTweetsBulk(groupUsernames, syncSince, 100, true);
        
        // Merge into main tweets map
        for (const [username, tweets] of groupTweetsMap.entries()) {
          tweetsMap.set(username, tweets);
        }
      }
    }
    
    // Fetch all tweets for first-time syncs (no timestamp filter)
    if (fetchAllUsernames.length > 0) {
      const fetchAllTweetsMap = await fetchTwitterTweetsBulk(fetchAllUsernames, undefined, 100, true);
      for (const [username, tweets] of fetchAllTweetsMap.entries()) {
        tweetsMap.set(username, tweets);
      }
    }

    // Process each user
    const integrationsToUpdate: Array<{ integrationId: string }> = [];
    const locationUpdates: Array<{ userId: string; location: string }> = [];
    const intentJobs: Array<{ userId: string; tweetObjects: any[] }> = [];

    for (const username of usernames) {
      const data = usernameToData.get(username);
      if (!data) continue;
      
      const { user, integration } = data;

      try {
        const profile = profilesMap.get(username);
        if (!profile) {
          stats.errors++;
          log.warn('Twitter profile not found', { userId: user.id, username });
          continue;
        }

        log.info('Processing Twitter user', { 
          userId: user.id, 
          username,
          profileId: profile.ID,
          followers: profile.FOLLOWERS_COUNT,
          tweetsCount: profile.TWEETS_COUNT
        });

        // Update location if needed
        if (profile.LOCATION && !user.location) {
          locationUpdates.push({ userId: user.id, location: profile.LOCATION });
          stats.locationUpdated++;
          log.info('Queued location update', { userId: user.id, username, location: profile.LOCATION });
        }

        // Get tweets for this user
        const tweets = tweetsMap.get(username) || [];
        
        if (tweets.length === 0) {
          // Update last sync time even if no new tweets
          integrationsToUpdate.push({ integrationId: integration.id });
          stats.usersProcessed++;
          log.info('No new tweets found', { userId: user.id, username });
          continue;
        }

        log.info('Found new tweets', { 
          userId: user.id, 
          username, 
          tweetCount: tweets.length 
        });

        // Prepare tweet objects for intent generation
        const tweetObjects = tweets.map(tweet => ({
          text: tweet.TEXT,
          timestamp: tweet.TIMESTAMP,
          likes: tweet.LIKES,
          reposts: tweet.REPOSTS,
          views: tweet.VIEWS,
        }));

        intentJobs.push({ userId: user.id, tweetObjects });
        integrationsToUpdate.push({ integrationId: integration.id });
        stats.usersProcessed++;
        log.info('Queued intent generation', { userId: user.id, username, tweetCount: tweets.length });
      } catch (error) {
        stats.errors++;
        log.error('Error processing user in bulk sync', { 
          userId: user.id, 
          username, 
          error: (error as Error).message 
        });
      }
    }

    // Batch update locations
    if (locationUpdates.length > 0) {
      for (const { userId, location } of locationUpdates) {
        try {
          await db.update(users)
            .set({ location, updatedAt: new Date() })
            .where(eq(users.id, userId));
          log.info('Updated user location', { userId, location });
        } catch (error) {
          log.error('Failed to update location', { userId, error: (error as Error).message });
        }
      }
    }

    // Queue intent generation jobs
    for (const { userId, tweetObjects } of intentJobs) {
      try {
        await addGenerateIntentsJob({
          userId,
          sourceId: userId,
          sourceType: 'integration',
          objects: tweetObjects,
          instruction: 'Generate intents from Twitter tweets',
        }, 6);
        stats.intentsGenerated++;
        log.info('Queued intent generation job', { userId, tweetCount: tweetObjects.length });
      } catch (error) {
        log.error('Failed to queue intent generation', { 
          userId, 
          error: (error as Error).message 
        });
      }
    }

    // Batch update integration lastSyncAt
    if (integrationsToUpdate.length > 0) {
      const now = new Date();
      for (const { integrationId } of integrationsToUpdate) {
        try {
          await db.update(userIntegrations)
            .set({ lastSyncAt: now })
            .where(eq(userIntegrations.id, integrationId));
        } catch (error) {
          log.error('Failed to update integration lastSyncAt', { 
            integrationId, 
            error: (error as Error).message 
          });
        }
      }
    }

    log.info('Twitter bulk sync complete', { 
      usersProcessed: stats.usersProcessed,
      intentsGenerated: stats.intentsGenerated,
      locationUpdated: stats.locationUpdated,
      errors: stats.errors
    });

    return stats;
  } catch (error) {
    log.error('Twitter bulk sync error', { error: (error as Error).message });
    return stats;
  }
}

