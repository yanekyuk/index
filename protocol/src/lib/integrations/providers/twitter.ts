import { log } from '../../log';
import { fetchTwitterProfile, fetchTwitterTweets, fetchTwitterProfilesBulk, fetchTwitterTweetsBulk, extractTwitterUsername } from '../../snowflake';
import { addGenerateIntentsJob } from '../../queue/llm-queue';
import db from '../../db';
import { users } from '../../schema';
import { eq, isNull, and, inArray } from 'drizzle-orm';

export interface TwitterSyncResult {
  intentsGenerated: number;
  locationUpdated: boolean;
  success: boolean;
  error?: string;
}

export async function syncTwitterUser(userId: string, sinceTimestamp?: Date | null): Promise<TwitterSyncResult> {
  try {
    // Get user from database
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

    // Extract username from URL or handle
    const username = extractTwitterUsername(twitterUrl);
    if (!username) {
      return { intentsGenerated: 0, locationUpdated: false, success: false, error: 'Invalid Twitter username format' };
    }

    // Determine sync behavior:
    // - If sinceTimestamp is null (profile update): fetch all tweets (no timestamp filter)
    // - If sinceTimestamp is provided: use it (worker sync with 4-hour lookback)
    // - Otherwise: default to 4-hour lookback
    let syncSince: Date | undefined;
    let fetchAllTweets = false;
    
    if (sinceTimestamp === null) {
      // Profile update scenario - fetch all tweets
      fetchAllTweets = true;
      syncSince = undefined;
      log.info('Syncing Twitter user (profile update, fetching all tweets)', { userId, username });
    } else if (sinceTimestamp) {
      // Explicit timestamp provided (worker sync)
      syncSince = sinceTimestamp;
      log.info('Syncing Twitter user', { userId, username, syncSince: syncSince.toISOString() });
    } else {
      // Default: 4-hour lookback (worker sync)
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
      syncSince = fourHoursAgo;
      log.info('Syncing Twitter user (default)', { userId, username, syncSince: syncSince.toISOString() });
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
 * @param userBatch Array of user records from database (must have id, socials, location, onboarding fields)
 * @param sinceTimestamp Optional timestamp to filter tweets (defaults to 4 hours ago)
 */
export async function syncTwitterUsersBulk(
  userBatch: Array<typeof users.$inferSelect>,
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
    const usernameToUser = new Map<string, typeof userBatch[0]>();
    const usernames: string[] = [];

    for (const user of userBatch) {
      const twitterUrl = user.socials?.x;
      if (!twitterUrl) continue;

      const username = extractTwitterUsername(twitterUrl);
      if (!username) continue;

      usernameToUser.set(username, user);
      usernames.push(username);
    }

    if (usernames.length === 0) {
      return stats;
    }

    log.info('Syncing Twitter users bulk', { 
      userCount: usernames.length, 
      syncSince: sinceTimestamp?.toISOString() 
    });

    // Fetch all profiles in one query
    const profilesMap = await fetchTwitterProfilesBulk(usernames);
    
    // Determine sync timestamp (4 hours ago or sinceTimestamp)
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const syncSince = sinceTimestamp || fourHoursAgo;

    // Fetch all tweets in one query
    // Use TWITTER_TWEETS_3_DAY for worker sync
    const tweetsMap = await fetchTwitterTweetsBulk(usernames, syncSince, 100, true);

    // Process each user
    const userIdsToUpdate: string[] = [];
    const locationUpdates: Array<{ userId: string; location: string }> = [];
    const intentJobs: Array<{ userId: string; tweetObjects: any[] }> = [];

    for (const username of usernames) {
      const user = usernameToUser.get(username);
      if (!user) continue;

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
          userIdsToUpdate.push(user.id);
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
        userIdsToUpdate.push(user.id);
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

