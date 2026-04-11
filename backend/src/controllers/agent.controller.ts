import { z } from 'zod';

import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { Controller, Delete, Get, Patch, Post, UseGuards } from '../lib/router/router.decorators';
import { agentService } from '../services/agent.service';

const logger = log.controller.from('agent');

type RouteParams = Record<string, string>;

const createAgentSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  description: z.string().optional(),
});

const updateAgentSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const addTransportSchema = z.object({
  channel: z.enum(['webhook', 'mcp']),
  config: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().optional(),
});

const grantPermissionSchema = z.object({
  actions: z.array(z.string()).min(1, 'actions array is required'),
  scope: z.enum(['global', 'node', 'network']).optional(),
  scopeId: z.string().optional(),
});

const createTokenSchema = z.object({
  name: z.string().optional(),
});

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

function parseErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Unexpected error';
  // Drizzle wraps DB errors in DrizzleQueryError — check for the underlying cause
  const cause = (err as Error & { cause?: unknown }).cause;
  const causeObj = cause as Record<string, unknown> | undefined;
  if (causeObj && typeof causeObj.code === 'string') {
    logger.error('Database error in agent controller', { message: causeObj.message, code: causeObj.code, detail: causeObj.detail });
    return 'Database error';
  }
  return err.message;
}

function errorStatus(err: unknown, fallback = 400): number {
  const message = parseErrorMessage(err);
  if (message === 'Agent not found' || message === 'Transport not found' || message === 'Permission not found' || message === 'Token not found') {
    return 404;
  }

  if (message === 'Not authorized' || message.startsWith('System agents cannot')) {
    return 403;
  }

  return fallback;
}

function hasWebhookEvents(config?: Record<string, unknown>): boolean {
  const events = config?.events;
  return Array.isArray(events) && events.some((event) => typeof event === 'string' && event.trim());
}

async function parseBody<T>(req: Request, schema: z.ZodSchema<T>): Promise<T | Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return jsonError(issue?.message ?? 'Invalid request body', 400);
  }

  return parsed.data;
}

async function parseOptionalBody<T>(req: Request, schema: z.ZodSchema<T>, emptyValue: unknown): Promise<T | Response> {
  const text = await req.text().catch(() => '');
  const trimmed = text.trim();

  let raw: unknown;
  if (!trimmed) {
    raw = emptyValue;
  } else {
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return jsonError('Invalid JSON body', 400);
    }
  }

  const parsed = schema.safeParse(raw ?? emptyValue);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return jsonError(issue?.message ?? 'Invalid request body', 400);
  }

  return parsed.data;
}

@Controller('/agents')
export class AgentController {
  @Get('')
  @UseGuards(AuthGuard)
  async list(_req: Request, user: AuthenticatedUser) {
    const agents = await agentService.listForUser(user.id);
    logger.verbose('Listed agents', { userId: user.id, count: agents.length });
    return Response.json({ agents });
  }

  @Post('')
  @UseGuards(AuthGuard)
  async create(req: Request, user: AuthenticatedUser) {
    const body = await parseBody(req, createAgentSchema);
    if (body instanceof Response) {
      return body;
    }

    try {
      const agent = await agentService.create(user.id, body.name, body.description);
      return Response.json({ agent }, { status: 201 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Get('/:id')
  @UseGuards(AuthGuard)
  async getById(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    try {
      const agent = await agentService.getById(agentId, user.id);
      return Response.json({ agent });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err, 404));
    }
  }

  @Patch('/:id')
  @UseGuards(AuthGuard)
  async update(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    const body = await parseBody(req, updateAgentSchema);
    if (body instanceof Response) {
      return body;
    }

    try {
      const agent = await agentService.update(agentId, user.id, body);
      return Response.json({ agent });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Delete('/:id')
  @UseGuards(AuthGuard)
  async remove(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    try {
      await agentService.delete(agentId, user.id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/transports')
  @UseGuards(AuthGuard)
  async addTransport(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    const body = await parseBody(req, addTransportSchema);
    if (body instanceof Response) {
      return body;
    }

    if (body.channel === 'webhook' && !hasWebhookEvents(body.config)) {
      return jsonError('Webhook events are required', 400);
    }

    try {
      const transport = await agentService.addTransport(
        agentId,
        user.id,
        body.channel,
        body.config,
        body.priority,
      );
      return Response.json({ transport }, { status: 201 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Delete('/:id/transports/:transportId')
  @UseGuards(AuthGuard)
  async removeTransport(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    const transportId = params?.transportId;
    if (!agentId || !transportId) {
      return jsonError('Agent ID and transport ID are required', 400);
    }

    try {
      await agentService.removeTransport(agentId, transportId, user.id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/test-webhooks')
  @UseGuards(AuthGuard)
  async testWebhooks(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    try {
      const result = await agentService.testWebhooks(agentId, user.id);
      return Response.json(result);
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/permissions')
  @UseGuards(AuthGuard)
  async grantPermission(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    const body = await parseBody(req, grantPermissionSchema);
    if (body instanceof Response) {
      return body;
    }

    try {
      const permission = await agentService.grantPermission(
        agentId,
        user.id,
        body.actions,
        body.scope,
        body.scopeId,
      );
      return Response.json({ permission }, { status: 201 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Delete('/:id/permissions/:permissionId')
  @UseGuards(AuthGuard)
  async revokePermission(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    const permissionId = params?.permissionId;
    if (!agentId || !permissionId) {
      return jsonError('Agent ID and permission ID are required', 400);
    }

    try {
      await agentService.revokePermission(agentId, permissionId, user.id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Get('/:id/tokens')
  @UseGuards(AuthGuard)
  async listTokens(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    try {
      const tokens = await agentService.listTokens(agentId, user.id);
      return Response.json({ tokens });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/tokens')
  @UseGuards(AuthGuard)
  async createToken(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    const body = await parseOptionalBody(req, createTokenSchema, {});
    if (body instanceof Response) {
      return body;
    }

    try {
      const token = await agentService.createToken(agentId, user.id, body.name);
      return Response.json({ token }, { status: 201 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Delete('/:id/tokens/:tokenId')
  @UseGuards(AuthGuard)
  async revokeToken(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    const tokenId = params?.tokenId;
    if (!agentId || !tokenId) {
      return jsonError('Agent ID and token ID are required', 400);
    }

    try {
      await agentService.revokeToken(agentId, tokenId, user.id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }
}
