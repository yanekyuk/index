import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { Controller, Delete, Get, Post, UseGuards } from '../lib/router/router.decorators';
import type { IntegrationAdapter } from '../lib/protocol/interfaces/integration.interface';

/**
 * Thin proxy to the integration adapter (Composio).
 * No backend storage — all state lives in Composio.
 */
@Controller('/integrations')
export class IntegrationController {
  constructor(private adapter: IntegrationAdapter) {}

  /**
   * List connected accounts for the authenticated user.
   * GET /api/integrations
   */
  @Get('')
  @UseGuards(AuthGuard)
  async list(_req: Request, user: AuthenticatedUser) {
    const connections = await this.adapter.listConnections(user.id);
    return { connections };
  }

  /**
   * Start OAuth flow to connect a toolkit.
   * POST /api/integrations/connect/:toolkit
   */
  @Post('/connect/:toolkit')
  @UseGuards(AuthGuard)
  async connect(_req: Request, user: AuthenticatedUser, params: { toolkit: string }) {
    const baseUrl = (process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/$/, '');
    const callbackUrl = `${baseUrl}/oauth/callback`;
    const result = await this.adapter.getAuthUrl(user.id, params.toolkit, callbackUrl);
    return result;
  }

  /**
   * Disconnect (delete) a connected account.
   * Verifies the connection belongs to the authenticated user before deleting.
   * DELETE /api/integrations/:id
   */
  @Delete('/:id')
  @UseGuards(AuthGuard)
  async disconnect(_req: Request, user: AuthenticatedUser, params: { id: string }) {
    const connections = await this.adapter.listConnections(user.id);
    const owns = connections.some((c) => c.id === params.id);
    if (!owns) {
      return new Response(JSON.stringify({ error: 'Connection not found' }), { status: 404 });
    }
    const result = await this.adapter.disconnect(params.id);
    return result;
  }
}
