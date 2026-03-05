import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { Controller, Delete, Get, Patch, Post, Put, UseGuards } from '../lib/router/router.decorators';
import { indexService } from '../services/index.service';

const logger = log.controller.from('index');

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Controller('/indexes')
export class IndexController {
  /**
   * List indexes the authenticated user is a member of, including their personal index.
   */
  @Get('')
  @UseGuards(AuthGuard)
  async list(_req: Request, user: AuthenticatedUser) {
    const result = await indexService.getIndexesForUser(user.id);
    logger.verbose('Indexes listed for user', { userId: user.id, count: result.indexes.length });
    return Response.json(result);
  }

  /**
   * Create a new index. Authenticated users only.
   */
  @Post('')
  @UseGuards(AuthGuard)
  async create(req: Request, user: AuthenticatedUser) {
    const body = await req.json().catch(() => ({})) as {
      title?: string;
      prompt?: string;
      imageUrl?: string | null;
      joinPolicy?: 'anyone' | 'invite_only';
      allowGuestVibeCheck?: boolean;
    };
    
    if (!body.title) {
      return new Response(JSON.stringify({ error: 'title is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await indexService.createIndex(user.id, {
      title: body.title,
      prompt: body.prompt,
      imageUrl: body.imageUrl,
      joinPolicy: body.joinPolicy,
      allowGuestVibeCheck: body.allowGuestVibeCheck,
    });
    logger.verbose('Index created', { indexId: result.id, userId: user.id });
    return Response.json({ index: result });
  }

  /**
   * Search users by name/email, optionally excluding existing members of an index.
   */
  @Get('/search-users')
  @UseGuards(AuthGuard)
  async searchPersonalIndexMembers(req: Request, user: AuthenticatedUser) {
    const url = new URL(req.url);
    const q = url.searchParams.get('q') || '';
    const indexId = url.searchParams.get('indexId') || undefined;
    const users = await indexService.searchPersonalIndexMembers(user.id, q, indexId);
    return Response.json({ users });
  }

  /**
   * Get all members of every index the signed-in user is a member of (deduplicated).
   * Used for mentionable users (e.g. @mentions in chat).
   */
  @Get('/my-members')
  @UseGuards(AuthGuard)
  async getMyMembers(_req: Request, user: AuthenticatedUser) {
    const members = await indexService.getMembersFromMyIndexes(user.id);
    logger.verbose('My-index members listed', { userId: user.id, count: members.length });
    return Response.json({ members });
  }

  /**
   * Get members of an index. Owner-only.
   */
  @Get('/:id/members')
  @UseGuards(AuthGuard)
  async getMembers(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      const members = await indexService.getMembersForOwner(params.id, user.id);
      logger.verbose('Members listed for index', { indexId: params.id, count: members.length });
      return Response.json({
        members,
        metadataKeys: [],
        pagination: { page: 1, limit: members.length, total: members.length, totalPages: 1 },
      });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Add a member to an index. Owner/admin-only.
   */
  @Post('/:id/members')
  @UseGuards(AuthGuard)
  async addMember(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    const body = await req.json().catch(() => ({})) as { userId?: string; permissions?: string[] };
    if (!body.userId) {
      return new Response(JSON.stringify({ error: 'userId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    try {
      const role = body.permissions?.includes('admin') ? 'admin' as const : 'member' as const;
      const result = await indexService.addMember(params.id, body.userId, user.id, role);
      return Response.json({ member: result.member, message: result.alreadyMember ? 'Already a member' : 'Member added' });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Remove a member from an index. Owner-only.
   */
  @Delete('/:id/members/:memberId')
  @UseGuards(AuthGuard)
  async removeMember(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await indexService.removeMember(params.id, params.memberId, user.id);
      logger.verbose('Member removed from index', { indexId: params.id, memberId: params.memberId });
      return Response.json({ success: true });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (msg === 'Member not found') {
        return new Response(JSON.stringify({ error: msg }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (msg === 'Cannot remove yourself from the index') {
        return new Response(JSON.stringify({ error: msg }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Update an index (title, prompt, permissions). Owner-only.
   */
  @Put('/:id')
  @UseGuards(AuthGuard)
  async update(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      const body = await req.json().catch(() => ({})) as {
        title?: string;
        prompt?: string | null;
        imageUrl?: string | null;
        joinPolicy?: 'anyone' | 'invite_only';
        allowGuestVibeCheck?: boolean;
      };
      const result = await indexService.updateIndex(params.id, user.id, body);
      logger.verbose('Index updated', { indexId: params.id });
      return Response.json({ index: result });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Update index permissions. Owner-only.
   */
  @Patch('/:id/permissions')
  @UseGuards(AuthGuard)
  async updatePermissions(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      const body = await req.json().catch(() => ({})) as { joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean };
      const result = await indexService.updatePermissions(params.id, user.id, body);
      logger.verbose('Permissions updated for index', { indexId: params.id });
      return Response.json({ index: result });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Get public indexes that the user has not joined (discovery).
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Get('/discovery/public')
  @UseGuards(AuthGuard)
  async getPublicIndexes(_req: Request, user: AuthenticatedUser) {
    const result = await indexService.getPublicIndexes(user.id);
    logger.verbose('Public indexes listed for user', { userId: user.id, count: result.indexes.length });
    return Response.json(result);
  }

  /**
   * Delete (soft-delete) an index. Owner-only.
   */
  @Delete('/:id')
  @UseGuards(AuthGuard)
  async delete(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await indexService.deleteIndex(params.id, user.id);
      logger.verbose('Index deleted', { indexId: params.id, userId: user.id });
      return Response.json({ success: true });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Join a public index.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Post('/:id/join')
  @UseGuards(AuthGuard)
  async joinPublicIndex(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      const index = await indexService.joinPublicIndex(params.id, user.id);
      logger.verbose('User joined public index', { indexId: params.id, userId: user.id });
      return Response.json({ index });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('not found')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (msg.includes('not public')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Get current user's member settings (permissions and ownership status).
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Get('/:id/member-settings')
  @UseGuards(AuthGuard)
  async getMemberSettings(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      const settings = await indexService.getMemberSettings(params.id, user.id);
      logger.verbose('Member settings retrieved', { indexId: params.id, userId: user.id });
      return Response.json(settings);
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Not a member')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Get current user's intents in an index. Members only.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Get('/:id/my-intents')
  @UseGuards(AuthGuard)
  async getMyIntents(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      const intents = await indexService.getMyIntentsInIndex(params.id, user.id);
      logger.verbose('My intents retrieved for index', { indexId: params.id, userId: user.id, count: intents.length });
      return Response.json({ intents });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied') || msg.includes('Not a member')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Leave an index. Members (non-owners) can leave.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Post('/:id/leave')
  @UseGuards(AuthGuard)
  async leaveIndex(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await indexService.leaveIndex(params.id, user.id);
      logger.verbose('User left index', { indexId: params.id, userId: user.id });
      return Response.json({ success: true });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('not found') || msg.includes('not a member')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (msg.includes('Cannot leave')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Get a public index by ID (no auth required). Only works for indexes with joinPolicy 'anyone'.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Get('/public/:id')
  async getPublicIndex(_req: Request, _user: unknown, params: Record<string, string>) {
    const index = await indexService.getPublicIndexById(params.id);
    if (!index) {
      return new Response(JSON.stringify({ error: 'Index not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return Response.json({ index });
  }

  /**
   * Get a single index by ID with owner info and member count. Members-only.
   * IMPORTANT: This must come AFTER specific routes like /discovery/public and /:id/join.
   */
  @Get('/:id')
  @UseGuards(AuthGuard)
  async get(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      const index = await indexService.getIndexById(params.id, user.id);
      if (!index) {
        return new Response(JSON.stringify({ error: 'Index not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return Response.json({ index });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }
}
