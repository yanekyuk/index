# MCP Server & Plugin Skill Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the protocol's 27 chat tools as a Streamable HTTP MCP server at `/mcp`, add OAuth + API key auth via Better Auth plugins, and rewrite the Claude plugin skills to use MCP tools instead of CLI commands.

**Architecture:** MCP server factory in `lib/protocol/mcp/` receives `ToolDeps` and `McpAuthResolver` via injection, registers all tools from `createToolRegistry()`. A standalone handler in `controllers/mcp.handler.ts` wires auth + transport + CORS. Skills in `plugin/skills/` are rewritten to mirror `chat.prompt.ts` guidance using MCP tool calls instead of CLI commands.

**Tech Stack:** `@modelcontextprotocol/server`, `@modelcontextprotocol/hono`, `@better-auth/api-key`, `@better-auth/oauth-provider`, Bun, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-02-mcp-server-and-plugin-rewrite-design.md`

---

## File Map

### New Files
| File | Responsibility |
|---|---|
| `protocol/src/lib/protocol/interfaces/auth.interface.ts` | `McpAuthResolver` interface |
| `protocol/src/lib/protocol/mcp/mcp.server.ts` | MCP server factory — creates `McpServer`, registers tools from registry |
| `protocol/src/controllers/mcp.handler.ts` | HTTP handler — wires transport, auth, CORS for `/mcp` route |
| `protocol/tests/mcp.test.ts` | Integration tests for MCP server |
| `plugin/skills/index-network/SKILL.md` | Rewritten parent skill |
| `plugin/skills/index-network-onboard/SKILL.md` | Rewritten onboard sub-skill |
| `plugin/skills/index-network-discover/SKILL.md` | Rewritten discover sub-skill |
| `plugin/skills/index-network-signal/SKILL.md` | Rewritten signal sub-skill |
| `plugin/skills/index-network-connect/SKILL.md` | Rewritten connect sub-skill |

### Modified Files
| File | Change |
|---|---|
| `protocol/package.json` | Add 4 dependencies |
| `protocol/src/lib/betterauth/betterauth.ts` | Add `apiKey` + `oauthProvider` plugins |
| `protocol/src/main.ts` | Add MCP route block + extend `betterAuthPaths` |
| `plugin/.claude-plugin/plugin.json` | Version bump |

---

## Task 1: Install Dependencies & Generate Migration

**Files:**
- Modify: `protocol/package.json`
- Modify: `protocol/src/lib/betterauth/betterauth.ts:1-124`
- Create: `protocol/drizzle/0032_add_api_key_and_oauth_tables.sql` (auto-generated, then renamed)
- Modify: `protocol/drizzle/meta/_journal.json`

- [ ] **Step 1: Install MCP and Better Auth packages**

```bash
cd protocol && bun add @modelcontextprotocol/server @modelcontextprotocol/hono @better-auth/api-key @better-auth/oauth-provider
```

- [ ] **Step 2: Add Better Auth plugins to `betterauth.ts`**

In `protocol/src/lib/betterauth/betterauth.ts`, add the imports at the top (after the existing `better-auth/plugins` import):

```ts
import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
```

Then add the two plugins to the `plugins` array inside `createAuth()`, after the existing `jwt()` plugin:

```ts
      jwt({
        // ... existing config ...
      }),
      apiKey({
        enableSessionForAPIKeys: true,
      }),
      oauthProvider({
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
```

- [ ] **Step 3: Generate the database migration**

```bash
cd protocol && bun run db:generate
```

This creates a new migration SQL file in `protocol/drizzle/`. The file will have a random name.

- [ ] **Step 4: Rename the migration file**

Rename the generated file to `0032_add_api_key_and_oauth_tables.sql`. Then update `protocol/drizzle/meta/_journal.json` — change the `tag` of the new entry from the random name to `0032_add_api_key_and_oauth_tables`.

- [ ] **Step 5: Apply the migration**

```bash
cd protocol && bun run db:migrate
```

- [ ] **Step 6: Verify no pending schema changes**

```bash
cd protocol && bun run db:generate
```

Expected: "No schema changes, nothing to migrate."

- [ ] **Step 7: Commit**

```bash
cd protocol
git add package.json bun.lock src/lib/betterauth/betterauth.ts drizzle/
git commit -m "feat: add Better Auth API key and OAuth provider plugins with migration"
```

---

## Task 2: Extend `main.ts` Route Paths for Better Auth

**Files:**
- Modify: `protocol/src/main.ts:194-204`

- [ ] **Step 1: Add OAuth and API key paths to `betterAuthPaths`**

In `protocol/src/main.ts`, find the `betterAuthPaths` array (line ~194) and add the new paths:

```ts
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
      // OAuth 2.1 provider
      '/oauth2/',
      '/.well-known/oauth-authorization-server',
    ];
```

- [ ] **Step 2: Verify the server starts**

```bash
cd protocol && bun run dev
```

Expected: Server starts without errors. Hit `http://localhost:3001/.well-known/oauth-authorization-server` — should return OAuth metadata JSON (from Better Auth's OAuth provider plugin).

- [ ] **Step 3: Commit**

```bash
cd protocol
git add src/main.ts
git commit -m "feat: extend Better Auth routes for API key and OAuth provider endpoints"
```

---

## Task 3: Create `McpAuthResolver` Interface

**Files:**
- Create: `protocol/src/lib/protocol/interfaces/auth.interface.ts`

- [ ] **Step 1: Create the interface file**

Create `protocol/src/lib/protocol/interfaces/auth.interface.ts`:

```ts
/**
 * Resolves the authenticated user ID from an incoming request.
 * Injected into the MCP server factory so the protocol layer
 * stays independent of any specific auth implementation.
 */
export interface McpAuthResolver {
  /**
   * Extracts and validates the authenticated user's ID from the request.
   * @param request - The incoming HTTP request
   * @returns The authenticated user's UUID
   * @throws Error if authentication fails (no token, invalid token, etc.)
   */
  resolveUserId(request: Request): Promise<string>;
}
```

- [ ] **Step 2: Run type check**

```bash
cd protocol && bunx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd protocol
git add src/lib/protocol/interfaces/auth.interface.ts
git commit -m "feat: add McpAuthResolver interface for protocol-layer auth abstraction"
```

---

## Task 4: Create MCP Server Factory

**Files:**
- Create: `protocol/src/lib/protocol/mcp/mcp.server.ts`

This is the core protocol-layer module. It takes `ToolDeps` and creates an MCP server with all tools registered.

- [ ] **Step 1: Create the MCP server factory**

Create `protocol/src/lib/protocol/mcp/mcp.server.ts`:

```ts
/**
 * MCP Server Factory — creates a Model Context Protocol server exposing
 * all chat agent tools. Lives in the protocol layer so it can be reused
 * when the protocol is published as an NPM package.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ToolDeps, ResolvedToolContext } from "../tools/tool.helpers";
import { resolveChatContext } from "../tools/tool.helpers";
import { createToolRegistry } from "../tools/tool.registry";
import type { McpAuthResolver } from "../interfaces/auth.interface";
import { protocolLogger } from "../support/protocol.logger";

const logger = protocolLogger("McpServer");

/** Options for creating the MCP server. */
export interface McpServerOptions {
  /** Shared tool dependencies (graphs, database, embedder, etc.). */
  deps: ToolDeps;
  /** Auth resolver for extracting userId from requests. */
  authResolver: McpAuthResolver;
}

/**
 * Creates a configured McpServer with all 27 chat agent tools registered.
 *
 * Tools are registered by iterating over the existing tool registry.
 * Each MCP tool handler resolves auth → resolves chat context → invokes
 * the raw tool handler → returns the result as MCP content blocks.
 *
 * @param options - Tool deps and auth resolver
 * @returns Configured McpServer instance (not yet connected to a transport)
 */
export function createMcpServer(options: McpServerOptions): McpServer {
  const { deps, authResolver } = options;

  const server = new McpServer({
    name: "index-network",
    version: "1.0.0",
  });

  const registry = createToolRegistry(deps);

  logger.verbose(`Registering ${registry.size} tools with MCP server`);

  for (const [name, tool] of registry) {
    // Convert Zod schema to a JSON Schema description for MCP.
    // The MCP SDK accepts Zod schemas directly via zod/v4 Standard Schema,
    // but our tool schemas are zod v3. We pass them as-is — the SDK
    // handles ZodObject instances for input validation.
    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: tool.schema as z.ZodObject<z.ZodRawShape>,
      },
      async (args: Record<string, unknown>, extra) => {
        // Resolve the authenticated user from the originating HTTP request.
        // The transport attaches the request to extra.requestInfo.
        const request = (extra as { requestInfo?: { request?: Request } })
          .requestInfo?.request;

        if (!request) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "No request context available" }) }],
            isError: true,
          };
        }

        let userId: string;
        try {
          userId = await authResolver.resolveUserId(request);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
            isError: true,
          };
        }

        // Resolve chat context (user, profile, indexes).
        let context: ResolvedToolContext;
        try {
          context = await resolveChatContext({
            database: deps.database,
            userId,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
            isError: true,
          };
        }

        // Invoke the raw tool handler.
        try {
          const result = await tool.handler({ context, query: args });
          return {
            content: [{ type: "text" as const, text: result }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`MCP tool ${name} failed`, { userId, error: message });
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
            isError: true,
          };
        }
      },
    );
  }

  logger.verbose("MCP server created successfully");
  return server;
}
```

- [ ] **Step 2: Run type check**

```bash
cd protocol && bunx tsc --noEmit
```

Expected: No errors. If the MCP SDK types differ from what's shown (e.g., `extra.requestInfo` structure), adjust based on the actual SDK types. Check `node_modules/@modelcontextprotocol/server/dist/index.d.ts` for the `ToolCallback` signature if needed.

- [ ] **Step 3: Commit**

```bash
cd protocol
git add src/lib/protocol/mcp/mcp.server.ts
git commit -m "feat: add MCP server factory with tool registry integration"
```

---

## Task 5: Create MCP HTTP Handler

**Files:**
- Create: `protocol/src/controllers/mcp.handler.ts`

This wires the MCP server to the Streamable HTTP transport with auth resolution.

- [ ] **Step 1: Create the handler**

Create `protocol/src/controllers/mcp.handler.ts`:

```ts
/**
 * MCP HTTP Handler — wires the MCP server to Streamable HTTP transport.
 * Mounted in main.ts as a standalone route handler (not a @Controller).
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/hono";
import { jwtVerify, createRemoteJWKSet } from "jose";

import {
  chatDatabaseAdapter,
  createUserDatabase,
  createSystemDatabase,
  conversationDatabaseAdapter,
} from "../adapters/database.adapter";
import { EmbedderAdapter } from "../adapters/embedder.adapter";
import { ScraperAdapter } from "../adapters/scraper.adapter";
import { RedisCacheAdapter } from "../adapters/cache.adapter";
import { ComposioIntegrationAdapter } from "../adapters/integration.adapter";

import { IntentGraphFactory } from "../lib/protocol/graphs/intent.graph";
import { ProfileGraphFactory } from "../lib/protocol/graphs/profile.graph";
import { OpportunityGraphFactory } from "../lib/protocol/graphs/opportunity.graph";
import { HydeGraphFactory } from "../lib/protocol/graphs/hyde.graph";
import { IndexGraphFactory } from "../lib/protocol/graphs/index.graph";
import { IndexMembershipGraphFactory } from "../lib/protocol/graphs/index_membership.graph";
import { IntentIndexGraphFactory } from "../lib/protocol/graphs/intent_index.graph";
import { NegotiationGraphFactory } from "../lib/protocol/graphs/negotiation.graph";
import { HydeGenerator } from "../lib/protocol/agents/hyde.generator";
import { LensInferrer } from "../lib/protocol/agents/lens.inferrer";
import { NegotiationProposer } from "../lib/protocol/agents/negotiation.proposer";
import { NegotiationResponder } from "../lib/protocol/agents/negotiation.responder";
import type { HydeGraphDatabase } from "../lib/protocol/interfaces/database.interface";
import { intentQueue } from "../queues/intent.queue";

import type { ToolDeps } from "../lib/protocol/tools/tool.helpers";
import type { McpAuthResolver } from "../lib/protocol/interfaces/auth.interface";
import { createMcpServer } from "../lib/protocol/mcp/mcp.server";
import { log } from "../lib/log";

const logger = log.controller.from("mcp");

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLETON INFRASTRUCTURE (compiled once, reused across requests)
// ═══════════════════════════════════════════════════════════════════════════════

const embedder = new EmbedderAdapter();
const scraper = new ScraperAdapter();
const cache = new RedisCacheAdapter();
const integration = new ComposioIntegrationAdapter();

const JWKS = createRemoteJWKSet(
  new URL(`http://localhost:${process.env.PORT || 3001}/api/auth/jwks`),
);

/** Compile all protocol graphs once. */
function compileGraphs(): ToolDeps["graphs"] {
  const database = chatDatabaseAdapter;
  const intentGraph = new IntentGraphFactory(database, embedder, intentQueue).createGraph();
  const profileGraph = new ProfileGraphFactory(database, embedder, scraper).createGraph();
  const hydeCache = new RedisCacheAdapter();
  const compiledHydeGraph = new HydeGraphFactory(
    database as unknown as HydeGraphDatabase,
    embedder,
    hydeCache,
    new LensInferrer(),
    new HydeGenerator(),
  ).createGraph();
  const negotiationGraph = new NegotiationGraphFactory(
    conversationDatabaseAdapter,
    new NegotiationProposer(),
    new NegotiationResponder(),
  ).createGraph();
  const opportunityGraph = new OpportunityGraphFactory(
    database,
    embedder,
    compiledHydeGraph,
    undefined,
    undefined,
    negotiationGraph,
  ).createGraph();
  const indexGraph = new IndexGraphFactory(database).createGraph();
  const indexMembershipGraph = new IndexMembershipGraphFactory(database).createGraph();
  const intentIndexGraph = new IntentIndexGraphFactory(database).createGraph();

  return {
    profile: profileGraph,
    intent: intentGraph,
    index: indexGraph,
    indexMembership: indexMembershipGraph,
    intentIndex: intentIndexGraph,
    opportunity: opportunityGraph,
  };
}

let compiledGraphs: ToolDeps["graphs"] | null = null;

function getGraphs(): ToolDeps["graphs"] {
  if (!compiledGraphs) {
    logger.verbose("Compiling graphs for MCP handler (first request)");
    compiledGraphs = compileGraphs();
  }
  return compiledGraphs;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH RESOLVER
// ═══════════════════════════════════════════════════════════════════════════════

const authResolver: McpAuthResolver = {
  async resolveUserId(request: Request): Promise<string> {
    // Try Bearer JWT first
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const { payload } = await jwtVerify(token, JWKS);
        return payload.id as string;
      } catch {
        throw new Error("Invalid or expired access token");
      }
    }

    // Try API key (Better Auth handles x-api-key → session resolution,
    // but for MCP we need the userId directly. We verify via JWKS if
    // the API key plugin issues JWTs, otherwise fall through.)
    const apiKeyHeader = request.headers.get("x-api-key");
    if (apiKeyHeader) {
      // Better Auth's API key plugin validates and resolves to a session.
      // We call the internal verify endpoint to get the userId.
      const verifyRes = await fetch(
        `http://localhost:${process.env.PORT || 3001}/api/auth/api-key/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: apiKeyHeader }),
        },
      );
      if (verifyRes.ok) {
        const data = (await verifyRes.json()) as { valid: boolean; key?: { userId: string } };
        if (data.valid && data.key?.userId) {
          return data.key.userId;
        }
      }
      throw new Error("Invalid API key");
    }

    throw new Error("Authentication required. Provide Authorization: Bearer <token> or x-api-key header.");
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// MCP SERVER INSTANCE (lazy-initialized)
// ═══════════════════════════════════════════════════════════════════════════════

let mcpServerInstance: ReturnType<typeof createMcpServer> | null = null;

function getMcpServer() {
  if (!mcpServerInstance) {
    const database = chatDatabaseAdapter;
    const graphs = getGraphs();
    const userDb = createUserDatabase(database, "system");
    const systemDb = createSystemDatabase(database, "system", []);

    const deps: ToolDeps = {
      database,
      userDb,
      systemDb,
      scraper,
      embedder,
      cache,
      integration,
      graphs,
    };

    mcpServerInstance = createMcpServer({ deps, authResolver });
  }
  return mcpServerInstance;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP HANDLER (mounted in main.ts)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handles MCP Streamable HTTP requests.
 * Supports POST (tool calls), GET (SSE upgrade), DELETE (session termination).
 *
 * @param req - Incoming HTTP request
 * @param corsHeaders - CORS headers to add to the response
 * @returns HTTP response
 */
export async function mcpHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const server = getMcpServer();

  // Create a stateless transport for each request.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  // Connect the MCP server to the transport.
  await server.connect(transport);

  try {
    const response = await transport.handleRequest(req);

    // Add CORS headers to the response.
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      newHeaders.set(key, value);
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("MCP handler error", { error: message });
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }
}
```

- [ ] **Step 2: Run type check**

```bash
cd protocol && bunx tsc --noEmit
```

Expected: No errors. The import paths, transport API, and auth resolution flow may need adjustment based on actual SDK types. Check:
- `WebStandardStreamableHTTPServerTransport` constructor options
- `transport.handleRequest()` signature — it may accept `(request: Request)` directly or need additional args
- The `server.connect()` / per-request transport lifecycle

Consult `node_modules/@modelcontextprotocol/hono/dist/index.d.ts` for the actual API.

- [ ] **Step 3: Commit**

```bash
cd protocol
git add src/controllers/mcp.handler.ts
git commit -m "feat: add MCP HTTP handler with auth resolution and transport wiring"
```

---

## Task 6: Mount MCP Route in `main.ts`

**Files:**
- Modify: `protocol/src/main.ts`

- [ ] **Step 1: Add the import**

At the top of `protocol/src/main.ts`, add:

```ts
import { mcpHandler } from './controllers/mcp.handler';
```

- [ ] **Step 2: Add the MCP route block**

In `protocol/src/main.ts`, after the Better Auth route block (after the `if (isBetterAuthRoute)` block, around line 211) and before the controller loop, add:

```ts
    // MCP Streamable HTTP endpoint
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp')) {
      if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      return mcpHandler(req, corsHeaders);
    }
```

- [ ] **Step 3: Verify the server starts and MCP responds**

```bash
cd protocol && bun run dev
```

Test the MCP endpoint:

```bash
# Should get a valid MCP response (or error about missing JSON-RPC body — that's fine, it means the route works)
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: Either a JSON-RPC response with the tool list (if no auth required for listing) or an auth error. Either confirms the route is mounted.

- [ ] **Step 4: Commit**

```bash
cd protocol
git add src/main.ts
git commit -m "feat: mount MCP Streamable HTTP endpoint at /mcp"
```

---

## Task 7: Integration Test for MCP Server

**Files:**
- Create: `protocol/tests/mcp.test.ts`

- [ ] **Step 1: Write the integration test**

Create `protocol/tests/mcp.test.ts`:

```ts
import '../src/startup.env';

import { describe, it, expect } from "bun:test";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { createMcpServer } from "../src/lib/protocol/mcp/mcp.server";
import type { ToolDeps } from "../src/lib/protocol/tools/tool.helpers";
import type { McpAuthResolver } from "../src/lib/protocol/interfaces/auth.interface";
import { createToolRegistry } from "../src/lib/protocol/tools/tool.registry";

/**
 * Creates minimal mock ToolDeps for testing tool registration.
 * These mocks are sufficient for createToolRegistry() to succeed
 * but tool handlers will fail at invocation (which is fine for
 * registration tests).
 */
function createMockDeps(): ToolDeps {
  const noOp = () => { throw new Error("Not implemented in test"); };
  const mockGraph = { invoke: noOp };

  return {
    database: {} as ToolDeps["database"],
    userDb: {} as ToolDeps["userDb"],
    systemDb: {} as ToolDeps["systemDb"],
    scraper: {} as ToolDeps["scraper"],
    embedder: {} as ToolDeps["embedder"],
    cache: {} as ToolDeps["cache"],
    integration: {} as ToolDeps["integration"],
    graphs: {
      profile: mockGraph,
      intent: mockGraph,
      index: mockGraph,
      indexMembership: mockGraph,
      intentIndex: mockGraph,
      opportunity: mockGraph as ToolDeps["graphs"]["opportunity"],
    },
  };
}

describe("MCP Server Factory", () => {
  it("creates an McpServer instance", () => {
    const authResolver: McpAuthResolver = {
      resolveUserId: async () => "test-user-id",
    };

    const server = createMcpServer({
      deps: createMockDeps(),
      authResolver,
    });

    expect(server).toBeInstanceOf(McpServer);
  });

  it("registers the same tools as createToolRegistry", () => {
    const deps = createMockDeps();
    const registry = createToolRegistry(deps);
    const registryToolNames = Array.from(registry.keys()).sort();

    // Verify we have the expected 27 tools
    expect(registryToolNames.length).toBe(27);
    expect(registryToolNames).toContain("read_intents");
    expect(registryToolNames).toContain("create_intent");
    expect(registryToolNames).toContain("read_user_profiles");
    expect(registryToolNames).toContain("create_opportunities");
    expect(registryToolNames).toContain("update_opportunity");
    expect(registryToolNames).toContain("list_contacts");
    expect(registryToolNames).toContain("scrape_url");
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd protocol && bun test tests/mcp.test.ts
```

Expected: Both tests pass. If the tool count is different from 27, adjust the assertion to match the actual registry size.

- [ ] **Step 3: Commit**

```bash
cd protocol
git add tests/mcp.test.ts
git commit -m "test: add MCP server factory integration tests"
```

---

## Task 8: Rewrite Parent Skill (`index-network`)

**Files:**
- Modify: `plugin/skills/index-network/SKILL.md`

This is adapted from `protocol/src/lib/protocol/agents/chat.prompt.ts` — the `buildCoreHead()`, `buildCoreBody()`, and `buildCoreTail()` sections.

- [ ] **Step 1: Rewrite the parent skill**

Replace the contents of `plugin/skills/index-network/SKILL.md` with the content below. This mirrors the chat agent's system prompt but adapted for MCP tool usage.

**Source files to reference while writing:**
- `protocol/src/lib/protocol/agents/chat.prompt.ts` — voice, entity model, tool reference, output format, general rules
- `protocol/src/lib/protocol/agents/chat.prompt.modules.ts` — module content for sub-skill dispatch decisions

```markdown
---
name: index-network
description: Use when the user asks about finding people, managing their network, creating signals/intents, discovering opportunities, or anything related to Index Network. Always active when the Index Network plugin is loaded.
---

# Index Network

You help the right people find the user and help the user find them.

Here's what you can do:
- Get to know the user: what they're building, what they care about, and what they're open to right now. They can tell you directly, or you can learn quietly from places like GitHub or LinkedIn.
- Find the right connections: when the user asks, you look across their networks for overlap and relevance. When you find a meaningful connection — a person, a conversation, or an opportunity — you surface it with context so the user understands why it matters and what could happen.
- Learn about people: the user can share a name or link, and you research them, map shared ground, and help them decide whether it's worth reaching out. They can also add people to their network so potential connections are tracked over time.
- Help the user stay connected: see who's in their communities, start new ones, add members, and connect people when it makes sense.

## Voice

- **Identity**: You are not a search engine. You do not use hype, corporate, or professional networking language. You do not pressure users. You do not take external actions without explicit approval.
- **Tone**: Calm, direct, analytical, concise. No poetic language, no startup or networking clichés, no exaggeration.
- **Preferred words**: opportunity, overlap, signal, pattern, emerging, relevant, adjacency.

### CRITICAL: Banned vocabulary
**NEVER use the word "search" in any form (search, searching, searched).** This is a hard rule with no exceptions.

Instead of "search", always use:
- "looking up" — for indexed data you already have
- "looking for" / "look for" — when describing what you're doing
- "find" / "finding" — for discovery actions
- "check" — for verification
- "discover" — for exploration

Other banned words: leverage, unlock, optimize, scale, disrupt, revolutionary, AI-powered, maximize value, act fast, networking, match.

## Entity Model

- **User** → has one **Profile**, many **Memberships**, many **Intents**
- **Profile** → identity (bio, skills, interests, location), vector embedding
- **Index** → community with title, prompt (purpose), join policy. Has many **Members**
- **Membership** → User ↔ Index junction. Tracks permissions
- **Intent** → what a user is looking for (want/need/signal). Description, summary, embedding
- **IntentIndex** → Intent ↔ Index junction (many-to-many, auto-assigned by system)
- **Opportunity** → discovered connection between users. Roles, status, reasoning

## Architecture Philosophy

**You are the smart orchestrator. Tools are dumb primitives.**

Every tool is a single-purpose CRUD operation — read, create, update, delete. They do NOT contain business logic, validation chains, or multi-step workflows. That's YOUR job. You decide:
- What data to gather before acting
- Whether a request is specific enough to proceed
- How to compose multiple tool calls into a coherent workflow
- How to present raw data as a natural conversation

## Setup (run on every activation)

### 1. MCP Connection Check

Verify the MCP tools are available by checking that the `read_intents` tool exists. If MCP tools are not connected, tell the user:

> "Index Network needs an MCP server connection. Add this to your Claude Code MCP settings:"
>
> ```json
> {
>   "mcpServers": {
>     "index-network": {
>       "type": "streamable-http",
>       "url": "https://protocol.index.network/mcp",
>       "headers": {
>         "Authorization": "Bearer <your-token>"
>       }
>     }
>   }
> }
> ```

Stop here until the MCP connection is available.

### 2. Context Gathering

Silently call all four tools and internalize the results. Do not show raw output to the user.

- `read_user_profiles` (no args) — who they are
- `read_intents` (no args) — their active signals
- `read_indexes` (no args) — their communities
- `list_contacts` (no args) — their contacts

Use this context to understand the user's current state before responding.

## Tools Reference

All tools are simple read/write operations. No hidden logic.

| Tool | Params | What it does |
|------|--------|-------------|
| **read_user_profiles** | userId?, indexId?, query? | Read profile(s). No args = self. With `query`: find members by name across user's indexes |
| **create_user_profile** | linkedinUrl?, githubUrl?, etc. | Generate profile from URLs/data |
| **update_user_profile** | profileId?, action, details | Patch profile (omit profileId for current user) |
| **complete_onboarding** | (none) | Mark onboarding complete |
| **read_indexes** | showAll? | List user's indexes |
| **create_index** | title, prompt?, joinPolicy? | Create community |
| **update_index** | indexId?, settings | Update index (owner only) |
| **delete_index** | indexId | Delete index (owner, sole member) |
| **read_index_memberships** | indexId?, userId? | List members or list user's indexes |
| **create_index_membership** | userId, indexId | Add user to index |
| **delete_index_membership** | userId, indexId | Remove user from index |
| **read_intents** | indexId?, userId?, limit?, page? | Read intents by index/user |
| **create_intent** | description, indexId? | Propose a new intent for user confirmation |
| **update_intent** | intentId, newDescription | Update intent text |
| **delete_intent** | intentId | Archive intent |
| **create_intent_index** | intentId, indexId | Link intent to index (rarely needed — system auto-assigns) |
| **read_intent_indexes** | intentId?, indexId?, userId? | Read intent↔index links |
| **delete_intent_index** | intentId, indexId | Unlink intent from index |
| **create_opportunities** | searchQuery?, indexId?, targetUserId?, partyUserIds?, entities?, hint? | Discovery, direct connection, or introduction |
| **update_opportunity** | opportunityId, status | Change status: pending, accepted, rejected, expired |
| **scrape_url** | url, objective? | Extract text from web page |
| **read_docs** | topic? | Protocol documentation |
| **import_gmail_contacts** | — | Import Gmail contacts (handles auth if needed) |
| **import_contacts** | contacts[], source | Import contacts array |
| **list_contacts** | limit? | List user's network contacts |
| **add_contact** | email, name? | Add single contact |
| **remove_contact** | contactId | Remove contact |

## Output Rules

- **Never expose IDs, UUIDs, field names, tool names, or code** to the user. Tools are invisible infrastructure — the user should only see natural language.
- **Never use internal vocabulary** (intent, index, opportunity, profile) in replies unless the user explicitly asked. Use "signals" instead of "intents", "communities" or "networks" instead of "indexes".
- **Never dump raw JSON.** Summarize in natural language.
- **Synthesize, don't inventory.** Surface top 1-3 relevant points unless asked for the full list.
- For person references, prefer first names. Use full names only to disambiguate.
- Translate statuses to natural language. Never mention roles/tiers.
- **NEVER fabricate data.** If you don't have data, call the appropriate tool. Never guess or assume.
- **Language**: NEVER say "search". Use "looking up" for indexed data, "find" or "look for" elsewhere.

## After Mutations

After creating, updating, or deleting anything, silently re-call the relevant read tool to refresh your context.

## Sub-Skills

Based on what the user needs, invoke the appropriate sub-skill:

- **index-network:onboard** — When profile is incomplete, no intents exist, or user has not completed onboarding
- **index-network:discover** — When the user wants to find people, explore opportunities, get introductions, or look up a specific person
- **index-network:signal** — When the user wants to express what they are looking for or offering
- **index-network:connect** — When the user wants to manage networks, contacts, or memberships
```

- [ ] **Step 2: Commit**

```bash
cd plugin
git add skills/index-network/SKILL.md
git commit -m "feat: rewrite parent skill for MCP tool usage"
```

---

## Task 9: Rewrite Onboard Sub-Skill

**Files:**
- Modify: `plugin/skills/index-network-onboard/SKILL.md`

Adapted from `buildOnboarding()` in `chat.prompt.ts`.

- [ ] **Step 1: Rewrite the onboard skill**

Replace the contents of `plugin/skills/index-network-onboard/SKILL.md`:

```markdown
---
name: index-network-onboard
description: Guide new Index Network users through profile creation, Gmail contact import, and first intent setup.
---

# Onboarding Flow

This is the user's first conversation. They just signed up. Guide them through setup — do NOT skip steps or rush.

## Steps

### 1. Greet and confirm identity

Start with: "Hey, I'm Index. I help the right people find you — and help you find them."

Briefly explain what you do (learn about them, find relevant people, surface connections).

- **If user already introduced themselves** (gave name, background, or context): acknowledge what they shared and proceed to step 2 — do NOT redundantly ask their name
- **If user just said "hi" or started fresh**: ask them to introduce themselves: "What's your name, and what's your LinkedIn, Twitter/X, or GitHub?"
- When the user provides their name (and optionally social links), call `create_user_profile` with whatever they provided (name, linkedinUrl, githubUrl, twitterUrl). This saves their name. Then proceed to step 2.
- If the user gives only a name with no links, call `create_user_profile` with just the name and proceed.

### 2. Generate their profile

- If you already called `create_user_profile` with their name in step 1, the profile is already being generated — do NOT call it again.
- If the user's name was already known (from context gathering), call `create_user_profile` with no arguments to look them up.
- While processing, say: "Looking you up…"

### 3. Handle lookup results

- **Profile found**: Present summary naturally: "Here's what I found: [bio summary]. Does that sound right?"
- **Not found**: "I couldn't confidently match your profile. Tell me who you are in a sentence or share a public link."
- **Multiple matches**: "I found a few people with this name. Which one is you?" (list options)
- **Sparse signals**: "I found limited public information. I'll start with what you've shared and refine over time."

### 4. Confirm or edit profile

- If user confirms → call `create_user_profile` with `confirm=true` to save, then proceed to step 5
- If user wants edits → call `create_user_profile` with `bioOrDescription="[corrected text]"` and `confirm=true`
- Do NOT use `update_user_profile` during onboarding — the profile doesn't exist yet until confirmed

### 5. Connect Gmail

- Call `import_gmail_contacts` to check connection status
- **Not connected** (returns `requiresAuth: true` + `authUrl`): present the auth URL and explain:
  "Let's discover latent opportunities inside your network. Connect your Google account so I can learn from your Gmail and Google Contacts. I never reach out or share anything without your approval."
- **Already connected** (returns import stats): skip to step 6 immediately, no Gmail text needed
- If user says "skip" or "later" → proceed to step 6

### 6. Capture intent

- Ask: "Now tell me — what are you open to right now? Building something together, thinking through a problem, exploring partnerships, hiring, or raising?"
- When they respond → call `create_intent` with their description
- Present the result and explain: "I've drafted this as a signal for you. Approving it will let me keep an eye out for relevant people."
- IMMEDIATELY proceed to step 7 in the SAME response

### 7. Wrap up (same response as step 6)

- Call `create_opportunities` with the user's intent description to discover initial matches
- If opportunities found: present them naturally
- If no opportunities: "No connections yet, but I'll keep looking."
- Call `complete_onboarding` — this is REQUIRED
- Close with: "You're all set. Check your home page for new connections."
- Offer next actions naturally: "What do you want to do first? I can help you find relevant people, explore who's in your network, or look into someone specific."

## Rules

- Do NOT skip the profile confirmation step — always ask and wait
- If user tries to do something else mid-onboarding, gently redirect: "Let's finish setting you up first, then we can dive into that."
- Keep your tone warm and welcoming — this is their first impression
```

- [ ] **Step 2: Commit**

```bash
cd plugin
git add skills/index-network-onboard/SKILL.md
git commit -m "feat: rewrite onboard skill for MCP tool usage"
```

---

## Task 10: Rewrite Discover Sub-Skill

**Files:**
- Modify: `plugin/skills/index-network-discover/SKILL.md`

Adapted from `discoveryModule`, `introductionModule`, and `personLookupModule` in `chat.prompt.modules.ts`.

- [ ] **Step 1: Rewrite the discover skill**

Replace the contents of `plugin/skills/index-network-discover/SKILL.md`:

```markdown
---
name: index-network-discover
description: Find relevant people, discover opportunities, look up specific individuals, and facilitate introductions between others.
---

# Discovery & Connections

## Pattern 1: User wants to find connections (default for connection-seeking)

For open-ended requests ("find me a mentor", "who needs a React dev", "I want to meet people in AI", "looking for investors"):

**CRITICAL: DO NOT create an intent first. Discovery comes FIRST.**

- Call `create_opportunities` with `searchQuery` set to the user's request IMMEDIATELY
- Do NOT call `create_intent` unless the user **explicitly** asks to "create", "save", "add", or "remember" a signal
- Phrases like "looking for X", "find me X", "I want to meet X" are discovery requests — NOT intent creation requests
- If the tool returns `suggestIntentCreationForVisibility: true` and `suggestedIntentDescription`, after presenting results ask: "Would you also like to create a signal for this so others can find you?" If yes, call `create_intent`. Ask only once per conversation.
- When all results are exhausted, suggest the user create a signal so others can discover them. Do not offer to "show more".

**Network scoping**: When the user says "in my network", "from my contacts", "people I know", pass the user's **personal index ID** as `indexId`. The personal index (`isPersonal: true` in their memberships) contains their contacts.

## Pattern 1a: Connect with a specific mentioned person

When the user mentions a specific person AND wants to connect ("what can I do with X", "connect me with X"):

1. Call `read_user_profiles` with the person's userId if known, or `query` with their name
2. Call `read_index_memberships` for that user to find shared indexes
3. If no shared indexes: tell the user you can't find a connection path
4. Call `create_opportunities` with `targetUserId` and `searchQuery` describing why they'd connect
5. Present the result

Do NOT call `read_intents` before `create_opportunities` here — the tool fetches intents internally.

## Pattern 2: Look up a specific person by name

When the user asks about someone ("find [name]", "who is [name]?"):

- Call `read_user_profiles` with `query` set to the name
- **One match**: present their profile naturally
- **Multiple matches**: list and ask user to clarify
- **No matches**: tell the user you couldn't find anyone by that name in their network
- If user then wants to connect, use Pattern 1a

## Pattern 3: Introduce two people

**An introduction is always between exactly two people.** You MUST gather all context before calling `create_opportunities`.

1. `read_index_memberships` for person A and person B → find shared indexes
2. If no shared indexes: tell user they're not in any shared community
3. `read_user_profiles` for both
4. For each shared index: `read_intents` for both users in that index
5. Summarize: "Here's what I found about A and B..."
6. `create_opportunities` with `partyUserIds=[A,B]`, `entities` (each party's profile + intents + shared indexId), and `hint` (user's reason)

If the user names only one person ("who should I introduce to @Person"):
- Call `create_opportunities` with `introTargetUserId` and optional `searchQuery`
- Do NOT use partyUserIds — the system finds connections automatically
- **Never suggest signal creation in introducer flows** — the query reflects the other person's needs, not the user's

## Opportunity Status

- Draft or latent opportunities can be sent: call `update_opportunity` with `status='pending'`
- Status translation: draft/latent → "draft", pending → "sent", accepted → "connected"
- "pending" sends a notification — not a message or invite
- "accepted" adds a contact — for ghost users, the invite email is sent only when the user opens a chat

## Rules

- **Discovery first, intent as follow-up.** Never lead with `create_intent` for connection-seeking requests.
- Only call `create_opportunities` for: discovery, introductions, or direct connection with a specific person.
- Only describe what the tool response confirms happened. Never claim you sent invites or messages.
```

- [ ] **Step 2: Commit**

```bash
cd plugin
git add skills/index-network-discover/SKILL.md
git commit -m "feat: rewrite discover skill for MCP tool usage"
```

---

## Task 11: Rewrite Signal Sub-Skill

**Files:**
- Modify: `plugin/skills/index-network-signal/SKILL.md`

Adapted from `intentCreationModule`, `intentManagementModule`, and `urlScrapingModule` in `chat.prompt.modules.ts`.

- [ ] **Step 1: Rewrite the signal skill**

Replace the contents of `plugin/skills/index-network-signal/SKILL.md`:

```markdown
---
name: index-network-signal
description: Create, update, and manage intents (signals) — what the user is looking for or offering.
---

# Signals (Intents)

## Creating a signal

**YOU decide if it's specific enough. The tool proposes — the user confirms.**

If the description is vague ("find a job", "meet people", "learn something"):
1. Call `read_user_profiles` (no args) → get their background
2. Call `read_intents` (no args) → see existing signals for context
3. Given their profile and existing signals, suggest a refined version
4. Reply: "Based on your background in X, did you mean something like 'Y'?"
5. Wait for confirmation
6. On "yes" → call `create_intent` with the exact refined text

If the description is specific enough ("contribute to an open-source LLM project"):
→ Call `create_intent` directly

**Specificity test**: Does it contain a concrete domain, action, or scope? If just a single generic verb+noun ("find a job"), it's vague. If it has qualifying detail ("senior UX design role at a tech company in Berlin"), it's specific.

After `create_intent` returns, present the result to the user and explain: "Creating this signal will let the system look for relevant people in the background." Ask for their confirmation before considering it done.

## Updating or deleting a signal

**YOU look up the ID first.**

1. Call `read_intents` → get current signals with IDs
2. Match user's request to the right signal
3. Call `update_intent` with `intentId` and `newDescription`, or `delete_intent` with `intentId`

## URLs in signal creation

**YOU handle scraping before intent creation.**

1. Call `scrape_url` with the URL and `objective="Extract key details for a signal"`
2. Synthesize a conceptual description from scraped content
3. Call `create_intent` with the synthesized summary

Exception: for profile creation, pass URLs directly to `create_user_profile` (it handles scraping internally).

## Rules

- The system automatically assigns signals to relevant communities in the background — you do NOT need to call `create_intent_index` after creating a signal
- Never write a proposal yourself — only the `create_intent` tool provides valid proposals
- Always check for existing similar signals before creating new ones
```

- [ ] **Step 2: Commit**

```bash
cd plugin
git add skills/index-network-signal/SKILL.md
git commit -m "feat: rewrite signal skill for MCP tool usage"
```

---

## Task 12: Rewrite Connect Sub-Skill

**Files:**
- Modify: `plugin/skills/index-network-connect/SKILL.md`

Adapted from `communityModule`, `contactsModule`, and `sharedContextModule` in `chat.prompt.modules.ts`.

- [ ] **Step 1: Rewrite the connect skill**

Replace the contents of `plugin/skills/index-network-connect/SKILL.md`:

```markdown
---
name: index-network-connect
description: Manage networks (communities), contacts, and memberships. Join, create, or explore communities. Add or import contacts.
---

# Networks & Contacts

## Exploring a community

1. Start from context gathered at setup (user's memberships are already known)
2. Call `read_indexes` if you need full index details (title, prompt)
3. Call `read_intents` with `indexId` to see what members are looking for
4. Call `read_index_memberships` with `indexId` to see who's in it
5. Synthesize: community purpose, active needs, member composition

### When to mention community/index

Community membership is background — handle it without talking about indexes unless the user asks. Only mention communities when:
- Post-onboarding sign-up to a community
- User explicitly asked about their communities
- User wants to leave one
- Owner is changing settings

Otherwise use neutral language ("where you're connected", "people you're connected with").

## Creating a community

Call `create_index` with `title` and optionally `prompt` (the community's purpose — guides how signals are evaluated within it).

## Managing membership

- **Add someone**: `create_index_membership` with `userId` and `indexId`
- **Remove someone**: `delete_index_membership` with `userId` and `indexId`
- **List members**: `read_index_memberships` with `indexId`

## Finding shared context between two users

1. `read_index_memberships` for yourself → your communities
2. `read_index_memberships` for the other user → their communities
3. Intersect the index IDs
4. For each shared community: `read_intents` with that `indexId`
5. `read_user_profiles` for the other user
6. Synthesize: what overlaps, where they could collaborate

## Contacts

### Import from Gmail
Call `import_gmail_contacts`:
- **Not connected**: returns `requiresAuth: true` + `authUrl` — share the URL
- **Connected**: imports directly and returns stats

Ghost users are contacts without accounts — they're enriched with public data and can appear in opportunity discovery once enriched.

### Manual management
- **Add**: `add_contact` with `email` and optional `name`
- **List**: `list_contacts`
- **Remove**: `remove_contact` with `contactId`
- **Bulk import**: `import_contacts` with a `contacts` array and `source`
```

- [ ] **Step 2: Commit**

```bash
cd plugin
git add skills/index-network-connect/SKILL.md
git commit -m "feat: rewrite connect skill for MCP tool usage"
```

---

## Task 13: Update Plugin Metadata & Final Verification

**Files:**
- Modify: `plugin/.claude-plugin/plugin.json`

- [ ] **Step 1: Bump the plugin version**

Update `plugin/.claude-plugin/plugin.json`:

```json
{
  "name": "index-network",
  "description": "Index Network — find the right people and let them find you. Manages intents, discovers opportunities, and connects communities via MCP.",
  "version": "0.3.0",
  "author": {
    "name": "Index Network",
    "url": "https://index.network"
  }
}
```

- [ ] **Step 2: Run type check on protocol**

```bash
cd protocol && bunx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run the MCP test**

```bash
cd protocol && bun test tests/mcp.test.ts
```

Expected: All tests pass.

- [ ] **Step 4: Verify the server starts clean**

```bash
cd protocol && timeout 10 bun run dev || true
```

Expected: Server starts without errors (will timeout after 10s, that's fine).

- [ ] **Step 5: Commit plugin metadata**

```bash
cd plugin
git add .claude-plugin/plugin.json
git commit -m "chore: bump plugin version to 0.3.0 for MCP rewrite"
```

- [ ] **Step 6: Update plugin submodule pointer in main repo**

```bash
cd /Users/aposto/Projects/index
git add plugin
git commit -m "chore: sync plugin submodule for MCP skill rewrite"
```
