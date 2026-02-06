import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { Controller, Get, Patch, Post, UseGuards } from '../lib/router/router.decorators';
import { intentService } from '../services/intent.service';
import { userService } from '../services/user.service';

const logger = log.controller.from('intent');

@Controller('/intents')
export class IntentController {
  /**
   * List intents with pagination and filters.
   */
  @Post('/list')
  @UseGuards(AuthGuard)
  async list(req: Request, user: AuthenticatedUser) {
    const body = await req.json().catch(() => ({})) as {
      page?: number;
      limit?: number;
      archived?: boolean;
      sourceType?: string;
    };

    const result = await intentService.listIntents(user.id, {
      page: body.page,
      limit: body.limit,
      archived: body.archived,
      sourceType: body.sourceType,
    });

    return Response.json({
      intents: result.intents.map(r => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        archivedAt: r.archivedAt?.toISOString() ?? null,
      })),
      pagination: result.pagination,
    });
  }

  /**
   * Get a single intent by ID.
   */
  @Get('/:id')
  @UseGuards(AuthGuard)
  async getById(_req: Request, user: AuthenticatedUser, params: { id: string }) {
    const r = await intentService.getById(params.id, user.id);

    if (!r) {
      return Response.json({ error: 'Intent not found' }, { status: 404 });
    }

    return Response.json({
      intent: {
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        archivedAt: r.archivedAt?.toISOString() ?? null,
      },
    });
  }

  /**
   * Archive an intent.
   */
  @Patch('/:id/archive')
  @UseGuards(AuthGuard)
  async archive(_req: Request, user: AuthenticatedUser, params: { id: string }) {
    const result = await intentService.archive(params.id, user.id);
    
    if (!result.success) {
      return Response.json({ error: result.error }, { status: 404 });
    }

    return Response.json({ success: true });
  }

  /**
   * Process user input through the Intent Graph.
   */
  @Post('/process')
  @UseGuards(AuthGuard)
  async process(req: Request, user: AuthenticatedUser) {
    logger.info('Intent process requested', { userId: user.id });

    let content: string | undefined;
    try {
      const body = await req.json() as { content?: string };
      content = body.content;
    } catch {
      // No body or invalid JSON
    }

    const userWithGraph = await userService.findWithGraph(user.id);
    const userProfile = userWithGraph?.profile ? JSON.stringify(userWithGraph.profile) : '{}';
    const result = await intentService.processIntent(user.id, userProfile, content);

    return Response.json(result);
  }
}
