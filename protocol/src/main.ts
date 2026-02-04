import { ChatController } from './controllers/chat.controller';
import { IntentController } from './controllers/intent.controller';
import { OpportunityController, IndexOpportunityController } from './controllers/opportunity.controller';
import { ChatDatabaseAdapter } from './adapters/database.adapter';
import type { OpportunityControllerDatabase } from './lib/protocol/interfaces/database.interface';
import { ProfileController } from './controllers/profile.controller';
import { UploadController } from './controllers/upload.controller';
import { RouteRegistry } from './lib/router/router.decorators';
import { log } from './lib/log';

const PORT = 3003;
const GLOBAL_PREFIX = '/v2';

const logger = log.server.from('main.ts');

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

logger.info('Initializing V2 Server...');

// Manually instantiate controllers if needed, or just let strict import handle registration (depends on how decorator works vs instantiation).
// The decorators run when the class is defined (imported).
// However, to invoke methods, we need instances.
const controllerInstances = new Map();
controllerInstances.set(ProfileController, new ProfileController());
controllerInstances.set(ChatController, new ChatController());
controllerInstances.set(IntentController, new IntentController());
const opportunityDb: OpportunityControllerDatabase = new ChatDatabaseAdapter() as OpportunityControllerDatabase;
controllerInstances.set(OpportunityController, new OpportunityController(opportunityDb));
controllerInstances.set(IndexOpportunityController, new IndexOpportunityController(opportunityDb));
controllerInstances.set(UploadController, new UploadController());

logger.info('Routes registered', { prefix: GLOBAL_PREFIX });

Bun.serve({
  port: PORT,
  idleTimeout: 60, // 60 seconds to prevent request timeout errors
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;

    // CORS headers for cross-origin requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Expose-Headers': 'X-Session-Id',
      'Access-Control-Max-Age': '86400',
    };

    logger.info('Request', { method, path: url.pathname });

    // Handle OPTIONS preflight requests
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Iterate over controllers and routes to find a match.
    // Optimization: could pre-compile regular expressions or a router map.
    // For now, simple iteration is fine for small number of routes.

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
        // Remove trailing slash if strictly matching, or just strip both
        const hasParams = fullPath.includes(':');
        const params = hasParams ? matchPath(fullPath, url.pathname) : null;
        const isMatch = url.pathname === fullPath || params !== null;

        if (isMatch) {
          const routeParams = params ?? {} as Record<string, string>;
          logger.info('Matched route', { path: fullPath, handler: `${target.name}.${String(route.methodName)}`, params: routeParams });
          try {
            const instance = controllerInstances.get(target);
            if (!instance) {
              logger.error('No instance found for controller', { controller: target.name });
              return new Response('Internal Server Error', { status: 500, headers: corsHeaders });
            }

            // Execute Guards
            const guards = RouteRegistry.getGuards(target, route.methodName);
            logger.info('Guards found', { count: guards.length });
            let guardResult: any = null;

            for (const guard of guards) {
              logger.info('Executing guard', { guard: guard.name || 'anonymous' });
              guardResult = await guard(req);
              logger.info('Guard execution successful');
            }

            // Invoke handler: (req, user, params?)
            const handler = instance[route.methodName];
            logger.info('Invoking handler', { handler: String(route.methodName) });
            const result = await handler.call(instance, req, guardResult, routeParams);
            logger.info('Handler invoked successfully');

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

          } catch (error: any) {
            logger.error('Error handling request', {
              method,
              path: fullPath,
              error: error?.message ?? String(error),
            });
            const message = error.message || 'Internal Server Error';
            // Map common auth errors
            if (message === 'Access token required' || message === 'Invalid or expired access token') {
              return new Response(JSON.stringify({ error: message }), { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }
            if (message === 'User not found' || message === 'Account deactivated') {
              return new Response(JSON.stringify({ error: message }), { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }

            return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          }
        }
      }
    }

    logger.info('No match found', { path: url.pathname });
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
});

logger.info('V2 Server running', { port: PORT });
