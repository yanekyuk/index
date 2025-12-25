import { sql, isNotNull, desc, ne, and, eq, isNull, inArray } from 'drizzle-orm';
import { userProfiles, intents, intentIndexes } from '../../schema';
import { VectorStore, VectorSearchResult, VectorStoreOption } from '../embedder.types';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../schema';

export type DrizzleDB = PostgresJsDatabase<typeof schema>;


export class PostgresVectorStore implements VectorStore {
  constructor(private db: DrizzleDB) { }

  async search<T>(
    queryVector: number[],
    collection: string,
    options?: VectorStoreOption<T>
  ): Promise<VectorSearchResult<T>[]> {
    const limit = options?.limit || 10;

    // Postgres implementation ignores 'candidates' as it queries the DB directly.

    if (collection === 'profiles') {
      return this.searchProfiles(queryVector, limit, options?.filter);
    }

    if (collection === 'intents') {
      return this.searchIntents(queryVector, limit, options?.filter);
    }

    throw new Error(`Collection '${collection}' not supported in PostgresVectorStore`);
  }


  private async searchProfiles<T>(vector: number[], limit: number, filter?: Record<string, any>): Promise<VectorSearchResult<T>[]> {
    const vectorString = JSON.stringify(vector);

    // Build conditions
    const conditions = [isNotNull(userProfiles.embedding)];

    if (filter) {
      if (filter.userId && typeof filter.userId === 'object' && filter.userId.ne) {
        conditions.push(ne(userProfiles.userId, filter.userId.ne));
      }
    }

    const whereClause = and(...conditions);

    const resultsWithDistance = await this.db.select({
      item: userProfiles,
      distance: sql<number>`${userProfiles.embedding} <=> ${vectorString}`
    })
      .from(userProfiles)
      .where(whereClause)
      .orderBy(sql`${userProfiles.embedding} <=> ${vectorString}`)
      .limit(limit);

    return resultsWithDistance.map((r: any) => ({
      item: r.item as unknown as T,
      score: 1 - r.distance
    }));
  }

  private async searchIntents<T>(vector: number[], limit: number, filter?: Record<string, any>): Promise<VectorSearchResult<T>[]> {
    const vectorString = JSON.stringify(vector);

    const conditions = [isNotNull(intents.embedding)];

    let needsIndexJoin = false;

    if (filter) {
      // Exclude specific ID (e.g. source intent)
      if (filter.id && typeof filter.id === 'object' && filter.id.ne) {
        conditions.push(ne(intents.id, filter.id.ne));
      }

      if (filter.userId) {
        if (typeof filter.userId === 'object' && filter.userId.ne) {
          conditions.push(ne(intents.userId, filter.userId.ne));
        }
        if (typeof filter.userId === 'object' && Array.isArray(filter.userId.in)) {
          if (filter.userId.in.length > 0) {
            conditions.push(inArray(intents.userId, filter.userId.in));
          } else {
            return [];
          }
        }
      }

      // Filter by Index IDs (Privacy Scope)
      if (filter.indexIds && Array.isArray(filter.indexIds)) {
        if (filter.indexIds.length > 0) {
          conditions.push(inArray(intentIndexes.indexId, filter.indexIds));
          needsIndexJoin = true;
        } else {
          // If filtered by indexIds is requested but empty list provided -> return nothing (no access)
          return [];
        }
      }

      // Filter archived
      if (filter.archivedAt === null) {
        conditions.push(isNull(intents.archivedAt));
      }
    }

    const whereClause = and(...conditions);

    let query = this.db.select({
      item: intents,
      distance: sql<number>`${intents.embedding} <=> ${vectorString}`
    })
      .from(intents);

    if (needsIndexJoin) {
      query = query.innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId)) as any;
    }

    const resultsWithDistance = await query
      .where(whereClause)
      .orderBy(sql`${intents.embedding} <=> ${vectorString}`)
      .limit(limit);

    return resultsWithDistance.map((r: any) => ({
      item: r.item as unknown as T,
      score: 1 - r.distance
    }));
  }
}
