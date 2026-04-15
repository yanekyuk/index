/**
 * Bun test preload script — runs before any test module is evaluated.
 *
 * Bun auto-loads .env.test (via NODE_ENV=test) which contains a stale test
 * database URL. Integration tests that need a fully-migrated database must use
 * the development database instead. Override DATABASE_URL here so that drizzle
 * picks up the correct connection string when its module is first imported.
 */
import { config } from 'dotenv';

config({ path: '.env.development', override: true });
