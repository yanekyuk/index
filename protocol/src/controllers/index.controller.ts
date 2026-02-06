import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { Controller, Delete, Get, Patch, Post, UseGuards } from '../lib/router/router.decorators';
import { indexService } from '../services/index.service';

const logger = log.controller.from('index');

@Controller('/indexes')
export class IndexController {
  /**
   * List indexes the authenticated user is a member of, including their personal index.
   */
  @Get('')
  @UseGuards(AuthGuard)
  async list(_req: Request, user: AuthenticatedUser) {
    const result = await indexService.getIndexesForUser(user.id);
    logger.info('Indexes listed for user', { userId: user.id, count: result.indexes.length });
    return Response.json(result);
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
   * Get members of an index. Owner-only.
   */
  @Get('/:id/members')
  @UseGuards(AuthGuard)
  async getMembers(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      const members = await indexService.getMembersForOwner(params.id, user.id);
      logger.info('Members listed for index', { indexId: params.id, count: members.length });
      return Response.json({
        members,
        metadataKeys: [],
        pagination: { page: 1, limit: members.length, total: members.length, totalPages: 1 },
      });
    } catch (err: any) {
      if (err?.message?.includes('Access denied')) {
        return new Response(JSON.stringify({ error: err.message }), {
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
    } catch (err: any) {
      if (err?.message?.includes('Access denied')) {
        return new Response(JSON.stringify({ error: err.message }), {
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
      logger.info('Member removed from index', { indexId: params.id, memberId: params.memberId });
      return Response.json({ success: true });
    } catch (err: any) {
      if (err?.message?.includes('Access denied')) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (err?.message === 'Member not found') {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (err?.message === 'Cannot remove yourself from the index') {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 400,
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
      logger.info('Permissions updated for index', { indexId: params.id });
      return Response.json({ index: result });
    } catch (err: any) {
      if (err?.message?.includes('Access denied')) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Delete (soft-delete) an index. Owner-only.
   */
  @Delete('/:id')
  @UseGuards(AuthGuard)
  async delete(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await indexService.deleteIndex(params.id, user.id);
      logger.info('Index deleted', { indexId: params.id, userId: user.id });
      return Response.json({ success: true });
    } catch (err: any) {
      if (err?.message?.includes('Access denied')) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Get a single index by ID with owner info and member count. Members-only.
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
    } catch (err: any) {
      if (err?.message?.includes('Access denied')) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }
}
