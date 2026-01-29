import { eq, and, isNotNull, ne, sql } from 'drizzle-orm';
import * as schema from '../lib/schema';
import db from '../lib/db';
import { OpportunityGraphDatabase } from '../lib/protocol/interfaces/database.interface';
import { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import { OpportunityGraph } from '../lib/protocol/graphs/opportunity/opportunity.graph';
import { ProfileDocument } from '../lib/protocol/agents/profile/profile.generator';
import { IndexEmbedder } from '../lib/embedder';
import { VectorSearchResult, VectorStoreOption } from '../lib/embedder/embedder.types';
import { CandidateProfile } from '../lib/protocol/agents/opportunity/opportunity.evaluator';

// --- Adapters ---

/**
 * Database adapter implementing OpportunityGraphDatabase interface.
 * Provides profile lookup for opportunity graph operations.
 */
export class OpportunityDatabaseAdapter implements OpportunityGraphDatabase {
  /**
   * Retrieves a user profile by userId.
   * @param userId - The unique identifier of the user
   * @returns The user's profile as ProfileDocument or null if not found
   */
  async getProfile(userId: string): Promise<ProfileDocument | null> {
    const result = await db.select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, userId))
      .limit(1);

    // Cast to ProfileDocument - the schema structure matches the agent output structure
    return (result[0] as unknown as ProfileDocument) || null;
  }
}

/**
 * Vector search function for profiles collection.
 * Injected into IndexEmbedder to enable semantic search during opportunity discovery.
 * 
 * @param vector - Query vector for similarity search
 * @param collection - Must be 'profiles' for this adapter
 * @param options - Search options (limit, filter)
 * @returns Array of profiles with similarity scores
 */
async function searchProfiles<T>(
  vector: number[],
  collection: string,
  options?: VectorStoreOption<T>
): Promise<VectorSearchResult<T>[]> {
  if (collection !== 'profiles') {
    throw new Error(`OpportunityController searcher only supports 'profiles' collection, got '${collection}'`);
  }

  const limit = options?.limit || 10;
  const filter = options?.filter;
  const vectorString = JSON.stringify(vector);

  // Build conditions
  const conditions = [isNotNull(schema.userProfiles.embedding)];

  if (filter) {
    // Handle userId exclusion filter (ne = not equal)
    if (filter.userId && typeof filter.userId === 'object' && (filter.userId as any).ne) {
      conditions.push(ne(schema.userProfiles.userId, (filter.userId as any).ne));
    }
  }

  const whereClause = and(...conditions);

  const resultsWithDistance = await db.select({
    item: schema.userProfiles,
    distance: sql<number>`${schema.userProfiles.embedding} <=> ${vectorString}`
  })
    .from(schema.userProfiles)
    .where(whereClause)
    .orderBy(sql`${schema.userProfiles.embedding} <=> ${vectorString}`)
    .limit(limit);

  return resultsWithDistance.map((r: any) => ({
    item: r.item as unknown as T,
    score: 1 - r.distance // Convert distance to similarity score
  }));
}

// --- Controller ---

import { Controller, Post, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';

/**
 * OpportunityController handles opportunity discovery for users.
 * Uses the OpportunityGraph to find matching candidates based on profile similarity.
 */
@Controller('/opportunities')
export class OpportunityController {
  private db: OpportunityGraphDatabase;
  private embedder: Embedder;
  private graph: ReturnType<OpportunityGraph['compile']>;

  constructor() {
    this.db = new OpportunityDatabaseAdapter();
    // IndexEmbedder with injected profile search strategy
    this.embedder = new IndexEmbedder({
      searcher: searchProfiles
    });
    
    // Compile the graph once during initialization
    const opportunityGraph = new OpportunityGraph(this.db, this.embedder);
    this.graph = opportunityGraph.compile();
  }

  /**
   * Discover opportunities for the authenticated user based on a query.
   * 
   * The query is used as a HyDE (Hypothetical Document Embedding) description
   * to find candidates whose profiles semantically match what the user is looking for.
   * 
   * @param req - The HTTP request object (body contains query and optional limit)
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with discovered opportunities
   * 
   * @example
   * POST /opportunities/discover
   * Body: { "query": "Looking for AI/ML engineers", "limit": 5 }
   */
  @Post('/discover')
  @UseGuards(AuthGuard)
  async discover(req: Request, user: AuthenticatedUser) {
    // Parse request body
    const body = await req.json() as { query: string; limit?: number };
    const { query, limit = 5 } = body;

    if (!query || typeof query !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid "query" field in request body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Invoke the graph with user context and search options
    const result = await this.graph.invoke({
      sourceUserId: user.id,
      options: {
        hydeDescription: query,
        limit,
        filter: {
          userId: { ne: user.id } // Exclude the requesting user from results
        }
      }
    });

    return Response.json(result);
  }
}
