import snowflake from 'snowflake-sdk';
import { log } from './log';

snowflake.configure({ logLevel: 'ERROR' });

// Suppress Snowflake SDK info logs by overriding console methods temporarily
const originalConsoleInfo = console.info;
const originalConsoleLog = console.log;
let snowflakeLoggingSuppressed = false;

function suppressSnowflakeLogs() {
  if (snowflakeLoggingSuppressed) return;
  snowflakeLoggingSuppressed = true;
  
  console.info = (...args: any[]) => {
    const message = args[0]?.toString() || '';
    // Only suppress Snowflake SDK connection logs
    if (message.includes('Creating new connection object') || 
        message.includes('Creating Connection') ||
        message.includes('Connection[') ||
        message.includes('Trying to initialize Easy Logging') ||
        message.includes('No client config detected') ||
        message.includes('Easy Logging')) {
      return;
    }
    originalConsoleInfo.apply(console, args);
  };
  
  console.log = (...args: any[]) => {
    const message = args[0]?.toString() || '';
    if (message.includes('[level:"INFO"') && message.includes('snowflake')) {
      return;
    }
    originalConsoleLog.apply(console, args);
  };
}

// Suppress logs immediately
suppressSnowflakeLogs();

const SNOWFLAKE_ACCOUNT = process.env.SNOWFLAKE_ACCOUNT || '';
const SNOWFLAKE_USERNAME = process.env.SNOWFLAKE_USERNAME || '';
const SNOWFLAKE_PASSWORD = process.env.SNOWFLAKE_PASSWORD || '';
const SNOWFLAKE_WAREHOUSE = process.env.SNOWFLAKE_WAREHOUSE || 'twitter_index';
const SNOWFLAKE_DATABASE = process.env.SNOWFLAKE_DATABASE || 'DATA_COLLECTOR_ICEBERG';
const SNOWFLAKE_SCHEMA = process.env.SNOWFLAKE_SCHEMA || 'PUBLIC';

type SnowflakeConnection = any;

function createConnection(): Promise<SnowflakeConnection> {
  return new Promise((resolve, reject) => {
    const connection = snowflake.createConnection({
      account: SNOWFLAKE_ACCOUNT,
      username: SNOWFLAKE_USERNAME,
      password: SNOWFLAKE_PASSWORD,
      warehouse: SNOWFLAKE_WAREHOUSE,
      database: SNOWFLAKE_DATABASE,
      schema: SNOWFLAKE_SCHEMA,
    });

    connection.connect((err: any, conn: any) => {
      if (err) {
        log.error('Snowflake connection error', { error: err.message });
        reject(err);
        return;
      }
      resolve(conn);
    });
  });
}

function executeQuery<T>(connection: SnowflakeConnection, sqlText: string, binds?: any[]): Promise<T[]> {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText,
      binds,
      complete: (err: any, stmt: any, rows: any) => {
        if (err) {
          log.error('Snowflake query error', { error: err.message, sqlText });
          reject(err);
          return;
        }
        resolve(rows || []);
      },
    });
  });
}

/**
 * Extract Twitter username from various formats:
 * - https://x.com/username
 * - https://twitter.com/username
 * - @username
 * - username
 */
export function extractTwitterUsername(input: string): string | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();

  // Handle URL formats
  const urlMatch = trimmed.match(/(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/([a-zA-Z0-9_]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  // Handle @username format
  if (trimmed.startsWith('@')) {
    return trimmed.substring(1);
  }

  // Handle plain username (alphanumeric and underscores only)
  if (/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export interface TwitterProfile {
  ID: string;
  NAME: string;           // Twitter handle/username
  DISPLAY_NAME?: string;  // Display name
  BIO?: string;           // Biography
  LOCATION?: string;
  FOLLOWING_COUNT?: number;
  FOLLOWERS_COUNT?: number;
  TWEETS_COUNT?: number;
}

export interface TwitterTweet {
  ID: string;
  POSTER_ID: string;
  TEXT: string;
  TIMESTAMP: Date | string;
  LIKES?: number;
  REPOSTS?: number;
  VIEWS?: number;
}

/**
 * Fetch Twitter profile from Snowflake by username
 */
export async function fetchTwitterProfile(username: string): Promise<TwitterProfile | null> {
  if (!SNOWFLAKE_ACCOUNT || !SNOWFLAKE_USERNAME || !SNOWFLAKE_PASSWORD) {
    return null;
  }

  let connection: SnowflakeConnection | null = null;

  try {
    connection = await createConnection();


    // Query using actual schema columns
    const sqlText = `
      SELECT ID, NAME, DISPLAY_NAME, BIO, LOCATION, 
             FOLLOWING_COUNT, FOLLOWERS_COUNT, TWEETS_COUNT
      FROM twitter_profiles
      WHERE name = ?
      LIMIT 1
    `;

    const rows = await executeQuery<TwitterProfile>(connection, sqlText, [username]);

    if (rows.length === 0) {
      return null;
    }

    return rows[0];
  } catch (error) {
    log.error('Failed to fetch Twitter profile', { username, error: (error as Error).message });
    return null;
  } finally {
    if (connection) {
      connection.destroy((err: any) => {
        if (err) log.error('Error destroying Snowflake connection', { error: err.message });
      });
    }
  }
}

/**
 * Fetch Twitter profiles from Snowflake by usernames (bulk)
 * @param usernames Array of Twitter usernames
 * @returns Map of username -> TwitterProfile
 */
export async function fetchTwitterProfilesBulk(usernames: string[]): Promise<Map<string, TwitterProfile>> {
  const profileMap = new Map<string, TwitterProfile>();
  
  if (!SNOWFLAKE_ACCOUNT || !SNOWFLAKE_USERNAME || !SNOWFLAKE_PASSWORD || usernames.length === 0) {
    return profileMap;
  }

  let connection: SnowflakeConnection | null = null;

  try {
    connection = await createConnection();

    // Build IN clause with placeholders
    const placeholders = usernames.map(() => '?').join(',');
    const sqlText = `
      SELECT ID, NAME, DISPLAY_NAME, BIO, LOCATION, 
             FOLLOWING_COUNT, FOLLOWERS_COUNT, TWEETS_COUNT
      FROM twitter_profiles
      WHERE name IN (${placeholders})
    `;

    const rows = await executeQuery<TwitterProfile>(connection, sqlText, usernames);

    // Map results by username (NAME field)
    for (const profile of rows) {
      profileMap.set(profile.NAME, profile);
    }

    log.info('Fetched Twitter profiles bulk', { requested: usernames.length, found: rows.length });
    return profileMap;
  } catch (error) {
    log.error('Failed to fetch Twitter profiles bulk', { usernameCount: usernames.length, error: (error as Error).message });
    return profileMap;
  } finally {
    if (connection) {
      connection.destroy((err: any) => {
        if (err) log.error('Error destroying Snowflake connection', { error: err.message });
      });
    }
  }
}

/**
 * Fetch recent tweets from Snowflake by user ID
 * @param posterId Twitter user ID
 * @param limit Maximum number of tweets to fetch
 * @param sinceTimestamp Optional timestamp to filter tweets (only fetch tweets after this time)
 * @param useWorkerTable If true, uses TWITTER_TWEETS_3_DAY table (for worker sync), otherwise uses TWITTER_TWEETS (for initial sync)
 */
export async function fetchTwitterTweets(
  posterId: string, 
  limit: number = 50,
  sinceTimestamp?: Date,
  useWorkerTable: boolean = false
): Promise<TwitterTweet[]> {
  if (!SNOWFLAKE_ACCOUNT || !SNOWFLAKE_USERNAME || !SNOWFLAKE_PASSWORD) {
    return [];
  }

  let connection: SnowflakeConnection | null = null;

  try {
    connection = await createConnection();

    // Choose table based on sync type
    const tableName = useWorkerTable ? 'TWITTER_TWEETS_3_DAY' : 'TWITTER_TWEETS';

    // Build query with optional timestamp filter
    let sqlText = `
      SELECT ID, POSTER_ID, TEXT, TIMESTAMP, LIKES, REPOSTS, VIEWS
      FROM ${tableName}
      WHERE POSTER_ID = ?
    `;
    const params: any[] = [posterId];

    if (sinceTimestamp) {
      const unixTimestamp = Math.floor(sinceTimestamp.getTime() / 1000);
      sqlText += ` AND TIMESTAMP >= ${unixTimestamp}`;
    }

    sqlText += ` ORDER BY TIMESTAMP DESC LIMIT ?`;
    params.push(limit);

    const rows = await executeQuery<TwitterTweet>(connection, sqlText, params);

    return rows;
  } catch (error) {
    log.error('Failed to fetch Twitter tweets', { posterId, error: (error as Error).message });
    return [];
  } finally {
    if (connection) {
      connection.destroy((err: any) => {
        if (err) log.error('Error destroying Snowflake connection', { error: err.message });
      });
    }
  }
}

/**
 * Fetch recent tweets from Snowflake for multiple users (bulk)
 * Uses a subquery with twitter_profiles to match by username
 * @param usernames Array of Twitter usernames
 * @param sinceTimestamp Optional timestamp to filter tweets (only fetch tweets after this time)
 * @param limitPerUser Maximum number of tweets per user
 * @param useWorkerTable If true, uses TWITTER_TWEETS_3_DAY table (for worker sync), otherwise uses TWITTER_TWEETS (for initial sync)
 * @returns Map of username -> TwitterTweet[]
 */
export async function fetchTwitterTweetsBulk(
  usernames: string[],
  sinceTimestamp?: Date,
  limitPerUser: number = 100,
  useWorkerTable: boolean = false
): Promise<Map<string, TwitterTweet[]>> {
  const tweetsMap = new Map<string, TwitterTweet[]>();
  
  if (!SNOWFLAKE_ACCOUNT || !SNOWFLAKE_USERNAME || !SNOWFLAKE_PASSWORD || usernames.length === 0) {
    return tweetsMap;
  }

  let connection: SnowflakeConnection | null = null;

  try {
    connection = await createConnection();

    // Choose table based on sync type
    const tableName = useWorkerTable ? 'TWITTER_TWEETS_3_DAY' : 'TWITTER_TWEETS';

    // Build query using subquery to match usernames to poster IDs
    // Use ROW_NUMBER() to limit tweets per user
    const placeholders = usernames.map(() => '?').join(',');
    let sqlText = `
      WITH ranked_tweets AS (
        SELECT 
          t.ID, 
          t.POSTER_ID, 
          t.TEXT, 
          t.TIMESTAMP, 
          t.LIKES, 
          t.REPOSTS, 
          t.VIEWS,
          p.NAME as USERNAME,
          ROW_NUMBER() OVER (PARTITION BY t.POSTER_ID ORDER BY t.TIMESTAMP DESC) as rn
        FROM ${tableName} t
        INNER JOIN twitter_profiles p ON t.POSTER_ID = p.ID
        WHERE p.NAME IN (${placeholders})
    `;
    const params: any[] = [...usernames];

    if (sinceTimestamp) {
      const unixTimestamp = Math.floor(sinceTimestamp.getTime() / 1000);
      sqlText += ` AND t.TIMESTAMP >= ${unixTimestamp}`;
    }

    sqlText += `
      )
      SELECT ID, POSTER_ID, TEXT, TIMESTAMP, LIKES, REPOSTS, VIEWS, USERNAME
      FROM ranked_tweets
      WHERE rn <= ?
      ORDER BY USERNAME, TIMESTAMP DESC
    `;
    params.push(limitPerUser);

    const rows = await executeQuery<any>(connection, sqlText, params);

    // Group tweets by username
    for (const row of rows) {
      const username = row.USERNAME;
      if (!tweetsMap.has(username)) {
        tweetsMap.set(username, []);
      }
      tweetsMap.get(username)!.push({
        ID: row.ID,
        POSTER_ID: row.POSTER_ID,
        TEXT: row.TEXT,
        TIMESTAMP: row.TIMESTAMP,
        LIKES: row.LIKES,
        REPOSTS: row.REPOSTS,
        VIEWS: row.VIEWS,
      });
    }

    log.info('Fetched Twitter tweets bulk', { 
      requestedUsers: usernames.length, 
      usersWithTweets: tweetsMap.size,
      totalTweets: rows.length 
    });
    return tweetsMap;
  } catch (error) {
    log.error('Failed to fetch Twitter tweets bulk', { 
      usernameCount: usernames.length, 
      error: (error as Error).message 
    });
    return tweetsMap;
  } finally {
    if (connection) {
      connection.destroy((err: any) => {
        if (err) log.error('Error destroying Snowflake connection', { error: err.message });
      });
    }
  }
}
