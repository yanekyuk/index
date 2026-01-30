import { ChatController } from './controllers/chat.controller';
import { IntentController } from './controllers/intent.controller';
import { OpportunityController } from './controllers/opportunity.controller';
import { ProfileController } from './controllers/profile.controller';
import { RouteRegistry } from './lib/router/router.decorators';

const PORT = 3003;
const GLOBAL_PREFIX = '/v2';

console.log('Initializing V2 Server...');

// Manually instantiate controllers if needed, or just let strict import handle registration (depends on how decorator works vs instantiation).
// The decorators run when the class is defined (imported).
// However, to invoke methods, we need instances.
const controllerInstances = new Map();
controllerInstances.set(ProfileController, new ProfileController());
controllerInstances.set(ChatController, new ChatController());
controllerInstances.set(IntentController, new IntentController());
controllerInstances.set(OpportunityController, new OpportunityController());

console.log(`Routes registered with prefix ${GLOBAL_PREFIX}`);

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

    console.log(`[V2] Request: ${method} ${url.pathname}`);

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
        // For simplicity: exact string match for now. Parameters not yet supported in this simple V1.

        if (url.pathname === fullPath) {
          console.log(`[V2] Matched Route: ${fullPath} -> ${target.name}.${String(route.methodName)}`);
          try {
            const instance = controllerInstances.get(target);
            if (!instance) {
              console.error(`No instance found for controller ${target.name}`);
              return new Response('Internal Server Error', { status: 500, headers: corsHeaders });
            }

            // Execute Guards
            const guards = RouteRegistry.getGuards(target, route.methodName);
            console.log(`[V2] Found ${guards.length} guards`);
            let guardResult: any = null;

            for (const guard of guards) {
              console.log(`[V2] Executing guard ${guard.name || 'anonymous'}`);
              // Pass the previous guard result if needed, or just req
              // For now, guards take req. We might want to chain them or have them return context.
              // Our simple AuthGuard returns the user.
              guardResult = await guard(req);
              console.log(`[V2] Guard execution successful`);
            }

            // Invoke handler
            const handler = instance[route.methodName];
            console.log(`[V2] Invoking handler ${String(route.methodName)}`);
            // Pass req and guardResult (likely the User object)
            // If multiple guards, this simple logic passes the LAST guard's result.
            // A more robust system would build a context object.
            const result = await handler.call(instance, req, guardResult);
            console.log(`[V2] Handler invoked successfully`);

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
            console.error(`Error handling ${method} ${fullPath}:`, error);
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

    console.log(`[V2] No match found for ${url.pathname}`);
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
});

console.log(`🚀 V2 Server running on port ${PORT}`);
