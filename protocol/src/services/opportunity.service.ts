import { log } from '../lib/log';
import type { Id } from '../types/common.types';
import type {
  OpportunityControllerDatabase,
  OpportunityGraphDatabase,
  HydeGraphDatabase,
  CreateOpportunityData,
  OpportunityActor,
} from '../lib/protocol/interfaces/database.interface';
import type { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import type { HydeCache } from '../lib/protocol/interfaces/cache.interface';
import { OpportunityGraph } from '../lib/protocol/graphs/opportunity/opportunity.graph';
import { HydeGraphFactory } from '../lib/protocol/graphs/hyde/hyde.graph';
import { HydeGenerator } from '../lib/protocol/agents/hyde/hyde.generator';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { presentOpportunity, type UserInfo } from '../lib/protocol/opportunity/opportunity.presentation';

const logger = log.service.from("OpportunityService");

/**
 * OpportunityService
 * 
 * Manages opportunity operations including discovery, listing, and creation.
 * Uses OpportunityControllerDatabase adapter for database operations.
 * Uses OpportunityGraph for AI-powered opportunity discovery.
 * 
 * RESPONSIBILITIES:
 * - List opportunities for users and indexes
 * - Get and present individual opportunities
 * - Discover opportunities via HyDE graph
 * - Create manual opportunities
 * - Update opportunity status
 */
export class OpportunityService {
  private db: OpportunityControllerDatabase;
  private graph: ReturnType<OpportunityGraph['compile']> | null = null;

  constructor(database?: OpportunityControllerDatabase) {
    this.db = database ?? (new ChatDatabaseAdapter() as OpportunityControllerDatabase);
    
    // Lazy-build graph for discover when adapter supports it
    if (this.db && 'getHydeDocument' in this.db) {
      const embedder: Embedder = new EmbedderAdapter();
      const cache: HydeCache = new RedisCacheAdapter();
      const generator = new HydeGenerator();
      const compiledHydeGraph = new HydeGraphFactory(
        this.db as unknown as HydeGraphDatabase,
        embedder,
        cache,
        generator
      ).createGraph();
      const opportunityGraph = new OpportunityGraph(
        this.db as unknown as OpportunityGraphDatabase,
        embedder,
        cache,
        compiledHydeGraph
      );
      this.graph = opportunityGraph.compile();
    }
  }

  /**
   * Get opportunities for a user with optional filters.
   * 
   * @param userId - The user ID
   * @param options - Filter options (status, indexId, limit, offset)
   * @returns List of opportunities
   */
  async getOpportunitiesForUser(
    userId: string,
    options?: {
      status?: 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';
      indexId?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    logger.info('[OpportunityService] Getting opportunities for user', { userId, options });
    
    return this.db.getOpportunitiesForUser(userId, options);
  }

  /**
   * Get a single opportunity with full presentation details.
   * 
   * @param opportunityId - The opportunity ID
   * @param viewerId - The user viewing the opportunity
   * @returns Opportunity with presentation data or null
   */
  async getOpportunityWithPresentation(opportunityId: string, viewerId: string) {
    logger.info('[OpportunityService] Getting opportunity', { opportunityId, viewerId });

    const opp = await this.db.getOpportunity(opportunityId);
    if (!opp) {
      return null;
    }

    // Check if viewer is an actor
    const isActor = opp.actors.some((a) => a.identityId === viewerId);
    if (!isActor) {
      return { error: 'Not authorized to view this opportunity', status: 403 };
    }

    const myActor = opp.actors.find((a) => a.identityId === viewerId)!;
    const introducer = opp.actors.find((a) => a.role === 'introducer');
    const introducerId = introducer?.identityId;
    const nonIntroducerActors = opp.actors.filter((a) => a.role !== 'introducer' && a.identityId !== viewerId);
    const otherPartyIds = nonIntroducerActors.map((a) => a.identityId);

    const [indexRecord, ...userRecords] = await Promise.all([
      this.db.getIndex(opp.indexId),
      ...otherPartyIds.map((uid) => this.db.getUser(uid)),
    ]);
    const introducerRecord = introducerId ? await this.db.getUser(introducerId) : null;
    const introducerInfo: UserInfo | null = introducerRecord
      ? { id: introducerRecord.id, name: introducerRecord.name ?? 'Unknown', avatar: introducerRecord.avatar ?? null }
      : null;

    const userMap = new Map<string | null, UserInfo>();
    otherPartyIds.forEach((uid, i) => {
      const u = userRecords[i];
      userMap.set(uid, u ? { id: u.id, name: u.name ?? 'Unknown', avatar: u.avatar ?? null } : { id: uid, name: 'Unknown', avatar: null });
    });

    const otherPartyInfo = otherPartyIds[0] ? userMap.get(otherPartyIds[0])! : { id: '', name: 'Unknown', avatar: null as string | null };
    const presentation = presentOpportunity(opp, viewerId, otherPartyInfo, introducerInfo, 'card');

    const otherParties = nonIntroducerActors.map((a) => {
      const info = userMap.get(a.identityId) ?? { id: a.identityId, name: 'Unknown', avatar: null as string | null };
      return { id: info.id, name: info.name, avatar: info.avatar, role: a.role };
    });

    const confidenceNum = typeof opp.interpretation.confidence === 'number'
      ? opp.interpretation.confidence
      : parseFloat(opp.confidence ?? opp.interpretation.confidence as unknown as string) || 0;

    return {
      id: opp.id,
      presentation,
      myRole: myActor.role,
      otherParties,
      introducedBy: introducerInfo ?? undefined,
      category: opp.interpretation.category,
      confidence: confidenceNum,
      index: indexRecord ? { id: indexRecord.id, title: indexRecord.title } : { id: opp.indexId, title: '' },
      status: opp.status,
      createdAt: opp.createdAt instanceof Date ? opp.createdAt.toISOString() : opp.createdAt,
      expiresAt: opp.expiresAt ? (opp.expiresAt instanceof Date ? opp.expiresAt.toISOString() : opp.expiresAt) : undefined,
    };
  }

  /**
   * Update opportunity status.
   * 
   * @param opportunityId - The opportunity ID
   * @param status - New status
   * @param userId - User making the update (for authorization)
   * @returns Updated opportunity or error
   */
  async updateOpportunityStatus(
    opportunityId: string,
    status: 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired',
    userId: string
  ) {
    logger.info('[OpportunityService] Updating opportunity status', { opportunityId, status, userId });

    const opp = await this.db.getOpportunity(opportunityId);
    if (!opp) {
      return { error: 'Opportunity not found', status: 404 };
    }

    const isActor = opp.actors.some((a) => a.identityId === userId);
    if (!isActor) {
      return { error: 'Not authorized to update this opportunity', status: 403 };
    }

    return this.db.updateOpportunityStatus(opportunityId, status);
  }

  /**
   * Discover opportunities via HyDE graph.
   * 
   * @param userId - The user ID
   * @param query - Search query
   * @param limit - Number of results
   * @returns Discovery results
   */
  async discoverOpportunities(userId: string, query: string, limit: number = 5) {
    logger.info('[OpportunityService] Discovering opportunities', { userId, query, limit });

    if (!this.graph) {
      return { error: 'Discovery not available; graph dependencies not configured', status: 503 };
    }

    const memberships = await this.db.getIndexMemberships(userId);
    const indexScope = memberships.map((m) => m.indexId);
    
    if (indexScope.length === 0) {
      return {
        sourceUserId: userId as Id<'users'>,
        options: { hydeDescription: query, limit },
        indexScope: [],
        candidates: [],
        opportunities: [],
      };
    }

    const result = await this.graph.invoke({
      sourceUserId: userId as Id<'users'>,
      sourceText: query,
      indexScope: indexScope as Id<'indexes'>[],
      options: { hydeDescription: query, limit },
    });

    return result;
  }

  /**
   * Get opportunities for a specific index.
   * 
   * @param indexId - The index ID
   * @param userId - User requesting (for authorization)
   * @param options - Filter options
   * @returns List of opportunities or error
   */
  async getOpportunitiesForIndex(
    indexId: string,
    userId: string,
    options?: {
      status?: 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';
      limit?: number;
      offset?: number;
    }
  ) {
    logger.info('[OpportunityService] Getting opportunities for index', { indexId, userId, options });

    const isOwner = await this.db.isIndexOwner(indexId, userId);
    const isMember = await this.db.isIndexMember(indexId, userId);
    
    if (!isOwner && !isMember) {
      return { error: 'Not a member of this index', status: 403 };
    }

    return this.db.getOpportunitiesForIndex(indexId, options);
  }

  /**
   * Create a manual opportunity (curator feature).
   * 
   * @param indexId - The index ID
   * @param creatorId - User creating the opportunity
   * @param data - Opportunity creation data
   * @returns Created opportunity or error
   */
  async createManualOpportunity(
    indexId: string,
    creatorId: string,
    data: {
      parties: Array<{ userId: string; intentId?: string }>;
      reasoning: string;
      category?: string;
      confidence?: number;
    }
  ) {
    logger.info('[OpportunityService] Creating manual opportunity', { indexId, creatorId });

    // Check permission
    const permission = await this.checkCreatePermission(creatorId, data.parties, indexId);
    if (!permission.allowed) {
      return { error: 'Not authorized to create opportunities in this index', status: 403 };
    }

    // Check for duplicates
    const partyIds = data.parties.map((p) => p.userId);
    const exists = await this.db.opportunityExistsBetweenActors(partyIds, indexId);
    if (exists) {
      return { error: 'Opportunity already exists between these parties', status: 409 };
    }

    // Build actors
    const actors: OpportunityActor[] = data.parties.map((p) => ({
      role: 'party',
      identityId: p.userId,
      intents: p.intentId ? [p.intentId] : [],
      profile: true,
    }));
    actors.push({ role: 'introducer', identityId: creatorId, intents: [], profile: false });

    const conf = data.confidence ?? 0.8;
    const opportunityData: CreateOpportunityData = {
      detection: {
        source: 'manual',
        createdBy: creatorId,
        timestamp: new Date().toISOString(),
      },
      actors,
      interpretation: {
        category: data.category ?? 'collaboration',
        summary: data.reasoning,
        confidence: conf,
        signals: [{ type: 'curator_judgment', weight: 1, detail: 'Manual match by curator' }],
      },
      context: { indexId },
      indexId,
      confidence: String(conf),
      status: 'pending',
    };

    return this.db.createOpportunity(opportunityData);
  }

  /**
   * Check if user has permission to create opportunities in an index.
   * 
   * @param creatorId - User creating the opportunity
   * @param parties - Parties involved
   * @param indexId - The index ID
   * @returns Permission result
   */
  private async checkCreatePermission(
    creatorId: string,
    parties: Array<{ userId: string }>,
    indexId: string
  ): Promise<{ allowed: boolean }> {
    const isOwner = await this.db.isIndexOwner(indexId, creatorId);
    const isSelfIncluded = parties.some((p) => p.userId === creatorId);
    
    if (isOwner) return { allowed: true };
    
    const isMember = await this.db.isIndexMember(indexId, creatorId);
    if (!isMember) return { allowed: false };
    if (isSelfIncluded) return { allowed: true };
    
    return { allowed: true };
  }
}

export const opportunityService = new OpportunityService();
