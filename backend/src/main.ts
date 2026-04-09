import './startup.env';

import { ChatController } from './controllers/chat.controller';
import { DebugController } from './controllers/debug.controller';
import { ToolController } from './controllers/tool.controller';
import { ToolService } from './services/tool.service';
import { S3StorageAdapter } from './adapters/storage.adapter';
import { NetworkController } from './controllers/network.controller';
import { IntentController } from './controllers/intent.controller';
import { LinkController } from './controllers/link.controller';
import { OpportunityController, NetworkOpportunityController } from './controllers/opportunity.controller';
import { AuthController } from './controllers/auth.controller';
import { ProfileController } from './controllers/profile.controller';
import { UserController } from './controllers/user.controller';
import { StorageController } from './controllers/storage.controller';
import { StorageService } from './services/storage.service';
import { SubscribeController } from './controllers/subscribe.controller';
import { UnsubscribeController } from './controllers/unsubscribe.controller';
import { fileService } from './services/file.service';
import { ConversationController } from './controllers/conversation.controller';
import { AgentController } from './controllers/agent.controller';
import { ConversationService } from './services/conversation.service';
import { TaskService } from './services/task.service';
import { IntegrationController } from './controllers/integration.controller';
import { ComposioIntegrationAdapter } from './adapters/integration.adapter';
import { IntegrationService } from './services/integration.service';
import { contactService } from './services/contact.service';
import { RouteRegistry } from './lib/router/router.decorators';
import { log } from './lib/log';
import { getCorsHeaders } from './lib/cors';
import { adminQueuesApp } from './controllers/queues.controller';
import { mcpHandler } from './controllers/mcp.handler';
import { auth } from './lib/betterauth/auth.instance';
import { getStats } from './lib/performance';
// Bootstrap queue workers and HyDE crons (only in this process, not in CLI e.g. db:seed)
import { intentQueue } from './queues/intent.queue';
import { opportunityQueue } from './queues/opportunity.queue';
import { notificationQueue } from './queues/notification.queue';
import { hydeQueue } from './queues/hyde.queue';
import { emailQueue } from './queues/email.queue';
import { profileQueue } from './queues/profile.queue';
import { webhookQueue } from './queues/webhook.queue';
import { negotiationTimeoutQueue } from './queues/negotiation-timeout.queue';
import { WebhookController } from './controllers/webhook.controller';
import { NetworkMembershipEvents } from './events/network_membership.event';
import { IntentEvents } from './events/intent.event';
import { NegotiationEvents } from './events/negotiation.event';
import { AgentDeliveryService } from './services/agent-delivery.service';
import { agentService } from './services/agent.service';
import { opportunityService } from './services/opportunity.service';
import { webhookService } from './services/webhook.service';

intentQueue.startWorker();
opportunityQueue.startWorker();
opportunityQueue.startCrons();
notificationQueue.startWorker();
profileQueue.startWorker();
hydeQueue.startCrons();
emailQueue.startWorker();
webhookQueue.startWorker();
negotiationTimeoutQueue.startWorker();

const agentDeliveryService = new AgentDeliveryService(webhookService, webhookQueue);

NetworkMembershipEvents.onMemberAdded = (userId: string) => {
  profileQueue.addEnsureProfileHydeJob({ userId }).catch((err) => {
    log.job.from('NetworkMembership').error('Failed to enqueue ensure_profile_hyde', { userId, error: err });
  });
};

IntentEvents.onCreated = (intentId: string, userId: string) => {
  log.job.from('IntentEvents').verbose('Intent created, triggering discovery + maintenance', { intentId, userId });
  opportunityQueue.addJob(
    { intentId, userId },
    { priority: 10, jobId: `rediscovery-${userId}-${intentId}-${Math.floor(Date.now() / (6 * 60 * 60 * 1000))}` },
  ).catch((err) => log.job.from('IntentEvents').error('Failed to enqueue discovery on create', { intentId, userId, error: err }));
  opportunityService.triggerMaintenance(userId, 'intent-created');
};

IntentEvents.onUpdated = (intentId: string, userId: string) => {
  log.job.from('IntentEvents').verbose('Intent updated, triggering maintenance', { intentId, userId });
  opportunityService.triggerMaintenance(userId, 'intent-updated');
};

IntentEvents.onArchived = (intentId: string, userId: string) => {
  log.job.from('IntentEvents').verbose('Intent archived, triggering maintenance', { intentId, userId });
  opportunityService.triggerMaintenance(userId, 'intent-archived');
};

// Subscribe to opportunity events to deliver webhooks
opportunityService.onOpportunityEvent('created', async ({ opportunity }) => {
  const actorUserIds = new Set<string>();
  for (const actor of (opportunity.actors ?? []) as Array<{ userId?: string }>) {
    if (actor.userId) actorUserIds.add(actor.userId);
  }

  for (const userId of actorUserIds) {
    try {
      const authorizedAgents = await agentService.findAuthorizedAgents(userId, 'manage:intents', { type: 'global' });
      await agentDeliveryService.enqueueDeliveries({
        userId,
        event: 'opportunity.created',
        payload: {
          opportunityId: opportunity.id,
          status: opportunity.status,
          actors: opportunity.actors,
          createdAt: opportunity.createdAt,
        },
        getJobId: (target) => `webhook-opp-created-${target.id}-${opportunity.id}`,
        authorizedAgents,
      });
    } catch (err) {
      log.job.from('WebhookEvents').error('Failed to enqueue webhook for opportunity.created', {
        userId,
        opportunityId: opportunity.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
});

// Subscribe to negotiation events to deliver webhooks
NegotiationEvents.onStarted = async (data) => {
  try {
    const authorizedAgents = await agentService.findAuthorizedAgents(data.userId, 'manage:negotiations', { type: 'global' });
    await agentDeliveryService.enqueueDeliveries({
      userId: data.userId,
      event: 'negotiation.started',
      payload: {
        negotiationId: data.negotiationId,
        counterpartyId: data.counterpartyId,
        counterpartyName: data.counterpartyName,
      },
      getJobId: (target) => `webhook-neg-started-${target.id}-${data.negotiationId}`,
      authorizedAgents,
    });
  } catch (err) {
    log.job.from('WebhookEvents').error('Failed to enqueue webhook for negotiation.started', {
      userId: data.userId,
      negotiationId: data.negotiationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

NegotiationEvents.onTurnReceived = async (data) => {
  try {
    const authorizedAgents = await agentService.findAuthorizedAgents(data.userId, 'manage:negotiations', { type: 'global' });
    await agentDeliveryService.enqueueDeliveries({
      userId: data.userId,
      event: 'negotiation.turn_received',
      payload: {
        negotiationId: data.negotiationId,
        turnNumber: data.turnNumber,
        counterpartyAction: data.counterpartyAction,
        counterpartyMessage: data.counterpartyMessage,
        deadline: data.deadline,
      },
      getJobId: (target) => `webhook-neg-turn-${target.id}-${data.negotiationId}-${data.turnNumber}`,
      authorizedAgents,
    });
  } catch (err) {
    log.job.from('WebhookEvents').error('Failed to enqueue webhook for negotiation.turn_received', {
      userId: data.userId,
      negotiationId: data.negotiationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

NegotiationEvents.onCompleted = async (data) => {
  try {
    const authorizedAgents = await agentService.findAuthorizedAgents(data.userId, 'manage:negotiations', { type: 'global' });
    await agentDeliveryService.enqueueDeliveries({
      userId: data.userId,
      event: 'negotiation.completed',
      payload: {
        negotiationId: data.negotiationId,
        outcome: data.outcome,
        turnCount: data.turnCount,
      },
      getJobId: (target) => `webhook-neg-completed-${target.id}-${data.negotiationId}`,
      authorizedAgents,
    });
  } catch (err) {
    log.job.from('WebhookEvents').error('Failed to enqueue webhook for negotiation.completed', {
      userId: data.userId,
      negotiationId: data.negotiationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const GLOBAL_PREFIX = '/api';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const logger = log.server.from("main");

/** Match pathname against a route pattern with :param placeholders; returns params or null. */
function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const paramNames: string[] = [];
  const regexStr = pattern.replace(/\/+/g, '/').replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  const regex = new RegExp(`^${regexStr}$`);
  const m = pathname.match(regex);
  if (!m) return null;
  const params: Record<string, string> = {};
  paramNames.forEach((name, i) => {
    params[name] = m[i + 1] ?? '';
  });
  return params;
}

logger.info('Initializing Server...');

// Manually instantiate controllers if needed, or just let strict import handle registration (depends on how decorator works vs instantiation).
// The decorators run when the class is defined (imported).
// However, to invoke methods, we need instances.
if (!process.env.S3_BUCKET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
  logger.error('Missing required S3 env vars: S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
  process.exit(1);
}

const storageAdapter = new S3StorageAdapter({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  bucket: process.env.S3_BUCKET,
});

// Set storage adapter on fileService for S3 file operations
fileService.setStorageAdapter(storageAdapter);

const controllerInstances = new Map();
controllerInstances.set(AuthController, new AuthController());
controllerInstances.set(ProfileController, new ProfileController());
controllerInstances.set(ChatController, new ChatController());
controllerInstances.set(NetworkController, new NetworkController());
controllerInstances.set(IntentController, new IntentController());
controllerInstances.set(LinkController, new LinkController());
controllerInstances.set(OpportunityController, new OpportunityController());
controllerInstances.set(NetworkOpportunityController, new NetworkOpportunityController());
controllerInstances.set(UserController, new UserController());
controllerInstances.set(StorageController, new StorageController(new StorageService(storageAdapter)));
controllerInstances.set(SubscribeController, new SubscribeController());
controllerInstances.set(UnsubscribeController, new UnsubscribeController());
controllerInstances.set(ConversationController, new ConversationController(new ConversationService(), new TaskService()));
controllerInstances.set(AgentController, new AgentController());
const integrationAdapter = new ComposioIntegrationAdapter();
const integrationService = new IntegrationService(integrationAdapter, contactService);
controllerInstances.set(IntegrationController, new IntegrationController(integrationService));
controllerInstances.set(DebugController, new DebugController());
controllerInstances.set(WebhookController, new WebhookController());
const toolService = new ToolService(contactService, integrationService, integrationAdapter);
controllerInstances.set(ToolController, new ToolController(toolService));

logger.info('Routes registered', { prefix: GLOBAL_PREFIX });

// Cron jobs (newsletter, opportunity finder, HyDE) are registered in index.ts (runs with queue workers).
Bun.serve({
  port: PORT,
  idleTimeout: 60, // 60 seconds to prevent request timeout errors
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;

    const corsHeaders = getCorsHeaders(req);

    logger.verbose('Request', { method, path: url.pathname });

    // Handle OPTIONS preflight requests
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      return Response.json(
        {
          status: 'ok',
          timestamp: new Date().toISOString(),
          service: 'protocol-v2',
        },
        { headers: corsHeaders }
      );
    }

    // Bull Board UI at /dev/queues (before API loop so it is always served in dev)
    if (!IS_PRODUCTION && (url.pathname === '/dev/queues' || url.pathname.startsWith('/dev/queues/'))) {
      const res = await adminQueuesApp.fetch(req);
      const newHeaders = new Headers(res.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => newHeaders.set(key, value));
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: newHeaders });
    }

    // Performance stats at /dev/performance (dev only, alongside Bull Board)
    if (!IS_PRODUCTION && url.pathname === '/dev/performance') {
      return Response.json(getStats(), { headers: corsHeaders });
    }

    // Better Auth handles its own /api/auth/* routes (sign-in, sign-up, session, etc.)
    // Our custom auth routes (/api/auth/me, /api/auth/profile/update) fall through to controllers
    const betterAuthPaths = [
      '/api/auth/sign-in', '/api/auth/sign-up', '/api/auth/sign-out',
      '/api/auth/session', '/api/auth/callback', '/api/auth/error',
      '/api/auth/get-session', '/api/auth/forget-password',
      '/api/auth/magic-link', '/api/auth/reset-password', '/api/auth/verify-email',
      '/api/auth/change-password', '/api/auth/change-email',
      '/api/auth/delete-user', '/api/auth/list-sessions',
      '/api/auth/revoke-session', '/api/auth/revoke-other-sessions',
      '/api/auth/update-user',
      '/api/auth/token', '/api/auth/jwks',
      // API key management
      '/api/auth/api-key',
      // MCP OAuth endpoints
      '/api/auth/mcp/',
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-protected-resource',
    ];
    const isBetterAuthRoute = betterAuthPaths.some(p => url.pathname.startsWith(p));
    if (isBetterAuthRoute) {
      // better-call strips basePath via `pathname.split(basePath)`, which only works
      // for paths that contain the basePath string. Root-level /.well-known/* paths
      // don't contain "/api/auth" so the split yields a 1-element array → empty path → 404.
      // Rewriting to /api/auth/.well-known/* makes the split work correctly.
      let handlerReq = req;
      if (url.pathname.startsWith('/.well-known/')) {
        const rewritten = new URL(req.url);
        rewritten.pathname = `/api/auth${url.pathname}`;
        handlerReq = new Request(rewritten.toString(), req);
      }
      const res = await auth.handler(handlerReq);
      const newHeaders = new Headers(res.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => newHeaders.set(key, value));
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: newHeaders });
    }

    // MCP Streamable HTTP endpoint (OPTIONS already handled globally above)
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      return mcpHandler(req, corsHeaders);
    }

    // Iterate over controllers and routes to find a match.

    for (const [target, controllerDef] of RouteRegistry.getControllers()) {
      const routes = RouteRegistry.getRoutes(target);

      for (const route of routes) {
        if (route.method !== method) continue;

        // Construct full path pattern
        // Global Prefix + Controller Prefix + Route Path
        // Ensure slashes are handled correctly
        let fullPath = GLOBAL_PREFIX + controllerDef.path + route.path;
        // Normalize double slashes
        fullPath = fullPath.replace(/\/+/g, '/');
        const hasParams = fullPath.includes(':');
        const params = hasParams ? matchPath(fullPath, url.pathname) : null;
        const isMatch = url.pathname === fullPath || params !== null;

        if (isMatch) {
          const routeParams = params ?? {} as Record<string, string>;
          logger.verbose('Matched route', { path: fullPath, handler: `${target.name}.${String(route.methodName)}`, params: routeParams });
          try {
            const instance = controllerInstances.get(target);
            if (!instance) {
              logger.error('No instance found for controller', { controller: target.name });
              return new Response('Internal Server Error', { status: 500, headers: corsHeaders });
            }

            // Execute Guards
            const guards = RouteRegistry.getGuards(target, route.methodName);
            logger.verbose('Guards found', { count: guards.length });
            let guardResult: unknown = null;

            for (const guard of guards) {
              logger.verbose('Executing guard', { guard: guard.name || 'anonymous' });
              guardResult = await guard(req);
              logger.verbose('Guard execution successful');
            }

            // Invoke handler: (req, user, params?)
            const handler = instance[route.methodName];
            logger.verbose('Invoking handler', { handler: String(route.methodName) });
            const result = await handler.call(instance, req, guardResult, routeParams);
            logger.verbose('Handler invoked successfully');

            // If result is a Response object, add CORS headers and return it.
            if (result instanceof Response) {
              // Clone the response with CORS headers added
              const newHeaders = new Headers(result.headers);
              Object.entries(corsHeaders).forEach(([key, value]) => {
                newHeaders.set(key, value);
              });
              return new Response(result.body, {
                status: result.status,
                statusText: result.statusText,
                headers: newHeaders,
              });
            }
            // Otherwise assume JSON
            return Response.json(result, { headers: corsHeaders });

          } catch (error: unknown) {
            logger.error('Error handling request', {
              method,
              path: fullPath,
              error: error instanceof Error ? error.message : String(error),
            });
            const message = error instanceof Error ? error.message : 'Internal Server Error';
            // Map common auth errors
            if (message === 'Access token required' || message === 'Invalid or expired access token') {
              return new Response(JSON.stringify({ error: message }), { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }
            if (message === 'User not found' || message === 'Account deactivated') {
              return new Response(JSON.stringify({ error: message }), { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }
            if (message === 'Not found') {
              return new Response(JSON.stringify({ error: message }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }

            return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          }
        }
      }
    }

    logger.verbose('No match found', { path: url.pathname });
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
});

logger.info('Server running', { port: PORT });


// Graceful shutdown: close BullMQ workers so stale workers don't linger after restart
const shutdown = async () => {
  logger.info('Shutting down workers...');
  await Promise.allSettled([
    profileQueue.close(),
    intentQueue.close(),
    opportunityQueue.close(),
    notificationQueue.close(),
    emailQueue.close(),
    webhookQueue.close(),
    negotiationTimeoutQueue.close(),
  ]);
  logger.info('Workers closed');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
