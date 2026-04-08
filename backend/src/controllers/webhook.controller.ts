import { webhookService } from '../services/webhook.service';
import { WEBHOOK_EVENTS } from '../lib/webhook-events';
import { Controller, Get, Post, Delete, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';

const _logger = log.controller.from('webhook');

type RouteParams = Record<string, string>;

/**
 * WebhookController
 *
 * HTTP endpoints for managing webhook registrations.
 * Delegates all business logic to WebhookService.
 */
@Controller('/webhooks')
export class WebhookController {
  /**
   * List available webhook event types.
   * No auth required -- enables discovery for external consumers.
   */
  @Get('/events')
  async listEvents() {
    return Response.json({ events: WEBHOOK_EVENTS });
  }

  /**
   * Register a new webhook.
   *
   * @returns 201 with { id, secret }
   */
  @Post('/')
  @UseGuards(AuthGuard)
  async create(req: Request, user: AuthenticatedUser) {
    let body: { url?: string; events?: string[]; description?: string };
    try {
      body = await req.json() as { url?: string; events?: string[]; description?: string };
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!body.url || !body.events || !Array.isArray(body.events)) {
      return new Response(
        JSON.stringify({ error: 'url and events[] are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    try {
      const result = await webhookService.create(user.id, body.url, body.events, body.description);
      return new Response(
        JSON.stringify(result),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create webhook';
      const status = message.includes('Invalid') || message.includes('At least') ? 400 : 500;
      return new Response(
        JSON.stringify({ error: message }),
        { status, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  /**
   * List all webhooks for the authenticated user (secrets masked).
   */
  @Get('/')
  @UseGuards(AuthGuard)
  async list(_req: Request, user: AuthenticatedUser) {
    const webhooks = await webhookService.list(user.id);
    return Response.json({ webhooks });
  }

  /**
   * Delete a webhook by ID.
   *
   * @returns 204 No Content
   */
  @Delete('/:id')
  @UseGuards(AuthGuard)
  async remove(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const webhookId = params?.id;
    if (!webhookId) {
      return new Response(
        JSON.stringify({ error: 'Webhook ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    try {
      await webhookService.delete(user.id, webhookId);
      return new Response(null, { status: 204 });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete webhook';
      if (message === 'Not found') {
        return new Response(
          JSON.stringify({ error: 'Not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ error: message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  /**
   * Send a test webhook delivery.
   */
  @Post('/:id/test')
  @UseGuards(AuthGuard)
  async test(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const webhookId = params?.id;
    if (!webhookId) {
      return new Response(
        JSON.stringify({ error: 'Webhook ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    try {
      const result = await webhookService.test(user.id, webhookId);
      return Response.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to test webhook';
      if (message === 'Not found') {
        return new Response(
          JSON.stringify({ error: 'Not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ error: message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }
}
