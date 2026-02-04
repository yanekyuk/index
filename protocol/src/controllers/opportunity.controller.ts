import type {
  OpportunityControllerDatabase,
  OpportunityGraphDatabase,
  HydeGraphDatabase,
  CreateOpportunityData,
  OpportunityActor,
} from '../lib/protocol/interfaces/database.interface';
import type { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import { OpportunityGraph } from '../lib/protocol/graphs/opportunity/opportunity.graph';
import { HydeGraphFactory } from '../lib/protocol/graphs/hyde/hyde.graph';
import { HydeGenerator } from '../lib/protocol/agents/hyde/hyde.generator';
import type { HydeCache } from '../lib/protocol/interfaces/cache.interface';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { presentOpportunity, type UserInfo } from '../lib/protocol/opportunity/opportunity.presentation';

import { Controller, Get, Post, Patch, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';

/** Route params when path has :id or :indexId */
type RouteParams = Record<string, string>;

/**
 * OpportunityController: REST API for opportunities.
 * Constructor injects OpportunityControllerDatabase; discover builds graph from same adapter.
 */
@Controller('/opportunities')
export class OpportunityController {
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
   * GET /opportunities — list opportunities for the authenticated user.
   */
  @Get('')
  @UseGuards(AuthGuard)
  async listOpportunities(req: Request, user: AuthenticatedUser, _params?: RouteParams) {
    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? undefined;
    const indexId = url.searchParams.get('indexId') ?? undefined;
    const limit = url.searchParams.get('limit');
    const offset = url.searchParams.get('offset');
    const options = {
      status: status as 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired' | undefined,
      indexId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    };
    const list = await this.db.getOpportunitiesForUser(user.id, options);
    return Response.json({ opportunities: list });
  }

  /**
   * GET /opportunities/:id — get one opportunity with presentation for the viewer.
   */
  @Get('/:id')
  @UseGuards(AuthGuard)
  async getOpportunity(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing opportunity id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const opp = await this.db.getOpportunity(id);
    if (!opp) {
      return new Response(JSON.stringify({ error: 'Opportunity not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const isActor = opp.actors.some((a) => a.identityId === user.id);
    if (!isActor) {
      return new Response(JSON.stringify({ error: 'Not authorized to view this opportunity' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const myActor = opp.actors.find((a) => a.identityId === user.id)!;
    const otherActors = opp.actors.filter((a) => a.identityId !== user.id);
    const introducer = opp.actors.find((a) => a.role === 'introducer');
    const otherPartyIds = otherActors.map((a) => a.identityId);
    const introducerId = introducer?.identityId;

    const [indexRecord, ...userRecords] = await Promise.all([
      this.db.getIndex(opp.indexId),
      ...otherPartyIds.map((uid) => this.db.getUser(uid)),
      introducerId ? this.db.getUser(introducerId) : Promise.resolve(null),
    ]);
    const userMap = new Map<string | null, UserInfo>();
    otherPartyIds.forEach((uid, i) => {
      const u = userRecords[i];
      userMap.set(uid, u ? { id: u.id, name: u.name ?? 'Unknown', avatar: u.avatar ?? null } : { id: uid, name: 'Unknown', avatar: null });
    });
    const introducerInfo: UserInfo | null =
      introducerId && userRecords[otherPartyIds.length]
        ? {
            id: (userRecords[otherPartyIds.length] as { id: string }).id,
            name: (userRecords[otherPartyIds.length] as { name?: string }).name ?? 'Unknown',
            avatar: (userRecords[otherPartyIds.length] as { avatar?: string | null })?.avatar ?? null,
          }
        : null;

    // For multiple other parties we use the first for presentation title; all are in otherParties.
    const otherPartyInfo = otherPartyIds[0] ? userMap.get(otherPartyIds[0])! : { id: '', name: 'Unknown', avatar: null as string | null };
    const presentation = presentOpportunity(opp, user.id, otherPartyInfo, introducerInfo, 'card');

    const otherParties = otherActors.map((a) => {
      const info = userMap.get(a.identityId) ?? { id: a.identityId, name: 'Unknown', avatar: null as string | null };
      return { id: info.id, name: info.name, avatar: info.avatar, role: a.role };
    });

    const confidenceNum = typeof opp.interpretation.confidence === 'number'
      ? opp.interpretation.confidence
      : parseFloat(opp.confidence ?? opp.interpretation.confidence as unknown as string) || 0;

    return Response.json({
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
    });
  }

  /**
   * PATCH /opportunities/:id/status — update status (e.g. viewed, accepted, rejected).
   */
  @Patch('/:id/status')
  @UseGuards(AuthGuard)
  async updateStatus(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing opportunity id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    let body: { status?: string };
    try {
      body = (await req.json()) as { status?: string };
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const status = body.status as 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired' | undefined;
    const allowed = ['pending', 'viewed', 'accepted', 'rejected', 'expired'];
    if (!status || !allowed.includes(status)) {
      return new Response(JSON.stringify({ error: 'Invalid status; use one of: ' + allowed.join(', ') }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const opp = await this.db.getOpportunity(id);
    if (!opp) {
      return new Response(JSON.stringify({ error: 'Opportunity not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const isActor = opp.actors.some((a) => a.identityId === user.id);
    if (!isActor) {
      return new Response(JSON.stringify({ error: 'Not authorized to update this opportunity' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const updated = await this.db.updateOpportunityStatus(id, status);
    return Response.json(updated);
  }

  /**
   * POST /opportunities/discover — discover opportunities via HyDE graph (unchanged).
   */
  @Post('/discover')
  @UseGuards(AuthGuard)
  async discover(req: Request, user: AuthenticatedUser) {
    if (!this.graph) {
      return new Response(
        JSON.stringify({ error: 'Discovery not available; graph dependencies not configured' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const body = (await req.json()) as { query?: string; limit?: number };
    const { query, limit = 5 } = body ?? {};

    if (!query || typeof query !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid "query" field in request body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const memberships = await this.db.getIndexMemberships(user.id);
    const indexScope = memberships.map((m) => m.indexId);
    if (indexScope.length === 0) {
      return Response.json({
        sourceUserId: user.id,
        options: { hydeDescription: query, limit },
        indexScope: [],
        candidates: [],
        opportunities: [],
      });
    }

    const result = await this.graph.invoke({
      sourceUserId: user.id,
      sourceText: query,
      indexScope,
      options: { hydeDescription: query, limit },
    });

    return Response.json(result);
  }
}

/**
 * Index-scoped opportunity routes: GET/POST /indexes/:indexId/opportunities.
 * Permission: list requires member; create requires owner or member (with rules).
 */
@Controller('/indexes')
export class IndexOpportunityController {
  constructor(private db: OpportunityControllerDatabase) {}

  /**
   * GET /indexes/:indexId/opportunities — list opportunities for an index (owner or member).
   */
  @Get('/:indexId/opportunities')
  @UseGuards(AuthGuard)
  async listForIndex(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const indexId = params?.indexId;
    if (!indexId) {
      return new Response(JSON.stringify({ error: 'Missing index id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const isOwner = await this.db.isIndexOwner(indexId, user.id);
    const isMember = await this.db.isIndexMember(indexId, user.id);
    if (!isOwner && !isMember) {
      return new Response(JSON.stringify({ error: 'Not a member of this index' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? undefined;
    const limit = url.searchParams.get('limit');
    const offset = url.searchParams.get('offset');
    const list = await this.db.getOpportunitiesForIndex(indexId, {
      status: status as 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired' | undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return Response.json({ opportunities: list });
  }

  /**
   * POST /indexes/:indexId/opportunities — create a manual opportunity (curator).
   */
  @Post('/:indexId/opportunities')
  @UseGuards(AuthGuard)
  async createManual(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const indexId = params?.indexId;
    if (!indexId) {
      return new Response(JSON.stringify({ error: 'Missing index id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    let body: { parties?: Array<{ userId: string; intentId?: string }>; reasoning?: string; category?: string; confidence?: number };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const { parties, reasoning, category, confidence } = body ?? {};
    if (!parties || !Array.isArray(parties) || parties.length < 2 || !reasoning || typeof reasoning !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Body must include parties (array of at least 2 { userId, intentId? }) and reasoning (string)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const permission = await this.checkCreatePermission(user.id, parties, indexId);
    if (!permission.allowed) {
      return new Response(JSON.stringify({ error: 'Not authorized to create opportunities in this index' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const partyIds = parties.map((p) => p.userId);
    const exists = await this.db.opportunityExistsBetweenActors(partyIds, indexId);
    if (exists) {
      return new Response(JSON.stringify({ error: 'Opportunity already exists between these parties' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const actors: OpportunityActor[] = parties.map((p) => ({
      role: 'party',
      identityId: p.userId,
      intents: p.intentId ? [p.intentId] : [],
      profile: true,
    }));
    actors.push({ role: 'introducer', identityId: user.id, intents: [], profile: false });

    const conf = confidence ?? 0.8;
    const data: CreateOpportunityData = {
      detection: {
        source: 'manual',
        createdBy: user.id,
        timestamp: new Date().toISOString(),
      },
      actors,
      interpretation: {
        category: category ?? 'collaboration',
        summary: reasoning,
        confidence: conf,
        signals: [{ type: 'curator_judgment', weight: 1, detail: 'Manual match by curator' }],
      },
      context: { indexId },
      indexId,
      confidence: String(conf),
      status: 'pending',
    };

    const opportunity = await this.db.createOpportunity(data);
    return new Response(JSON.stringify(opportunity), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async checkCreatePermission(
    creatorId: string,
    parties: Array<{ userId: string }>,
    indexId: string
  ): Promise<{ allowed: boolean; requiresApproval: boolean }> {
    const isOwner = await this.db.isIndexOwner(indexId, creatorId);
    const isSelfIncluded = parties.some((p) => p.userId === creatorId);
    if (isOwner) return { allowed: true, requiresApproval: false };
    const isMember = await this.db.isIndexMember(indexId, creatorId);
    if (!isMember) return { allowed: false, requiresApproval: false };
    if (isSelfIncluded) return { allowed: true, requiresApproval: false };
    return { allowed: true, requiresApproval: true };
  }
}
