/**
 * Database adapters used by controllers and queues.
 * Postgres implementations; no dependency on lib/protocol.
 */

import { eq, and, isNull, isNotNull, sql, count, desc, lt, lte, ne, inArray } from 'drizzle-orm';
import * as schema from '../schemas/database.schema';
import db from '../lib/drizzle/drizzle';
import type { User } from '../schemas/database.schema';
import { log } from '../lib/log';

// Local types used by adapters (shapes only; protocol layer defines the contracts)
interface ActiveIntentRow {
  id: string;
  payload: string;
  summary: string | null;
  createdAt: Date;
}
type SourceType = 'file' | 'integration' | 'link' | 'discovery_form' | 'enrichment';

interface CreateIntentInput {
  userId: string;
  payload: string;
  summary?: string | null;
  embedding?: number[];
  isIncognito?: boolean;
  sourceType?: SourceType | null;
  sourceId?: string | null;
}
interface UpdateIntentInput {
  payload?: string;
  summary?: string | null;
  embedding?: number[];
  isIncognito?: boolean;
}
interface CreatedIntentRow {
  id: string;
  payload: string;
  summary: string | null;
  isIncognito: boolean;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}
interface ArchiveResultShape {
  success: boolean;
  error?: string;
}
// Shapes matching schemas/database.schema userProfiles columns (no lib/protocol import)
interface ProfileIdentity {
  name: string;
  bio: string;
  location: string;
}
interface ProfileNarrative {
  context: string;
}
interface ProfileAttributes {
  interests: string[];
  skills: string[];
}
interface ProfileRow {
  userId: string;
  identity: ProfileIdentity;
  narrative: ProfileNarrative;
  attributes: ProfileAttributes;
  embedding: number[] | number[][] | null;
}

interface IndexMembershipRow {
  indexId: string;
  indexTitle: string;
  indexPrompt: string | null;
  permissions: string[];
  memberPrompt: string | null;
  autoAssign: boolean;
  joinedAt: Date;
}

const { intents, indexes, indexMembers, intentIndexes, users, hydeDocuments, opportunities } = schema;

// HyDE row to document shape (embedding may come as number[] or pg vector)
type HydeSourceTypeLocal = 'intent' | 'profile' | 'query';
interface HydeDocumentRow {
  id: string;
  sourceType: HydeSourceTypeLocal;
  sourceId: string | null;
  sourceText: string | null;
  strategy: string;
  targetCorpus: string;
  hydeText: string;
  hydeEmbedding: number[];
  context: Record<string, unknown> | null;
  createdAt: Date;
  expiresAt: Date | null;
}
function toHydeDocument(row: typeof hydeDocuments.$inferSelect): HydeDocumentRow {
  const embedding = row.hydeEmbedding;
  const vec = Array.isArray(embedding) ? embedding : (typeof embedding === 'string' ? (JSON.parse(embedding) as number[]) : []);
  return {
    id: row.id,
    sourceType: row.sourceType as HydeSourceTypeLocal,
    sourceId: row.sourceId,
    sourceText: row.sourceText,
    strategy: row.strategy,
    targetCorpus: row.targetCorpus,
    hydeText: row.hydeText,
    hydeEmbedding: vec,
    context: row.context as Record<string, unknown> | null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Intent Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Database adapter for intent CRUD (Intent Graph).
 */
export class IntentDatabaseAdapter {
  async getActiveIntents(userId: string): Promise<ActiveIntentRow[]> {
    try {
      const result = await db.select({
        id: schema.intents.id,
        payload: schema.intents.payload,
        summary: schema.intents.summary,
        createdAt: schema.intents.createdAt,
      })
        .from(schema.intents)
        .where(
          and(
            eq(schema.intents.userId, userId),
            isNull(schema.intents.archivedAt)
          )
        );
      return result;
    } catch (error: unknown) {
      console.error('IntentDatabaseAdapter.getActiveIntents error:', error);
      return [];
    }
  }

  async createIntent(data: CreateIntentInput): Promise<CreatedIntentRow> {
    try {
      const [created] = await db.insert(schema.intents)
        .values({
          userId: data.userId,
          payload: data.payload,
          summary: data.summary ?? null,
          embedding: data.embedding,
          isIncognito: data.isIncognito ?? false,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
        })
        .returning({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          isIncognito: schema.intents.isIncognito,
          createdAt: schema.intents.createdAt,
          updatedAt: schema.intents.updatedAt,
          userId: schema.intents.userId,
        });
      if (!created) throw new Error('Insert did not return a row');
      return created;
    } catch (error: unknown) {
      console.error('IntentDatabaseAdapter.createIntent error:', error);
      throw error;
    }
  }

  async updateIntent(intentId: string, data: UpdateIntentInput): Promise<CreatedIntentRow | null> {
    try {
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (data.payload !== undefined) updateData.payload = data.payload;
      if (data.summary !== undefined) updateData.summary = data.summary;
      if (data.embedding !== undefined) updateData.embedding = data.embedding;
      if (data.isIncognito !== undefined) updateData.isIncognito = data.isIncognito;

      const [updated] = await db.update(schema.intents)
        .set(updateData)
        .where(eq(schema.intents.id, intentId))
        .returning({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          isIncognito: schema.intents.isIncognito,
          createdAt: schema.intents.createdAt,
          updatedAt: schema.intents.updatedAt,
          userId: schema.intents.userId,
        });
      return updated ?? null;
    } catch (error: unknown) {
      console.error('IntentDatabaseAdapter.updateIntent error:', error);
      return null;
    }
  }

  async archiveIntent(intentId: string): Promise<ArchiveResultShape> {
    try {
      const [archived] = await db.update(schema.intents)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.intents.id, intentId))
        .returning({ id: schema.intents.id });
      if (!archived) return { success: false, error: 'Intent not found' };
      return { success: true };
    } catch (error: unknown) {
      console.error('IntentDatabaseAdapter.archiveIntent error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getIntentsInIndexForMember(userId: string, indexNameOrId: string): Promise<ActiveIntentRow[]> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let indexId: string | null = null;

    if (uuidRegex.test(indexNameOrId.trim())) {
      const membership = await db
        .select({ indexId: schema.indexMembers.indexId })
        .from(schema.indexMembers)
        .innerJoin(schema.indexes, eq(schema.indexMembers.indexId, schema.indexes.id))
        .where(
          and(
            eq(schema.indexMembers.userId, userId),
            eq(schema.indexMembers.indexId, indexNameOrId.trim()),
            isNull(schema.indexes.deletedAt)
          )
        )
        .limit(1);
      indexId = membership[0]?.indexId ?? null;
    } else {
      const memberships = await db
        .select({
          indexId: schema.indexMembers.indexId,
          indexTitle: schema.indexes.title,
        })
        .from(schema.indexMembers)
        .innerJoin(schema.indexes, eq(schema.indexMembers.indexId, schema.indexes.id))
        .where(
          and(
            eq(schema.indexMembers.userId, userId),
            isNull(schema.indexes.deletedAt)
          )
        );
      const needle = indexNameOrId.trim().toLowerCase();
      const match = memberships.find(
        (m) => (m.indexTitle ?? '').toLowerCase() === needle || (m.indexTitle ?? '').toLowerCase().includes(needle)
      );
      indexId = match?.indexId ?? null;
    }

    if (!indexId) {
      return [];
    }

    try {
      const result = await db
        .select({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          createdAt: schema.intents.createdAt,
        })
        .from(schema.intents)
        .innerJoin(schema.intentIndexes, eq(schema.intents.id, schema.intentIndexes.intentId))
        .where(
          and(
            eq(schema.intentIndexes.indexId, indexId),
            eq(schema.intents.userId, userId),
            isNull(schema.intents.archivedAt)
          )
        );
      return result;
    } catch (error: unknown) {
      console.error('IntentDatabaseAdapter.getIntentsInIndexForMember error:', error);
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Chat Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Database adapter for Chat Graph and its subgraphs.
 */
export class ChatDatabaseAdapter {
  private readonly hydeAdapter = new HydeDatabaseAdapter();
  private _opportunityAdapter: OpportunityDatabaseAdapter | null = null;
  private get opportunityAdapter(): OpportunityDatabaseAdapter {
    if (!this._opportunityAdapter) this._opportunityAdapter = new OpportunityDatabaseAdapter();
    return this._opportunityAdapter;
  }

  async getProfile(userId: string): Promise<ProfileRow | null> {
    const result = await db.select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, userId))
      .limit(1);
    const profile = result[0];
    if (!profile) return null;
    return {
      userId: profile.userId,
      identity: profile.identity as ProfileIdentity,
      narrative: profile.narrative as ProfileNarrative,
      attributes: profile.attributes as ProfileAttributes,
      embedding: profile.embedding,
    };
  }

  async getActiveIntents(userId: string): Promise<ActiveIntentRow[]> {
    try {
      const result = await db.select({
        id: schema.intents.id,
        payload: schema.intents.payload,
        summary: schema.intents.summary,
        createdAt: schema.intents.createdAt,
      })
        .from(schema.intents)
        .where(
          and(
            eq(schema.intents.userId, userId),
            isNull(schema.intents.archivedAt)
          )
        );
      return result;
    } catch (error: unknown) {
      console.error('ChatDatabaseAdapter.getActiveIntents error:', error);
      return [];
    }
  }

  async getIntentsInIndexForMember(userId: string, indexNameOrId: string): Promise<ActiveIntentRow[]> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let indexId: string | null = null;

    if (uuidRegex.test(indexNameOrId.trim())) {
      const membership = await db
        .select({ indexId: schema.indexMembers.indexId })
        .from(schema.indexMembers)
        .innerJoin(schema.indexes, eq(schema.indexMembers.indexId, schema.indexes.id))
        .where(
          and(
            eq(schema.indexMembers.userId, userId),
            eq(schema.indexMembers.indexId, indexNameOrId.trim()),
            isNull(schema.indexes.deletedAt)
          )
        )
        .limit(1);
      indexId = membership[0]?.indexId ?? null;
    } else {
      const memberships = await db
        .select({
          indexId: schema.indexMembers.indexId,
          indexTitle: schema.indexes.title,
        })
        .from(schema.indexMembers)
        .innerJoin(schema.indexes, eq(schema.indexMembers.indexId, schema.indexes.id))
        .where(
          and(
            eq(schema.indexMembers.userId, userId),
            isNull(schema.indexes.deletedAt)
          )
        );
      const needle = indexNameOrId.trim().toLowerCase();
      const match = memberships.find(
        (m) => (m.indexTitle ?? '').toLowerCase() === needle || (m.indexTitle ?? '').toLowerCase().includes(needle)
      );
      indexId = match?.indexId ?? null;
    }

    if (!indexId) {
      return [];
    }

    try {
      const result = await db
        .select({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          createdAt: schema.intents.createdAt,
        })
        .from(schema.intents)
        .innerJoin(schema.intentIndexes, eq(schema.intents.id, schema.intentIndexes.intentId))
        .where(
          and(
            eq(schema.intentIndexes.indexId, indexId),
            eq(schema.intents.userId, userId),
            isNull(schema.intents.archivedAt)
          )
        );
      return result;
    } catch (error: unknown) {
      console.error('ChatDatabaseAdapter.getIntentsInIndexForMember error:', error);
      return [];
    }
  }

  async getUser(userId: string): Promise<User | null> {
    const result = await db.select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return result[0] ?? null;
  }

  async saveProfile(userId: string, profile: ProfileRow): Promise<void> {
    const data = {
      userId,
      identity: profile.identity,
      narrative: profile.narrative,
      attributes: profile.attributes,
      embedding: profile.embedding === null 
        ? null 
        : (Array.isArray(profile.embedding[0])
          ? (profile.embedding as number[][])[0]
          : (profile.embedding as number[])),
      updatedAt: new Date(),
    };
    await db.insert(schema.userProfiles)
      .values(data)
      .onConflictDoUpdate({
        target: schema.userProfiles.userId,
        set: data,
      });
  }

  async saveHydeProfile(userId: string, description: string, embedding: number[]): Promise<void> {
    await db.update(schema.userProfiles)
      .set({
        hydeDescription: description,
        hydeEmbedding: embedding,
        updatedAt: new Date(),
      })
      .where(eq(schema.userProfiles.userId, userId));
  }

  async createIntent(data: CreateIntentInput): Promise<CreatedIntentRow> {
    try {
      const [created] = await db.insert(schema.intents)
        .values({
          userId: data.userId,
          payload: data.payload,
          summary: data.summary ?? null,
          embedding: data.embedding,
          isIncognito: data.isIncognito ?? false,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
        })
        .returning({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          isIncognito: schema.intents.isIncognito,
          createdAt: schema.intents.createdAt,
          updatedAt: schema.intents.updatedAt,
          userId: schema.intents.userId,
        });
      if (!created) throw new Error('Insert did not return a row');
      return created;
    } catch (error: unknown) {
      console.error('ChatDatabaseAdapter.createIntent error:', error);
      throw error;
    }
  }

  async updateIntent(intentId: string, data: UpdateIntentInput): Promise<CreatedIntentRow | null> {
    try {
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (data.payload !== undefined) updateData.payload = data.payload;
      if (data.summary !== undefined) updateData.summary = data.summary;
      if (data.embedding !== undefined) updateData.embedding = data.embedding;
      if (data.isIncognito !== undefined) updateData.isIncognito = data.isIncognito;

      const [updated] = await db.update(schema.intents)
        .set(updateData)
        .where(eq(schema.intents.id, intentId))
        .returning({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          isIncognito: schema.intents.isIncognito,
          createdAt: schema.intents.createdAt,
          updatedAt: schema.intents.updatedAt,
          userId: schema.intents.userId,
        });
      return updated ?? null;
    } catch (error: unknown) {
      console.error('ChatDatabaseAdapter.updateIntent error:', error);
      return null;
    }
  }

  async archiveIntent(intentId: string): Promise<ArchiveResultShape> {
    try {
      const [archived] = await db.update(schema.intents)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.intents.id, intentId))
        .returning({ id: schema.intents.id });
      if (!archived) return { success: false, error: 'Intent not found' };
      return { success: true };
    } catch (error: unknown) {
      console.error('ChatDatabaseAdapter.archiveIntent error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getIndexMemberships(userId: string): Promise<IndexMembershipRow[]> {
    try {
      const result = await db
        .select({
          indexId: schema.indexMembers.indexId,
          indexTitle: schema.indexes.title,
          indexPrompt: schema.indexes.prompt,
          permissions: schema.indexMembers.permissions,
          memberPrompt: schema.indexMembers.prompt,
          autoAssign: schema.indexMembers.autoAssign,
          joinedAt: schema.indexMembers.createdAt,
        })
        .from(schema.indexMembers)
        .innerJoin(schema.indexes, eq(schema.indexMembers.indexId, schema.indexes.id))
        .where(
          and(
            eq(schema.indexMembers.userId, userId),
            isNull(schema.indexes.deletedAt)
          )
        );
      return result;
    } catch (error: unknown) {
      console.error('ChatDatabaseAdapter.getIndexMemberships error:', error);
      return [];
    }
  }

  async getIndex(indexId: string): Promise<{ id: string; title: string } | null> {
    const rows = await db
      .select({ id: schema.indexes.id, title: schema.indexes.title })
      .from(schema.indexes)
      .where(and(eq(schema.indexes.id, indexId), isNull(schema.indexes.deletedAt)))
      .limit(1);
    const row = rows[0];
    return row ? { id: row.id, title: row.title } : null;
  }

  async getIndexWithPermissions(indexId: string): Promise<{ id: string; title: string; permissions: { joinPolicy: 'anyone' | 'invite_only' } } | null> {
    const rows = await db
      .select({ id: indexes.id, title: indexes.title, permissions: indexes.permissions })
      .from(indexes)
      .where(and(eq(indexes.id, indexId), isNull(indexes.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const perms = (row.permissions as { joinPolicy?: string }) ?? {};
    return {
      id: row.id,
      title: row.title,
      permissions: { joinPolicy: (perms.joinPolicy === 'anyone' ? 'anyone' : 'invite_only') as 'anyone' | 'invite_only' },
    };
  }

  async getIndexesForUser(userId: string) {
    const memberIndexIds = await db
      .select({ indexId: schema.indexMembers.indexId })
      .from(schema.indexMembers)
      .innerJoin(schema.indexes, eq(schema.indexMembers.indexId, schema.indexes.id))
      .where(
        and(
          eq(schema.indexMembers.userId, userId),
          isNull(schema.indexes.deletedAt)
        )
      );

    const ids = [...new Set(memberIndexIds.map((r) => r.indexId))];
    if (ids.length === 0) {
      return {
        indexes: [],
        pagination: { current: 1, total: 0, count: 0, totalCount: 0 },
      };
    }

    const rows = await db
      .select({
        id: schema.indexes.id,
        title: schema.indexes.title,
        prompt: schema.indexes.prompt,
        permissions: schema.indexes.permissions,
        isPersonal: schema.indexes.isPersonal,
        createdAt: schema.indexes.createdAt,
        updatedAt: schema.indexes.updatedAt,
        ownerId: schema.indexMembers.userId,
        userName: schema.users.name,
        userAvatar: schema.users.avatar,
      })
      .from(schema.indexes)
      .innerJoin(
        schema.indexMembers,
        and(
          eq(schema.indexes.id, schema.indexMembers.indexId),
          sql`'owner' = ANY(${schema.indexMembers.permissions})`
        )
      )
      .innerJoin(schema.users, eq(schema.indexMembers.userId, schema.users.id))
      .where(
        and(
          isNull(schema.indexes.deletedAt),
          inArray(schema.indexes.id, ids)
        )
      )
      .orderBy(desc(schema.indexes.isPersonal), desc(schema.indexes.createdAt));

    const indexesWithCounts = await Promise.all(
      rows.map(async (row) => {
        const [memberCount] = await db
          .select({ count: count() })
          .from(schema.indexMembers)
          .where(eq(schema.indexMembers.indexId, row.id));
        return {
          id: row.id,
          title: row.title,
          prompt: row.prompt,
          permissions: row.permissions,
          isPersonal: row.isPersonal,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          user: {
            id: row.ownerId,
            name: row.userName,
            avatar: row.userAvatar,
          },
          _count: {
            members: Number(memberCount?.count ?? 0),
          },
        };
      })
    );

    const totalCount = indexesWithCounts.length;
    return {
      indexes: indexesWithCounts,
      pagination: {
        current: 1,
        total: totalCount > 0 ? 1 : 0,
        count: totalCount,
        totalCount,
      },
    };
  }

  async getUserIndexIds(userId: string): Promise<string[]> {
    try {
      const result = await db
        .select({ indexId: schema.indexMembers.indexId })
        .from(schema.indexMembers)
        .innerJoin(schema.indexes, eq(schema.indexMembers.indexId, schema.indexes.id))
        .where(
          and(
            eq(schema.indexMembers.userId, userId),
            eq(schema.indexMembers.autoAssign, true),
            isNull(schema.indexes.deletedAt)
          )
        );
      return result.map((r) => r.indexId);
    } catch (error: unknown) {
      console.error('ChatDatabaseAdapter.getUserIndexIds error:', error);
      return [];
    }
  }

  async getIntent(intentId: string) {
    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        isIncognito: intents.isIncognito,
        createdAt: intents.createdAt,
        updatedAt: intents.updatedAt,
        userId: intents.userId,
        archivedAt: intents.archivedAt,
        embedding: intents.embedding,
        sourceType: intents.sourceType,
        sourceId: intents.sourceId,
      })
      .from(intents)
      .where(eq(intents.id, intentId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const emb = row.embedding;
    const embedding: number[] | null =
      emb == null
        ? null
        : Array.isArray(emb) && emb.length > 0 && Array.isArray(emb[0])
          ? (emb[0] as number[])
          : Array.isArray(emb)
            ? (emb as number[])
            : null;
    return {
      id: row.id,
      payload: row.payload,
      summary: row.summary,
      isIncognito: row.isIncognito,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      userId: row.userId,
      archivedAt: row.archivedAt,
      embedding: embedding ?? undefined,
      sourceType: row.sourceType ?? undefined,
      sourceId: row.sourceId ?? undefined,
    };
  }

  async getIntentForIndexing(intentId: string) {
    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        userId: intents.userId,
        sourceType: intents.sourceType,
        sourceId: intents.sourceId,
      })
      .from(intents)
      .where(eq(intents.id, intentId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getIndexMemberContext(indexId: string, userId: string) {
    const rows = await db
      .select({
        indexId: indexes.id,
        indexPrompt: indexes.prompt,
        memberPrompt: indexMembers.prompt,
      })
      .from(indexes)
      .innerJoin(indexMembers, eq(indexes.id, indexMembers.indexId))
      .where(
        and(
          eq(indexes.id, indexId),
          eq(indexMembers.userId, userId),
          eq(indexMembers.autoAssign, true),
          isNull(indexes.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async isIntentAssignedToIndex(intentId: string, indexId: string): Promise<boolean> {
    const rows = await db
      .select({ indexId: intentIndexes.indexId })
      .from(intentIndexes)
      .where(
        and(
          eq(intentIndexes.intentId, intentId),
          eq(intentIndexes.indexId, indexId)
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async assignIntentToIndex(intentId: string, indexId: string): Promise<void> {
    await db.insert(intentIndexes).values({ intentId, indexId });
  }

  async unassignIntentFromIndex(intentId: string, indexId: string): Promise<void> {
    await db
      .delete(intentIndexes)
      .where(
        and(
          eq(intentIndexes.intentId, intentId),
          eq(intentIndexes.indexId, indexId)
        )
      );
  }

  // HyDE document operations (delegate to HydeDatabaseAdapter)
  async getHydeDocument(
    sourceType: 'intent' | 'profile' | 'query',
    sourceId: string,
    strategy: string
  ): Promise<HydeDocumentRow | null> {
    return this.hydeAdapter.getHydeDocument(sourceType, sourceId, strategy);
  }

  async getHydeDocumentsForSource(
    sourceType: 'intent' | 'profile' | 'query',
    sourceId: string
  ): Promise<HydeDocumentRow[]> {
    return this.hydeAdapter.getHydeDocumentsForSource(sourceType, sourceId);
  }

  async saveHydeDocument(data: SaveHydeDocumentInput): Promise<HydeDocumentRow> {
    return this.hydeAdapter.saveHydeDocument(data);
  }

  async deleteHydeDocumentsForSource(
    sourceType: 'intent' | 'profile' | 'query',
    sourceId: string
  ): Promise<number> {
    return this.hydeAdapter.deleteHydeDocumentsForSource(sourceType, sourceId);
  }

  async deleteExpiredHydeDocuments(): Promise<number> {
    return this.hydeAdapter.deleteExpiredHydeDocuments();
  }

  async getStaleHydeDocuments(threshold: Date): Promise<HydeDocumentRow[]> {
    return this.hydeAdapter.getStaleHydeDocuments(threshold);
  }

  async getOwnedIndexes(userId: string) {
    const ownerRows = await db
      .select({
        indexId: indexMembers.indexId,
        title: indexes.title,
        prompt: indexes.prompt,
        permissions: indexes.permissions,
        createdAt: indexes.createdAt,
      })
      .from(indexMembers)
      .innerJoin(indexes, eq(indexMembers.indexId, indexes.id))
      .where(
        and(
          eq(indexMembers.userId, userId),
          sql`'owner' = ANY(${indexMembers.permissions})`,
          isNull(indexes.deletedAt)
        )
      );

    const result = await Promise.all(
      ownerRows.map(async (row) => {
        const [memberCountResult, intentCountResult] = await Promise.all([
          db.select({ count: count() }).from(indexMembers).where(eq(indexMembers.indexId, row.indexId)),
          db.select({ count: count() }).from(intentIndexes).where(eq(intentIndexes.indexId, row.indexId)),
        ]);
        const perms = row.permissions as { joinPolicy: string; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean } | null;
        return {
          id: row.indexId,
          title: row.title,
          prompt: row.prompt,
          permissions: {
            joinPolicy: (perms?.joinPolicy ?? 'invite_only') as 'anyone' | 'invite_only',
            allowGuestVibeCheck: perms?.allowGuestVibeCheck ?? false,
            invitationLink: perms?.invitationLink ?? null,
          },
          createdAt: row.createdAt,
          memberCount: Number(memberCountResult[0]?.count ?? 0),
          intentCount: Number(intentCountResult[0]?.count ?? 0),
        };
      })
    );
    return result;
  }

  async getIndexMembersForMember(indexId: string, requestingUserId: string) {
    const isMember = await this.isIndexMember(indexId, requestingUserId);
    if (!isMember) {
      throw new Error('Access denied: Not a member of this index');
    }

    const members = await db
      .select({
        userId: indexMembers.userId,
        name: users.name,
        avatar: users.avatar,
        permissions: indexMembers.permissions,
        memberPrompt: indexMembers.prompt,
        autoAssign: indexMembers.autoAssign,
        joinedAt: indexMembers.createdAt,
      })
      .from(indexMembers)
      .innerJoin(users, eq(indexMembers.userId, users.id))
      .where(eq(indexMembers.indexId, indexId));

    const [requestingUserEmailRow] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, requestingUserId))
      .limit(1);

    const result = await Promise.all(
      members.map(async (m) => {
        const [intentCountRow] = await db
          .select({ count: count() })
          .from(intentIndexes)
          .innerJoin(intents, eq(intentIndexes.intentId, intents.id))
          .where(and(eq(intentIndexes.indexId, indexId), eq(intents.userId, m.userId), isNull(intents.archivedAt)));
        const email = m.userId === requestingUserId ? (requestingUserEmailRow?.email ?? undefined) : undefined;
        return {
          userId: m.userId,
          name: m.name,
          avatar: m.avatar,
          email,
          permissions: m.permissions ?? [],
          memberPrompt: m.memberPrompt,
          autoAssign: m.autoAssign,
          joinedAt: m.joinedAt,
          intentCount: Number(intentCountRow?.count ?? 0),
        };
      })
    );
    return result;
  }

  async isIndexOwner(indexId: string, userId: string): Promise<boolean> {
    const rows = await db
      .select({ userId: indexMembers.userId })
      .from(indexMembers)
      .where(
        and(
          eq(indexMembers.indexId, indexId),
          eq(indexMembers.userId, userId),
          sql`'owner' = ANY(${indexMembers.permissions})`
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async getIndexMembersForOwner(indexId: string, requestingUserId: string) {
    const isOwner = await this.isIndexOwner(indexId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this index');
    }

    const members = await db
      .select({
        userId: indexMembers.userId,
        name: users.name,
        avatar: users.avatar,
        email: users.email,
        permissions: indexMembers.permissions,
        memberPrompt: indexMembers.prompt,
        autoAssign: indexMembers.autoAssign,
        joinedAt: indexMembers.createdAt,
      })
      .from(indexMembers)
      .innerJoin(users, eq(indexMembers.userId, users.id))
      .where(eq(indexMembers.indexId, indexId));

    const result = await Promise.all(
      members.map(async (m) => {
        const [intentCountRow] = await db
          .select({ count: count() })
          .from(intentIndexes)
          .innerJoin(intents, eq(intentIndexes.intentId, intents.id))
          .where(and(eq(intentIndexes.indexId, indexId), eq(intents.userId, m.userId), isNull(intents.archivedAt)));
        return {
          userId: m.userId,
          name: m.name,
          avatar: m.avatar,
          email: m.email,
          permissions: m.permissions ?? [],
          memberPrompt: m.memberPrompt,
          autoAssign: m.autoAssign,
          joinedAt: m.joinedAt,
          intentCount: Number(intentCountRow?.count ?? 0),
        };
      })
    );
    return result;
  }

  async getIndexIntentsForOwner(
    indexId: string,
    requestingUserId: string,
    options?: { limit?: number; offset?: number }
  ) {
    const isOwner = await this.isIndexOwner(indexId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this index');
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        userId: intents.userId,
        userName: users.name,
        createdAt: intents.createdAt,
      })
      .from(intentIndexes)
      .innerJoin(intents, eq(intentIndexes.intentId, intents.id))
      .innerJoin(users, eq(intents.userId, users.id))
      .where(and(eq(intentIndexes.indexId, indexId), isNull(intents.archivedAt)))
      .orderBy(desc(intents.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((r) => ({
      id: r.id,
      payload: r.payload,
      summary: r.summary,
      userId: r.userId,
      userName: r.userName,
      createdAt: r.createdAt,
    }));
  }

  async isIndexMember(indexId: string, userId: string): Promise<boolean> {
    const rows = await db
      .select({ userId: indexMembers.userId })
      .from(indexMembers)
      .innerJoin(indexes, eq(indexMembers.indexId, indexes.id))
      .where(
        and(
          eq(indexMembers.indexId, indexId),
          eq(indexMembers.userId, userId),
          isNull(indexes.deletedAt)
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async getIndexIntentsForMember(
    indexId: string,
    requestingUserId: string,
    options?: { limit?: number; offset?: number }
  ) {
    const isMember = await this.isIndexMember(indexId, requestingUserId);
    if (!isMember) {
      throw new Error('Access denied: Not a member of this index');
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        userId: intents.userId,
        userName: users.name,
        createdAt: intents.createdAt,
      })
      .from(intentIndexes)
      .innerJoin(intents, eq(intentIndexes.intentId, intents.id))
      .innerJoin(users, eq(intents.userId, users.id))
      .where(and(eq(intentIndexes.indexId, indexId), isNull(intents.archivedAt)))
      .orderBy(desc(intents.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((r) => ({
      id: r.id,
      payload: r.payload,
      summary: r.summary,
      userId: r.userId,
      userName: r.userName,
      createdAt: r.createdAt,
    }));
  }

  async updateIndexSettings(
    indexId: string,
    requestingUserId: string,
    data: { title?: string; prompt?: string | null; joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean }
  ) {
    const isOwner = await this.isIndexOwner(indexId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this index');
    }

    const [existing] = await db.select().from(indexes).where(eq(indexes.id, indexId)).limit(1);
    if (!existing) {
      throw new Error('Index not found');
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) updateData.title = data.title;
    if (data.prompt !== undefined) updateData.prompt = data.prompt;
    if (data.joinPolicy !== undefined || data.allowGuestVibeCheck !== undefined) {
      const currentPerms = (existing.permissions as { joinPolicy: string; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean }) ?? {};
      updateData.permissions = {
        joinPolicy: data.joinPolicy ?? currentPerms.joinPolicy ?? 'invite_only',
        invitationLink: currentPerms.invitationLink ?? null,
        allowGuestVibeCheck: data.allowGuestVibeCheck ?? currentPerms.allowGuestVibeCheck ?? false,
      };
    }

    await db.update(indexes).set(updateData).where(eq(indexes.id, indexId));

    const [updatedRow] = await db.select().from(indexes).where(eq(indexes.id, indexId)).limit(1);
    if (!updatedRow) {
      throw new Error('Index not found after update');
    }
    const [memberCountResult, intentCountResult] = await Promise.all([
      db.select({ count: count() }).from(indexMembers).where(eq(indexMembers.indexId, indexId)),
      db.select({ count: count() }).from(intentIndexes).where(eq(intentIndexes.indexId, indexId)),
    ]);
    const perms = (updatedRow.permissions as { joinPolicy: string; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean }) ?? {};
    return {
      id: updatedRow.id,
      title: updatedRow.title,
      prompt: updatedRow.prompt,
      permissions: {
        joinPolicy: (perms.joinPolicy ?? 'invite_only') as 'anyone' | 'invite_only',
        allowGuestVibeCheck: perms.allowGuestVibeCheck ?? false,
        invitationLink: perms.invitationLink ?? null,
      },
      createdAt: updatedRow.createdAt,
      memberCount: Number(memberCountResult[0]?.count ?? 0),
      intentCount: Number(intentCountResult[0]?.count ?? 0),
    };
  }

  async softDeleteIndex(indexId: string): Promise<void> {
    await db.update(indexes).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(indexes.id, indexId));
  }

  async getProfileByUserId(userId: string): Promise<(ProfileRow & { id: string }) | null> {
    const result = await db.select().from(schema.userProfiles).where(eq(schema.userProfiles.userId, userId)).limit(1);
    const profile = result[0];
    if (!profile) return null;
    return {
      id: profile.id,
      userId: profile.userId,
      identity: profile.identity as ProfileIdentity,
      narrative: profile.narrative as ProfileNarrative,
      attributes: profile.attributes as ProfileAttributes,
      embedding: profile.embedding,
    };
  }

  async createIndex(data: {
    title: string;
    prompt?: string | null;
    joinPolicy?: 'anyone' | 'invite_only';
  }): Promise<{
    id: string;
    title: string;
    prompt: string | null;
    permissions: { joinPolicy: 'anyone' | 'invite_only'; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean };
  }> {
    const finalJoinPolicy = data.joinPolicy ?? 'invite_only';
    const permissions = {
      joinPolicy: finalJoinPolicy,
      invitationLink: { code: crypto.randomUUID() },
      allowGuestVibeCheck: false,
    };
    const [row] = await db
      .insert(indexes)
      .values({
        title: data.title,
        prompt: data.prompt ?? null,
        permissions,
      })
      .returning({
        id: indexes.id,
        title: indexes.title,
        prompt: indexes.prompt,
        permissions: indexes.permissions,
      });
    if (!row) throw new Error('Failed to create index');
    const perms = (row.permissions as { joinPolicy: string; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean }) ?? {};
    return {
      id: row.id,
      title: row.title,
      prompt: row.prompt,
      permissions: {
        joinPolicy: (perms.joinPolicy ?? 'invite_only') as 'anyone' | 'invite_only',
        invitationLink: perms.invitationLink ?? null,
        allowGuestVibeCheck: perms.allowGuestVibeCheck ?? false,
      },
    };
  }

  async getIndexMemberCount(indexId: string): Promise<number> {
    const [r] = await db.select({ count: count() }).from(indexMembers).where(eq(indexMembers.indexId, indexId));
    return Number(r?.count ?? 0);
  }

  async addMemberToIndex(
    indexId: string,
    userId: string,
    role: 'owner' | 'admin' | 'member'
  ): Promise<{ success: boolean; alreadyMember?: boolean }> {
    const logger = log.lib.from('database.adapter');
    const existing = await db
      .select()
      .from(indexMembers)
      .where(and(eq(indexMembers.indexId, indexId), eq(indexMembers.userId, userId)))
      .limit(1);
    if (existing.length > 0) {
      return { success: true, alreadyMember: true };
    }
    let memberPrompt: string | null = null;
    const [indexRow] = await db.select({ prompt: indexes.prompt }).from(indexes).where(eq(indexes.id, indexId)).limit(1);
    if (indexRow) memberPrompt = indexRow.prompt;

    const finalPermissions = role === 'owner' ? ['owner'] : role === 'admin' ? ['admin', 'member'] : ['member'];
    await db.insert(indexMembers).values({
      indexId,
      userId,
      permissions: finalPermissions,
      prompt: memberPrompt,
      autoAssign: true,
    });

    // Dynamic import to avoid circular dependency (user.event → intentService → ... → ChatDatabaseAdapter)
    import('../events/user.event').then(({ MemberEvents }) =>
      MemberEvents.onSettingsUpdated({
        userId,
        indexId,
        promptChanged: false,
        autoAssignChanged: true,
      })
    ).catch((err) => {
      logger.error('Failed to trigger member indexing', {
        userId,
        indexId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return { success: true, alreadyMember: false };
  }

  async deleteProfile(userId: string): Promise<void> {
    await db.delete(schema.userProfiles).where(eq(schema.userProfiles.userId, userId));
  }

  // Opportunity operations (delegate to OpportunityDatabaseAdapter)
  async createOpportunity(data: CreateOpportunityInput): Promise<OpportunityRow> {
    return this.opportunityAdapter.createOpportunity(data);
  }
  async getOpportunity(id: string): Promise<OpportunityRow | null> {
    return this.opportunityAdapter.getOpportunity(id);
  }
  async getOpportunitiesForUser(
    userId: string,
    options?: { status?: string; indexId?: string; role?: string; limit?: number; offset?: number }
  ): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.getOpportunitiesForUser(userId, options);
  }
  async getOpportunitiesForIndex(
    indexId: string,
    options?: { status?: string; limit?: number; offset?: number }
  ): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.getOpportunitiesForIndex(indexId, options);
  }
  async updateOpportunityStatus(
    id: string,
    status: 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired'
  ): Promise<OpportunityRow | null> {
    return this.opportunityAdapter.updateOpportunityStatus(id, status);
  }
  async opportunityExistsBetweenActors(actorIds: string[], indexId: string): Promise<boolean> {
    return this.opportunityAdapter.opportunityExistsBetweenActors(actorIds, indexId);
  }
  async expireOpportunitiesByIntent(intentId: string): Promise<number> {
    return this.opportunityAdapter.expireOpportunitiesByIntent(intentId);
  }
  async expireOpportunitiesForRemovedMember(indexId: string, userId: string): Promise<number> {
    return this.opportunityAdapter.expireOpportunitiesForRemovedMember(indexId, userId);
  }
  async expireStaleOpportunities(): Promise<number> {
    return this.opportunityAdapter.expireStaleOpportunities();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Profile Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Database adapter for Profile Graph.
 */
export class ProfileDatabaseAdapter {
  async getProfile(userId: string): Promise<ProfileRow | null> {
    const result = await db.select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, userId))
      .limit(1);
    const profile = result[0];
    if (!profile) return null;
    return {
      userId: profile.userId,
      identity: profile.identity as ProfileIdentity,
      narrative: profile.narrative as ProfileNarrative,
      attributes: profile.attributes as ProfileAttributes,
      embedding: profile.embedding,
    };
  }

  async saveProfile(userId: string, profile: ProfileRow): Promise<void> {
    const data = {
      userId,
      identity: profile.identity,
      narrative: profile.narrative,
      attributes: profile.attributes,
      embedding: profile.embedding === null 
        ? null 
        : (Array.isArray(profile.embedding[0])
          ? (profile.embedding as number[][])[0]
          : (profile.embedding as number[])),
      updatedAt: new Date(),
    };
    await db.insert(schema.userProfiles)
      .values(data)
      .onConflictDoUpdate({
        target: schema.userProfiles.userId,
        set: data,
      });
  }

  async saveHydeProfile(userId: string, description: string, embedding: number[]): Promise<void> {
    await db.update(schema.userProfiles)
      .set({
        hydeDescription: description,
        hydeEmbedding: embedding,
        updatedAt: new Date(),
      })
      .where(eq(schema.userProfiles.userId, userId));
  }

  async getUser(userId: string): Promise<User | null> {
    const result = await db.select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return result[0] ?? null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Opportunity Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/** Opportunity row shape (matches protocol Opportunity; confidence as string from numeric). */
interface OpportunityRow {
  id: string;
  detection: schema.OpportunityDetection;
  actors: schema.OpportunityActor[];
  interpretation: schema.OpportunityInterpretation;
  context: schema.OpportunityContext;
  indexId: string;
  confidence: string;
  status: 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

/** Create opportunity input (matches protocol CreateOpportunityData). */
interface CreateOpportunityInput {
  detection: schema.OpportunityDetection;
  actors: schema.OpportunityActor[];
  interpretation: schema.OpportunityInterpretation;
  context: schema.OpportunityContext;
  indexId: string;
  confidence: string;
  status?: 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';
  expiresAt?: Date;
}

function toOpportunityRow(row: typeof opportunities.$inferSelect): OpportunityRow {
  const confidence = row.confidence;
  return {
    id: row.id,
    detection: row.detection as schema.OpportunityDetection,
    actors: row.actors as schema.OpportunityActor[],
    interpretation: row.interpretation as schema.OpportunityInterpretation,
    context: row.context as schema.OpportunityContext,
    indexId: row.indexId,
    confidence: typeof confidence === 'string' ? confidence : String(confidence),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * Database adapter for Opportunity Graph and opportunity controller.
 */
export class OpportunityDatabaseAdapter {
  async getProfile(userId: string): Promise<ProfileRow | null> {
    const result = await db.select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, userId))
      .limit(1);
    const profile = result[0];
    if (!profile) return null;
    return {
      userId: profile.userId,
      identity: profile.identity as ProfileIdentity,
      narrative: profile.narrative as ProfileNarrative,
      attributes: profile.attributes as ProfileAttributes,
      embedding: profile.embedding,
    };
  }

  async createOpportunity(data: CreateOpportunityInput): Promise<OpportunityRow> {
    const [row] = await db
      .insert(opportunities)
      .values({
        detection: data.detection,
        actors: data.actors,
        interpretation: data.interpretation,
        context: data.context,
        indexId: data.indexId,
        confidence: data.confidence,
        status: data.status ?? 'pending',
        expiresAt: data.expiresAt ?? null,
      })
      .returning();
    if (!row) throw new Error('OpportunityDatabaseAdapter.createOpportunity: no row returned');
    return toOpportunityRow(row);
  }

  async getOpportunity(id: string): Promise<OpportunityRow | null> {
    const rows = await db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
    const row = rows[0];
    return row ? toOpportunityRow(row) : null;
  }

  async getOpportunitiesForUser(
    userId: string,
    options?: { status?: string; indexId?: string; role?: string; limit?: number; offset?: number }
  ): Promise<OpportunityRow[]> {
    const actorFilter = sql`${opportunities.actors} @> ${JSON.stringify([{ identityId: userId }])}::jsonb`;
    const conditions = [actorFilter];
    if (options?.status) conditions.push(eq(opportunities.status, options.status as typeof opportunities.$inferSelect.status));
    if (options?.indexId) conditions.push(eq(opportunities.indexId, options.indexId));
    let q = db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(desc(opportunities.createdAt));
    if (options?.limit != null) q = q.limit(options.limit) as typeof q;
    if (options?.offset != null) q = q.offset(options.offset) as typeof q;
    const rows = await q;
    return rows.map(toOpportunityRow);
  }

  async getOpportunitiesForIndex(
    indexId: string,
    options?: { status?: string; limit?: number; offset?: number }
  ): Promise<OpportunityRow[]> {
    const conditions = [eq(opportunities.indexId, indexId)];
    if (options?.status) conditions.push(eq(opportunities.status, options.status as typeof opportunities.$inferSelect.status));
    let q = db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(desc(opportunities.createdAt));
    if (options?.limit != null) q = q.limit(options.limit) as typeof q;
    if (options?.offset != null) q = q.offset(options.offset) as typeof q;
    const rows = await q;
    return rows.map(toOpportunityRow);
  }

  async updateOpportunityStatus(
    id: string,
    status: 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired'
  ): Promise<OpportunityRow | null> {
    const [row] = await db
      .update(opportunities)
      .set({ status, updatedAt: new Date() })
      .where(eq(opportunities.id, id))
      .returning();
    return row ? toOpportunityRow(row) : null;
  }

  async opportunityExistsBetweenActors(actorIds: string[], indexId: string): Promise<boolean> {
    if (actorIds.length === 0) return false;
    const expired = 'expired';
    const conditions = [
      eq(opportunities.indexId, indexId),
      ne(opportunities.status, expired),
    ];
    // Require that all given actorIds appear in actors (opportunity may have extra actors, e.g. introducer)
    for (const actorId of actorIds) {
      conditions.push(
        sql`${opportunities.actors} @> ${JSON.stringify([{ identityId: actorId }])}::jsonb`
      );
    }
    const rows = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(...conditions))
      .limit(1);
    return rows.length > 0;
  }

  async expireOpportunitiesByIntent(intentId: string): Promise<number> {
    const rows = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        sql`${opportunities.actors} @> ${JSON.stringify([{ intents: [intentId] }])}::jsonb`
      );
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.id);
    const updated = await db
      .update(opportunities)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        and(
          sql`${opportunities.actors} @> ${JSON.stringify([{ intents: [intentId] }])}::jsonb`
        )
      )
      .returning({ id: opportunities.id });
    return updated.length;
  }

  async expireOpportunitiesForRemovedMember(indexId: string, userId: string): Promise<number> {
    const updated = await db
      .update(opportunities)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        and(
          eq(opportunities.indexId, indexId),
          sql`${opportunities.actors} @> ${JSON.stringify([{ identityId: userId }])}::jsonb`
        )
      )
      .returning({ id: opportunities.id });
    return updated.length;
  }

  /** Set status to expired for opportunities with expires_at <= now. Used by cron. */
  async expireStaleOpportunities(): Promise<number> {
    const now = new Date();
    const updated = await db
      .update(opportunities)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          isNotNull(opportunities.expiresAt),
          lte(opportunities.expiresAt, now),
          ne(opportunities.status, 'expired')
        )
      )
      .returning({ id: opportunities.id });
    return updated.length;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Index Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Database adapter for Index Graph (intent/index context and assignment).
 */
export class IndexGraphDatabaseAdapter {
  async getIntentForIndexing(intentId: string) {
    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        userId: intents.userId,
        sourceType: intents.sourceType,
        sourceId: intents.sourceId,
      })
      .from(intents)
      .where(eq(intents.id, intentId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getIndexMemberContext(indexId: string, userId: string) {
    const rows = await db
      .select({
        indexId: indexes.id,
        indexPrompt: indexes.prompt,
        memberPrompt: indexMembers.prompt,
      })
      .from(indexes)
      .innerJoin(indexMembers, eq(indexes.id, indexMembers.indexId))
      .where(
        and(
          eq(indexes.id, indexId),
          eq(indexMembers.userId, userId),
          eq(indexMembers.autoAssign, true),
          isNull(indexes.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async isIntentAssignedToIndex(intentId: string, indexId: string): Promise<boolean> {
    const rows = await db
      .select({ indexId: intentIndexes.indexId })
      .from(intentIndexes)
      .where(
        and(
          eq(intentIndexes.intentId, intentId),
          eq(intentIndexes.indexId, indexId)
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async assignIntentToIndex(intentId: string, indexId: string): Promise<void> {
    await db.insert(intentIndexes).values({ intentId, indexId });
  }

  async unassignIntentFromIndex(intentId: string, indexId: string): Promise<void> {
    await db
      .delete(intentIndexes)
      .where(
        and(
          eq(intentIndexes.intentId, intentId),
          eq(intentIndexes.indexId, indexId)
        )
      );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HyDE Document Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/** Input shape for saving a HyDE document (matches CreateHydeDocumentData). */
interface SaveHydeDocumentInput {
  sourceType: HydeSourceTypeLocal;
  sourceId?: string | null;
  sourceText?: string | null;
  strategy: string;
  targetCorpus: string;
  hydeText: string;
  hydeEmbedding: number[];
  context?: Record<string, unknown> | null;
  expiresAt?: Date | null;
}

/**
 * Database adapter for HyDE document persistence (HyDE Graph, maintenance jobs).
 */
export class HydeDatabaseAdapter {
  async getHydeDocument(
    sourceType: HydeSourceTypeLocal,
    sourceId: string,
    strategy: string
  ): Promise<HydeDocumentRow | null> {
    const rows = await db
      .select()
      .from(hydeDocuments)
      .where(
        and(
          eq(hydeDocuments.sourceType, sourceType),
          eq(hydeDocuments.sourceId, sourceId),
          eq(hydeDocuments.strategy, strategy)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? toHydeDocument(row) : null;
  }

  async getHydeDocumentsForSource(
    sourceType: HydeSourceTypeLocal,
    sourceId: string
  ): Promise<HydeDocumentRow[]> {
    const rows = await db
      .select()
      .from(hydeDocuments)
      .where(
        and(
          eq(hydeDocuments.sourceType, sourceType),
          eq(hydeDocuments.sourceId, sourceId)
        )
      );
    return rows.map(toHydeDocument);
  }

  async saveHydeDocument(data: SaveHydeDocumentInput): Promise<HydeDocumentRow> {
    const value = {
      sourceType: data.sourceType,
      sourceId: data.sourceId ?? null,
      sourceText: data.sourceText ?? null,
      strategy: data.strategy,
      targetCorpus: data.targetCorpus,
      context: data.context ?? null,
      hydeText: data.hydeText,
      hydeEmbedding: data.hydeEmbedding,
      expiresAt: data.expiresAt ?? null,
    };
    const inserted = await db
      .insert(hydeDocuments)
      .values(value)
      .onConflictDoUpdate({
        target: [
          hydeDocuments.sourceType,
          hydeDocuments.sourceId,
          hydeDocuments.strategy,
          hydeDocuments.targetCorpus,
        ],
        set: {
          sourceText: value.sourceText,
          context: value.context,
          hydeText: value.hydeText,
          hydeEmbedding: value.hydeEmbedding,
          expiresAt: value.expiresAt,
        },
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('HydeDatabaseAdapter.saveHydeDocument: no row returned');
    return toHydeDocument(row);
  }

  async deleteHydeDocumentsForSource(
    sourceType: HydeSourceTypeLocal,
    sourceId: string
  ): Promise<number> {
    const deleted = await db
      .delete(hydeDocuments)
      .where(
        and(
          eq(hydeDocuments.sourceType, sourceType),
          eq(hydeDocuments.sourceId, sourceId)
        )
      )
      .returning({ id: hydeDocuments.id });
    return deleted.length;
  }

  async deleteExpiredHydeDocuments(): Promise<number> {
    const now = new Date();
    const deleted = await db
      .delete(hydeDocuments)
      .where(
        and(
          isNotNull(hydeDocuments.expiresAt),
          lte(hydeDocuments.expiresAt, now)
        )
      )
      .returning({ id: hydeDocuments.id });
    return deleted.length;
  }

  async getStaleHydeDocuments(threshold: Date): Promise<HydeDocumentRow[]> {
    const rows = await db
      .select()
      .from(hydeDocuments)
      .where(lt(hydeDocuments.createdAt, threshold));
    return rows.map(toHydeDocument);
  }
}
