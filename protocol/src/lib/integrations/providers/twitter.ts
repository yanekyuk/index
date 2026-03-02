import { log } from '../../log';
import db from '../../drizzle/drizzle';
import { users, userIntegrations } from '../../../schemas/database.schema';
import { eq, isNull, and } from 'drizzle-orm';

const logger = log.lib.from("lib/integrations/providers/twitter.ts");

export interface TwitterSyncResult {
  intentsGenerated: number;
  locationUpdated: boolean;
  success: boolean;
  error?: string;
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

/**
 * Twitter sync is currently disabled (Snowflake integration removed).
 * This function is kept as a stub for interface compatibility.
 */
export async function syncTwitterUser(userId: string, sinceTimestamp?: Date | null, integrationId?: string): Promise<TwitterSyncResult> {
  logger.verbose('Twitter sync is disabled (Snowflake integration removed)', { userId });
  return {
    intentsGenerated: 0,
    locationUpdated: false,
    success: false,
    error: 'Twitter sync is disabled (Snowflake integration removed)',
  };
}

/**
 * Twitter bulk sync is currently disabled (Snowflake integration removed).
 * This function is kept as a stub for interface compatibility.
 */
export async function syncTwitterUsersBulk(
  integrationBatch: Array<{ integration: typeof userIntegrations.$inferSelect; user: typeof users.$inferSelect }>,
  sinceTimestamp?: Date
): Promise<{ usersProcessed: number; intentsGenerated: number; locationUpdated: number; errors: number }> {
  logger.verbose('Twitter bulk sync is disabled (Snowflake integration removed)', { 
    userCount: integrationBatch.length 
  });
  return {
    usersProcessed: 0,
    intentsGenerated: 0,
    locationUpdated: 0,
    errors: 0,
  };
}
