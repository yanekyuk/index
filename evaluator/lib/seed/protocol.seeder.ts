import { eq, like, inArray, sql } from "drizzle-orm";
import {
  getProtocolDb,
  users,
  userProfiles,
  intents,
  indexes,
  indexMembers,
  intentIndexes,
  opportunities,
  sessions,
  accounts,
} from "./protocol.db";
import type { GeneratedSeedData } from "./seed.types";
import { signUp } from "./auth.session";

/**
 * Seed the protocol database with generated test data.
 * Creates users via Better Auth sign-up, then directly inserts
 * profiles, intents, indexes, and memberships.
 */
export async function seedProtocol(
  data: GeneratedSeedData,
  protocolApiUrl: string
): Promise<{ testUserId: string }> {
  const db = getProtocolDb();

  const testUserResult = await signUp(
    protocolApiUrl,
    data.testUser.email,
    data.testUser.password,
    data.testUser.name
  );

  const testUserId = testUserResult.userId;

  if (data.testUser.profile) {
    await db
      .insert(userProfiles)
      .values({
        userId: testUserId,
        identity: data.testUser.profile.identity,
        narrative: data.testUser.profile.narrative,
        attributes: data.testUser.profile.attributes,
      })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          identity: data.testUser.profile.identity,
          narrative: data.testUser.profile.narrative,
          attributes: data.testUser.profile.attributes,
          updatedAt: new Date(),
        },
      });
  }

  const createdIndexIds: string[] = [];
  for (const idx of data.indexes) {
    const [created] = await db
      .insert(indexes)
      .values({
        title: idx.title,
        prompt: idx.prompt,
        isPersonal: false,
        permissions: {
          joinPolicy: "anyone" as const,
          invitationLink: null,
          allowGuestVibeCheck: false,
        },
      })
      .returning({ id: indexes.id });

    if (created) {
      createdIndexIds.push(created.id);
      await db.insert(indexMembers).values({
        indexId: created.id,
        userId: testUserId,
        permissions: ["owner"],
        autoAssign: false,
      });
    }
  }

  for (const intentText of data.intents) {
    const [created] = await db
      .insert(intents)
      .values({
        payload: intentText,
        userId: testUserId,
        status: "ACTIVE",
      })
      .returning({ id: intents.id });

    if (created && createdIndexIds.length > 0) {
      await db.insert(intentIndexes).values({
        intentId: created.id,
        indexId: createdIndexIds[0],
      });
    }
  }

  if (data.otherUsers) {
    for (const other of data.otherUsers) {
      const otherResult = await signUp(
        protocolApiUrl,
        other.email,
        other.password,
        other.name
      );
      const otherUserId = otherResult.userId;

      if (other.profile) {
        await db
          .insert(userProfiles)
          .values({
            userId: otherUserId,
            identity: other.profile.identity,
            narrative: other.profile.narrative,
            attributes: other.profile.attributes,
          })
          .onConflictDoUpdate({
            target: userProfiles.userId,
            set: {
              identity: other.profile.identity,
              narrative: other.profile.narrative,
              attributes: other.profile.attributes,
              updatedAt: new Date(),
            },
          });
      }

      for (const indexId of createdIndexIds) {
        try {
          await db.insert(indexMembers).values({
            indexId,
            userId: otherUserId,
            permissions: ["member"],
            autoAssign: false,
          });
        } catch {
          /* already exists */
        }
      }

      for (const intentText of other.intents) {
        const [created] = await db
          .insert(intents)
          .values({
            payload: intentText,
            userId: otherUserId,
            status: "ACTIVE",
          })
          .returning({ id: intents.id });

        if (created && createdIndexIds.length > 0) {
          await db.insert(intentIndexes).values({
            intentId: created.id,
            indexId: createdIndexIds[0],
          });
        }
      }
    }
  }

  if (data.opportunities && data.opportunities.length > 0) {
    const otherUserIds: string[] = [];
    if (data.otherUsers) {
      for (const other of data.otherUsers) {
        const [found] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, other.email))
          .limit(1);
        if (found) otherUserIds.push(found.id);
      }
    }

    for (const opp of data.opportunities) {
      const actorUserId = otherUserIds[0] ?? testUserId;
      await db.insert(opportunities).values({
        detection: {
          source: "cron",
          timestamp: new Date().toISOString(),
        },
        actors: [
          {
            indexId: createdIndexIds[0] ?? "",
            userId: testUserId,
            role: "seeker",
          },
          {
            indexId: createdIndexIds[0] ?? "",
            userId: actorUserId,
            role: "provider",
          },
        ],
        interpretation: {
          category: opp.category,
          reasoning: opp.reasoning,
          confidence: opp.confidence,
        },
        context: {
          indexId: createdIndexIds[0] ?? undefined,
        },
        confidence: String(opp.confidence),
        status: (opp.status as "pending" | "viewed") ?? "pending",
      });
    }
  }

  return { testUserId };
}

/**
 * Clean up all seeded data by matching the seedTag email pattern.
 * Deletes intent_indexes, intents, index_members, indexes, opportunities, then users + cascade.
 */
export async function cleanupSeed(seedTag: string): Promise<void> {
  const db = getProtocolDb();
  const emailPattern = `${seedTag}%`;

  const seededUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, emailPattern));

  const userIds = seededUsers.map((u) => u.id);
  if (userIds.length === 0) return;

  const intentRows = await db
    .select({ id: intents.id })
    .from(intents)
    .where(inArray(intents.userId, userIds));
  const intentIds = intentRows.map((r) => r.id);

  if (intentIds.length > 0) {
    await db.delete(intentIndexes).where(inArray(intentIndexes.intentId, intentIds));
  }

  for (const userId of userIds) {
    await db.delete(intents).where(eq(intents.userId, userId));
  }

  const indexRows = await db
    .select({ indexId: indexMembers.indexId })
    .from(indexMembers)
    .where(inArray(indexMembers.userId, userIds));
  const indexIds = [...new Set(indexRows.map((r) => r.indexId))];

  for (const userId of userIds) {
    await db.delete(indexMembers).where(eq(indexMembers.userId, userId));
  }

  for (const userId of userIds) {
    await db
      .delete(opportunities)
      .where(
        sql`EXISTS (SELECT 1 FROM jsonb_array_elements(actors) AS elem WHERE elem->>'userId' = ${userId})`
      );
  }

  for (const indexId of indexIds) {
    await db.delete(indexes).where(eq(indexes.id, indexId));
  }

  for (const userId of userIds) {
    await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
  }

  for (const userId of userIds) {
    await db.delete(sessions).where(eq(sessions.userId, userId));
    await db.delete(accounts).where(eq(accounts.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }
}

/**
 * Remove a single no-seed eval user by email (user + cascade).
 * No-seed users have no intents/indexes/opportunities.
 */
export async function cleanupNoseedUser(email: string): Promise<void> {
  const db = getProtocolDb();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) return;

  const userId = user.id;
  await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}
