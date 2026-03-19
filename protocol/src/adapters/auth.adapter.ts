import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sql } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { ensurePersonalIndex } from './database.adapter';

/**
 * Database adapter for Better Auth integration.
 * Wraps the default Drizzle adapter with ghost-claim-via-upsert behavior:
 * when a real user signs up with an email belonging to a ghost user,
 * the ghost row is converted in-place instead of creating a new row.
 */
export class AuthDatabaseAdapter {
  /**
   * Returns a configured drizzle adapter for Better Auth's `database` option.
   * Wraps the default adapter to intercept user creation: if a user signs up
   * with an email that belongs to a ghost, the ghost row is updated in-place
   * (isGhost=false, name/avatar updated) via ON CONFLICT DO UPDATE.
   * The `.returning()` call gives Better Auth the ghost's original ID,
   * so session creation works correctly.
   */
  createDrizzleAdapter() {
    const baseAdapterFactory = drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        ...schema,
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        jwks: schema.jwks,
      },
    });

    // The drizzle adapter is a factory function: (options) => adapterObject
    return (options: unknown) => {
      const resolved = (baseAdapterFactory as Function)(options);

      return {
        ...resolved,
        create: async (params: { model: string; data: Record<string, unknown>; [key: string]: unknown }) => {
          if (params.model === 'user') {
            // Normalize email to lowercase to prevent case-variant duplicates (IND-166).
            const data = { ...params.data } as typeof schema.users.$inferInsert;
            if (typeof data.email === 'string') {
              data.email = data.email.toLowerCase().trim();
            }
            // Use ON CONFLICT to handle ghost claim atomically.
            // If a ghost exists with this email, update it in-place.
            // The WHERE clause ensures we only upsert over ghosts, not real users.
            // If a real (non-ghost) user already has this email, the WHERE doesn't
            // match, RETURNING is empty, and we throw to signal a duplicate signup.
            const result = await db
              .insert(schema.users)
              .values(data)
              .onConflictDoUpdate({
                target: schema.users.email,
                set: {
                  name: sql`EXCLUDED."name"`,
                  avatar: sql`EXCLUDED."avatar"`,
                  isGhost: sql`false`,
                  updatedAt: sql`now()`,
                },
                setWhere: sql`${schema.users.isGhost} = true`,
              })
              .returning();

            if (!result[0]) {
              // Conflict with a real (non-ghost) user — the WHERE filtered it out
              // so neither INSERT nor UPDATE happened. Surface as a constraint error.
              throw new Error(`User with this email already exists`);
            }

            return result[0];
          }
          return resolved.create(params);
        },
      };
    };
  }

  /**
   * Creates a personal index for the user if one doesn't exist.
   * Idempotent — safe to call on every sign-in.
   * @param userId - The authenticated user
   * @returns The personal index ID
   */
  async ensurePersonalIndex(userId: string): Promise<string> {
    return ensurePersonalIndex(userId);
  }
}
