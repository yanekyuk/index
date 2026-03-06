import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq, and } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';

/**
 * Database adapter for Better Auth integration.
 * Provides the drizzle adapter config and ghost-claim lifecycle methods
 * used by the Better Auth database hooks during signup.
 */
export class AuthDatabaseAdapter {
  /** Returns a configured drizzle adapter for Better Auth's `database` option. */
  createDrizzleAdapter() {
    return drizzleAdapter(db, {
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
  }

  /**
   * Frees a ghost user's email so a real user can sign up with it.
   * Called from Better Auth's `create.before` hook to avoid unique constraint violations.
   * @param email - The email to check for ghost users
   * @returns The ghost user's ID if found, null otherwise
   */
  async prepareGhostClaim(email: string): Promise<string | null> {
    const ghost = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.email, email), eq(schema.users.isGhost, true)))
      .limit(1)
      .then((rows) => rows[0]);

    if (!ghost) return null;

    // Set ghost email to a unique placeholder to free the unique constraint
    await db.update(schema.users)
      .set({ email: `__ghost_claimed_${ghost.id}` })
      .where(eq(schema.users.id, ghost.id));

    return ghost.id;
  }

  /**
   * Restores a ghost user's email after a failed claim attempt.
   * @param ghostId - The ghost user's ID
   * @param email - The original email to restore
   */
  async restoreGhostEmail(ghostId: string, email: string): Promise<void> {
    await db.update(schema.users)
      .set({ email })
      .where(eq(schema.users.id, ghostId));
  }

  /**
   * Claims a ghost user's data after a real user has been created.
   * Transfers all ghost data (profiles, intents, index memberships, contacts, HyDE documents)
   * to the real user, then deletes the ghost row.
   * @param realUserId - The real user's ID
   * @param ghostId - The ghost user's ID (from prepareGhostClaim)
   */
  async claimGhostUser(realUserId: string, ghostId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(schema.userProfiles).set({ userId: realUserId }).where(eq(schema.userProfiles.userId, ghostId));
      await tx.update(schema.intents).set({ userId: realUserId }).where(eq(schema.intents.userId, ghostId));
      await tx.update(schema.indexMembers).set({ userId: realUserId }).where(eq(schema.indexMembers.userId, ghostId));
      await tx.update(schema.hydeDocuments).set({ sourceId: realUserId }).where(eq(schema.hydeDocuments.sourceId, ghostId));
      await tx.update(schema.userContacts).set({ userId: realUserId }).where(eq(schema.userContacts.userId, ghostId));
      await tx.delete(schema.users).where(eq(schema.users.id, ghostId));
    });
  }
}
