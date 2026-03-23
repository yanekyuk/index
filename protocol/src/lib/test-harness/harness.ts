/**
 * Test harness factory for integration and E2E tests.
 * Provides a real database connection, embedder, and cache wired against
 * DATABASE_TEST_URL (or DATABASE_URL + "_test" as fallback).
 */

import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";

import * as schema from "../../schemas/database.schema";
import { EmbedderAdapter } from "../../adapters/embedder.adapter";
import { RedisCacheAdapter } from "../../adapters/cache.adapter";
import type { Cache } from "../protocol/interfaces/cache.interface";

export type TestDB = PostgresJsDatabase<typeof schema>;

/**
 * All resources exposed by the test harness.
 * Call `setup()` before any test and `teardown()` after.
 */
export interface TestHarness {
  /** Drizzle database client wired to the test database. */
  db: TestDB;
  /** Embedder adapter for generating vectors. */
  embedder: EmbedderAdapter;
  /** Cache adapter. */
  cache: Cache;
  /**
   * Initialises the database connection and adapters.
   * @throws If neither DATABASE_TEST_URL nor DATABASE_URL is set.
   */
  setup(): Promise<void>;
  /**
   * Truncates all public tables (excluding Drizzle migration tracking).
   * Safe to call between test cases to reset state.
   */
  reset(): Promise<void>;
  /**
   * Closes the database connection and marks the harness as torn down.
   */
  teardown(): Promise<void>;
}

/**
 * Creates a test harness with lazy initialisation.
 * Resources are not created until `setup()` is called.
 *
 * @example
 * ```typescript
 * const harness = createTestHarness();
 * beforeAll(() => harness.setup());
 * afterAll(() => harness.teardown());
 * ```
 */
export function createTestHarness(): TestHarness {
  let pgClient: ReturnType<typeof postgres> | undefined;
  let testDb: TestDB | undefined;
  let embedder: EmbedderAdapter | undefined;
  let cache: RedisCacheAdapter | undefined;
  let isSetup = false;

  return {
    get db() {
      if (!isSetup || !testDb) throw new Error("Call harness.setup() before accessing db");
      return testDb;
    },
    get embedder() {
      if (!isSetup || !embedder) throw new Error("Call harness.setup() before accessing embedder");
      return embedder;
    },
    get cache() {
      if (!isSetup || !cache) throw new Error("Call harness.setup() before accessing cache");
      return cache;
    },

    async setup() {
      const testUrl =
        process.env.DATABASE_TEST_URL ??
        (process.env.DATABASE_URL ? process.env.DATABASE_URL + "_test" : undefined);

      if (!testUrl) {
        throw new Error("Neither DATABASE_TEST_URL nor DATABASE_URL is set");
      }

      pgClient = postgres(testUrl, { prepare: false });
      testDb = drizzle(pgClient, { schema });
      embedder = new EmbedderAdapter();
      cache = new RedisCacheAdapter();
      isSetup = true;

      // Verify connection
      await testDb.execute(sql.raw("SELECT 1"));
    },

    async reset() {
      if (!isSetup || !testDb) return;
      await testDb.execute(sql.raw(`
        DO $$
        DECLARE
          tbl text;
        BEGIN
          FOR tbl IN
            SELECT tablename FROM pg_tables
            WHERE schemaname = 'public'
              AND tablename NOT LIKE '__drizzle%'
          LOOP
            EXECUTE format('TRUNCATE TABLE %I CASCADE', tbl);
          END LOOP;
        END
        $$;
      `));
    },

    async teardown() {
      if (!isSetup || !pgClient) return;
      await pgClient.end();
      isSetup = false;
    },
  };
}
