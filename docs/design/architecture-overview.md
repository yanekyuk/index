---
title: "Architecture Overview"
type: design
tags: [architecture, layering, agents, data-flow, protocol, langgraph]
created: 2026-03-26
updated: 2026-03-26
---

# Architecture Overview

This document provides a comprehensive overview of the Index Network architecture for new contributors, stakeholders, and anyone seeking to understand how the system is structured. It covers the monorepo layout, protocol layering, agent system, data flow, and supporting infrastructure.

For domain-specific deep dives, see the design papers in `protocol/src/lib/protocol/docs/` and the protocol README at `protocol/src/lib/protocol/README.md`.

---

## 1. Monorepo Structure

The repository is organized as a Bun-managed monorepo with two primary workspaces.

```
index/
  protocol/          Backend API and Agent Engine (Bun, Express, TypeScript)
  frontend/          Vite + React Router v7 SPA (React 19, Tailwind CSS 4)
  cli/               CLI client (@indexnetwork/cli, Bun, TypeScript)
  plugin/            Claude plugin — MCP server (submodule → indexnetwork/claude-plugin)
```

**Protocol** is the backend: an Express.js server running on the Bun runtime (port 3001). It hosts the API, LangGraph-based agent system, database layer, job queues, and event infrastructure.

**Frontend** is a single-page application built with Vite and React Router v7. In development, Vite proxies `/api/*` requests to the protocol backend. In production, a reverse proxy handles routing.

**CLI** is a standalone command-line client (`@indexnetwork/cli`) that wraps the Tool HTTP API. It provides authentication, command parsing, formatted terminal output, and `--json` mode for machine-readable output. Published to npm with platform-specific native binaries.

**Plugin** is a Claude Code / Claude Desktop plugin (MCP server) that exposes Index Network tools, resources, and skills to Claude. It wraps the CLI and is maintained as a git submodule at `indexnetwork/claude-plugin`.

Both protocol and frontend workspaces share the same repository and are installed together via `bun install` at the root. Development uses git worktrees (`.worktrees/`) to isolate feature and fix branches from the stable `dev` branch.

---

## 2. Protocol Layering

The protocol backend enforces strict layering to maintain separation of concerns and testability. Dependencies always point inward, from the HTTP boundary toward infrastructure.

```
+------------------------------------------------------------------+
|                                                                  |
|   Controllers                                                    |
|   HTTP handlers, input validation, response formatting           |
|   Imports: services, guards, decorators                          |
|                                                                  |
+------------------------------------------------------------------+
        |
        | delegates to
        v
+------------------------------------------------------------------+
|                                                                  |
|   Services                                                       |
|   Business logic, DB transactions, event emission                |
|   Imports: adapters, lib/protocol (graphs, agents)               |
|                                                                  |
+------------------------------------------------------------------+
        |
        | uses
        v
+------------------------------------------------------------------+
|                                                                  |
|   Adapters                                                       |
|   Own types that align with protocol interfaces                   |
|   (database, embedder, cache, queue, scraper, storage)           |
|   Named by concept, not technology                               |
|                                                                  |
+------------------------------------------------------------------+
        |
        | talks to
        v
+------------------------------------------------------------------+
|                                                                  |
|   Infrastructure                                                 |
|   PostgreSQL + pgvector, Redis (BullMQ), OpenRouter (LLM),      |
|   S3 (storage), external APIs                                    |
|                                                                  |
+------------------------------------------------------------------+
```

The **protocol layer** (`src/lib/protocol/`) sits alongside services. It contains LangGraph graphs, AI agents, tools, state definitions, and interfaces. It is fully self-contained — zero imports from parent directories (adapters, services, queues, schemas). All infrastructure dependencies are received via constructor injection through interfaces defined in `src/lib/protocol/interfaces/`. The **composition root** (`src/protocol-init.ts`) wires concrete adapters to these interfaces via `createDefaultProtocolDeps()`.

### Layer Responsibilities

| Layer | Responsibility | Can Import |
|-------|---------------|------------|
| **Controllers** | HTTP handling, input validation via Zod, response formatting | Services, guards, decorators |
| **Services** | Business logic, DB transactions, event emission, typed results | Adapters, lib/protocol |
| **Adapters** | Define own types aligned with protocol interfaces, wrap infrastructure | Infrastructure libraries (not lib/protocol/) |
| **Protocol** | Graphs, agents, tools, state machines | Nothing external (all deps injected) |
| **Infrastructure** | PostgreSQL, Redis, OpenRouter, S3 | N/A (external systems) |

---

## 3. Dependency Rules

Layering is enforced through strict import rules. Violations cause tight coupling and make testing difficult.

### What Each Layer Can and Cannot Import

**Controllers**
- CAN import: services, decorators (`@Controller`, `@Get`, `@Post`), guards (`AuthGuard`)
- CANNOT import: adapters, database, schema, Drizzle operators

**Services**
- CAN import: adapters from `src/adapters/`, protocol graphs and agents from `src/lib/protocol/`
- CANNOT import: other services (use events, queues, or shared lib for cross-service orchestration)

**Adapters**
- CAN import: infrastructure libraries (must not import from `src/lib/protocol/interfaces/` — define own aligned types)
- CANNOT import: services, controllers

**Protocol layer (graphs, agents, tools)**
- CAN import: only its own submodules and types
- CANNOT import: adapters or infrastructure directly (everything is injected)

### Interface Narrowing with Pick

Graph factories do not depend on the full `Database` interface. Instead, each factory declares a narrowed type using TypeScript's `Pick<>` utility. This documents exactly which database methods a graph needs and prevents accidental coupling.

```typescript
// Full interface has 80+ methods
export interface Database {
  getUser(id: string): Promise<UserRecord | null>;
  getIntent(id: string): Promise<IntentRecord | null>;
  assignIntentToIndex(intentId: string, indexId: string, score: number): Promise<void>;
  // ... many more
}

// Each graph picks only what it needs
export type IntentIndexGraphDatabase = Pick<
  Database,
  | 'getIntentForIndexing'
  | 'getIndexMemberContext'
  | 'isIntentAssignedToIndex'
  | 'assignIntentToIndex'
  | 'unassignIntentFromIndex'
  | 'getIntent'
  | 'isIndexMember'
  | 'getIndexIdsForIntent'
  | 'getIndexIntentsForMember'
  | 'getIntentsInIndexForMember'
>;

// Factory constructor accepts the narrow type
export class IntentIndexGraphFactory {
  constructor(private database: IntentIndexGraphDatabase) {}
}
```

This pattern is applied to all graph factories: `ProfileGraphDatabase`, `OpportunityGraphDatabase`, `IntentGraphDatabase`, `IndexGraphDatabase`, `IntentIndexGraphDatabase`, `IndexMembershipGraphDatabase`, `HydeGraphDatabase`, and `HomeGraphDatabase`.

### Adapter Naming Convention

Adapters are named by **concept**, not by implementation technology.

| Correct | Incorrect |
|---------|-----------|
| `database.adapter.ts` | `drizzle.adapter.ts` |
| `cache.adapter.ts` | `redis.adapter.ts` |
| `queue.adapter.ts` | `bullmq.adapter.ts` |
| `storage.adapter.ts` | `s3.adapter.ts` |

This allows swapping infrastructure without renaming files or updating imports across the codebase.

---

## 4. Agent System

The agent system is built on LangGraph (from the LangChain ecosystem) and follows a consistent architecture: **graphs** orchestrate workflows, **agents** perform LLM reasoning, **tools** expose capabilities to the chat agent, and **state** carries data through the pipeline.

### Component Types

```
protocol/src/lib/protocol/
  graphs/           LangGraph state machines (*.graph.ts)
  states/           Graph state definitions (*.state.ts)
  agents/           AI agents with Zod-validated I/O (*.agent.ts, *.generator.ts, etc.)
  tools/            Chat tool definitions by domain (*.tools.ts)
  streamers/        SSE streaming for chat responses
  support/          Infrastructure utilities
  interfaces/       Adapter contracts
```

### Graphs

Graphs are LangGraph state machines. Each graph is created by a factory class that accepts dependencies via constructor injection.

| Graph | Purpose |
|-------|---------|
| Chat | ReAct agent loop with tool calling |
| Intent | Extract, verify, reconcile, and persist intents |
| Profile | Generate/update user profiles with scraping and embedding |
| Opportunity | HyDE-based discovery: search, evaluate, rank, persist |
| HyDE | Generate hypothetical document embeddings (cache-aware) |
| Index | Manage index CRUD |
| Index Membership | Manage index member join/leave |
| Intent Index | Evaluate and assign/unassign intents to indexes |
| Home | Categorize and curate home feed content |
| Maintenance | Periodic maintenance tasks |
| Negotiation | Multi-turn negotiation flows |

**Graph invariants**: Every graph must have at least one conditional edge. All graphs use `Annotation.Root` with reducers for state management. Nodes are async functions that accept state and return partial state updates. Nodes catch errors internally rather than throwing.

### Agents

Agents are pure LLM reasoning units. They accept structured input (Zod schemas), call the LLM via `createModel()` from `model.config.ts`, and return structured output. Agents have no direct database access and no side effects. Services handle persistence after agent execution.

| Agent | Purpose |
|-------|---------|
| ChatAgent | Orchestrates tool calls in the ReAct loop |
| Intent Inferrer | Extracts intents from uploaded content |
| Intent Reconciler | Decides create/update/expire actions for intents |
| Intent Verifier | Validates felicity conditions on intents |
| Intent Indexer | Scores intent-to-index fit (relevancy 0.0-1.0) |
| Opportunity Evaluator | Scores and synthesizes opportunity matches |
| Profile Generator | Generates user profiles from identity signals |
| HyDE Generator | Creates hypothetical document embeddings |

### Tools

Tools are the capabilities exposed to the chat agent. They bridge the agent loop and the subgraph layer. When the chat agent decides to call a tool, the tool function invokes the appropriate subgraph.

| Tool File | Capabilities |
|-----------|-------------|
| `profile.tools.ts` | read/create/update user profiles |
| `intent.tools.ts` | CRUD intents, manage intent-index assignments |
| `index.tools.ts` | CRUD indexes, manage memberships |
| `opportunity.tools.ts` | Discover and send opportunities |
| `utility.tools.ts` | URL scraping, action confirmation/cancellation |

### How They Compose

```
Chat Tools  ----invoke---->  SubGraphs  ----call---->  Agents
   |                            |                        |
   |                            |                        | (LLM reasoning)
   |                            |                        v
   |                            |                    Structured output
   |                            |                        |
   |                            v                        |
   |                      State machine              returned to
   |                      (nodes + edges)            graph node
   |                            |
   v                            v
Tool result               Persisted to DB
returned to               (via injected database)
ChatAgent
```

---

## 5. Data Flow

### Request Flow: HTTP to Database

A typical user request flows through the following layers.

```
User (Browser/Client)
  |
  |  HTTP request (POST /api/chat/message)
  v
Bun.serve (main.ts, port 3001)
  |
  |  Route matching via RouteRegistry
  v
Guard (AuthGuard)
  |
  |  Validates session, resolves user
  v
Controller (ChatController)
  |
  |  Input validation (Zod), delegates to service
  v
Service (ChatService / Graph invocation)
  |
  |  Business logic, invokes graph factory
  v
Graph (ChatGraphFactory.createGraph())
  |
  |  State machine execution: nodes, conditional edges
  v
Agent (ChatAgent / specialized agents)
  |
  |  LLM call via OpenRouter, structured output
  v
Database (via injected adapter)
  |
  |  Drizzle ORM, PostgreSQL + pgvector
  v
Response (JSON / SSE stream back to client)
```

### Chat Message Flow (Detailed)

The chat system is the primary entry point for user interaction. When a user sends a message:

1. **HTTP layer**: The request hits `ChatController`, which validates input and delegates to the chat service.

2. **Graph initialization**: The chat graph loads session context (conversation history, user profile, index memberships) and truncates to fit the context window.

3. **ReAct loop**: The `ChatAgent` enters a loop (up to 12 iterations). Each iteration, the LLM sees the full conversation and decides to either call tools or produce a final response.

4. **Tool execution**: When the agent calls tools (e.g., `create_intent`), each tool invokes the appropriate subgraph. For example, `create_intent` invokes the Intent Graph, which runs the inferrer, verifier, and reconciler agents in sequence.

5. **Subgraph execution**: The subgraph runs its own state machine. Nodes perform database operations through the injected adapter. Agents make LLM calls for reasoning.

6. **Result propagation**: Tool results flow back to the chat agent as `ToolMessage` objects. The agent incorporates these results and either calls more tools or produces a final response.

7. **Streaming**: The response is streamed back to the client via SSE (Server-Sent Events).

### Intent Creation Flow

When a user says "I'm looking for a React co-founder":

1. The chat agent calls `create_intent` with the extracted content
2. The Intent Graph runs:
   - **Prep node**: Loads user context
   - **Inference node**: `IntentInferrer` extracts structured intent from natural language
   - **Verification node**: `IntentVerifier` checks felicity conditions (semantic entropy, referential anchors, sincerity)
   - **Reconciliation node**: `IntentReconciler` decides whether to create, update, or expire existing intents
   - **Execution node**: Persists the intent to the database with embedding
3. `IntentEvents.onCreated` fires, which enqueues an opportunity discovery job
4. The opportunity queue picks up the job asynchronously

---

## 6. Event System

The event system provides async decoupling between services. Events are lightweight hooks defined in `src/events/` and wired up in `main.ts`.

### Intent Events

Defined in `src/events/intent.event.ts`:

```typescript
export const IntentEvents = {
  onCreated: (_intentId: string, _userId: string): void => {},
  onUpdated: (_intentId: string, _userId: string): void => {},
  onArchived: (_intentId: string, _userId: string): void => {},
};
```

These are assigned concrete handlers in `main.ts`. For example, `onCreated` enqueues an opportunity discovery job so that newly created intents trigger matching:

```typescript
IntentEvents.onCreated = (intentId: string, userId: string) => {
  opportunityQueue.addJob(
    { intentId, userId },
    { priority: 10, jobId: `rediscovery:${userId}:${intentId}:...` },
  );
};
```

### Index Membership Events

Defined in `src/events/index_membership.event.ts`:

```typescript
export const IndexMembershipEvents = {
  onMemberAdded: (_userId: string, _indexId: string): void => {},
};
```

When a user joins an index, this event triggers a profile HyDE generation job so the new member becomes discoverable via vector search within that index.

### Design Rationale

- **Services emit events after DB transactions**, ensuring data consistency before side effects
- **Events decouple services**: the intent service does not need to know about opportunity discovery
- **Queue-based handlers**: event handlers enqueue jobs rather than executing work inline, keeping the request path fast
- **Events and queues are the only mechanism for cross-service communication** (services must not import other services)

---

## 7. Queue System

BullMQ (backed by Redis) handles all asynchronous processing. Queue definitions live in `src/queues/`, and workers are started in `main.ts`.

### Queue Types

| Queue | Purpose |
|-------|---------|
| `intent.queue` | Intent indexing and generation jobs |
| `opportunity.queue` | Matching intents with opportunities, cron-based rediscovery |
| `profile.queue` | User profile generation and HyDE document creation |
| `hyde.queue` | HyDE document generation and cron-based refresh |
| `email.queue` | Email delivery via Resend |
| `notification.queue` | Notification delivery |

### Job Patterns

- **Retries**: 3 attempts with exponential backoff (1-second base delay)
- **Cleanup**: Completed jobs removed after 24 hours, failed jobs after 7 days
- **Concurrency**: Default is 1 (sequential processing) to avoid race conditions
- **Naming**: Snake_case job names (e.g., `generate_hyde`, `discover_opportunities`)
- **Deduplication**: Jobs use deterministic IDs where appropriate (e.g., time-bucketed rediscovery jobs) to prevent duplicate processing

### Queue Orchestration Rule

Queues orchestrate by calling services, graphs, or adapters. They contain no business logic themselves. A queue handler might:

1. Load context from the database adapter
2. Invoke a graph factory to run a pipeline
3. Persist results via the adapter
4. Emit events if further processing is needed

### Monitoring

Bull Board UI is served at `http://localhost:3001/dev/queues/` when the protocol server is running. It provides job status visibility, retry controls, and queue metrics.

---

## 8. Database Layer

### Technology Stack

- **ORM**: Drizzle ORM with full TypeScript type inference from schema
- **Database**: PostgreSQL with the pgvector extension for vector similarity search
- **Embeddings**: 2000-dimensional vectors from `text-embedding-3-large` via OpenRouter
- **Indexes**: HNSW indexes for fast approximate nearest-neighbor search

### Schema Organization

The canonical schema lives in `protocol/src/schemas/database.schema.ts`. All table definitions, relations, and types are defined here. Drizzle generates TypeScript types from the schema, eliminating manual type maintenance.

### Core Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts (Better Auth integration) |
| `user_profiles` | User identity with 2000-dim vector embeddings |
| `intents` | User intents with embeddings, confidence scores, semantic governance fields |
| `indexes` | Communities/collections; personal indexes have `isPersonal=true` |
| `index_members` | Membership with permissions, custom prompts, auto-assignment settings |
| `intent_indexes` | Many-to-many junction with optional `relevancyScore` (0.0-1.0) |
| `opportunities` | Match records with detection, actors, interpretation, context, status |
| `hyde_documents` | Stored HyDE documents for retrieval |
| `conversations` | Conversation containers (A2A context) |
| `messages` | A2A-compatible messages with parts (JSONB), role, senderId |
| `tasks` | A2A task lifecycle (submitted, working, completed, failed) |
| `artifacts` | Structured outputs from tasks (opportunity cards, etc.) |

### Key Patterns

**Polymorphic source tracking**: Intents track their origin via `sourceType` (file, integration, link, discovery_form, enrichment) and `sourceId`, enabling filtering and bulk re-processing by source.

**Confidence and inference tracking**: Every intent carries a `confidence` score (0-1) and `inferenceType` (explicit or implicit), plus semantic governance fields from the verifier (semantic entropy, referential anchor, felicity scores).

**Soft deletes**: Records use `deletedAt` timestamps rather than hard deletes, preserving audit trails and enabling recovery.

**Vector similarity search**: Intents and profiles have vector embeddings. Queries use pgvector's cosine similarity with HNSW indexes for sub-millisecond approximate nearest-neighbor lookups. This powers opportunity discovery, finding similar intents across index members.

### Migration Workflow

Drizzle generates migrations from schema diffs. Migrations are renamed to descriptive names following the pattern `{NNNN}_{action}_{target}.sql` (e.g., `0005_add_opportunities_table.sql`). The `_journal.json` file tracks applied migrations and must stay in sync with `.sql` filenames.

---

## 9. Key Diagrams

### Layering Diagram

```
+========================+
|      Controllers       |   HTTP boundary
|  (Express + decorators)|   Input validation, routing
+========================+
          |
          v
+========================+
|       Services         |   Business logic
|  (pure TypeScript)     |   DB transactions, events
+========================+
          |
     +----+----+
     |         |
     v         v
+==========+  +========================+
| Adapters |  |    Protocol Layer       |
| (infra   |  | (graphs, agents, tools) |
|  wrappers)|  | Deps injected via       |
|          |  | constructor             |
+==========+  +========================+
     |              |
     v              v
+========================+
|    Infrastructure      |
| PostgreSQL, Redis,     |
| OpenRouter, S3         |
+========================+
```

### Request Flow

```
Browser --HTTP--> Bun.serve --route--> Guard --auth--> Controller
    |                                                      |
    |                                              delegates to
    |                                                      |
    |                                                      v
    |                                                  Service
    |                                                      |
    |                                              invokes graph
    |                                                      |
    |                                                      v
    |                                              Graph (state machine)
    |                                                      |
    |                                              calls agents
    |                                                      |
    |                                                      v
    |                                              Agent (LLM call)
    |                                                      |
    |                                              structured output
    |                                                      |
    |                                                      v
    |                                              Database (adapter)
    |                                                      |
    <-------------------SSE stream / JSON------------------+
```

### Agent Loop (Chat Graph)

```
                    +------------------+
                    |  User message    |
                    +--------+---------+
                             |
                             v
                    +------------------+
                    | Load context     |
                    | (history, profile|
                    |  memberships)    |
                    +--------+---------+
                             |
                             v
                +------------------------+
          +---->|  LLM Iteration         |
          |     |  (see full conversation|
          |     |   + tool results)      |
          |     +-----------+------------+
          |                 |
          |         +-------+-------+
          |         |               |
          |    Tool calls      Final response
          |         |               |
          |         v               v
          |  +-------------+  +------------------+
          |  | Execute      |  | Stream to user   |
          |  | tools in     |  | via SSE          |
          |  | parallel     |  +------------------+
          |  +------+------+
          |         |
          |    Tool results
          |    (ToolMessage)
          |         |
          +---------+
        (up to 12 iterations)
```

### Event and Queue Flow

```
Service
  |
  |  1. Persist to DB
  |  2. Emit event
  |
  v
IntentEvents.onCreated(intentId, userId)
  |
  |  Enqueues job
  v
opportunityQueue.addJob({intentId, userId})
  |
  |  Worker picks up job
  v
OpportunityGraphFactory.createGraph().invoke(...)
  |
  |  HyDE generation -> vector search -> evaluation -> persist
  v
New opportunities (status: latent)
```

---

## Further Reading

- **Protocol layer README**: `protocol/src/lib/protocol/README.md` -- detailed graph, agent, and tool documentation with sequence diagrams
- **Architecture vision**: `protocol/ARCHITECTURE.md` -- federation, identity model, and multi-node protocol design
- **Design papers**: `protocol/src/lib/protocol/docs/` -- deep dives on HyDE strategies, opportunity lifecycle, semantic governance, and more
- **Template files**: `protocol/src/controllers/controller.template.md`, `protocol/src/services/service.template.md`, `protocol/src/queues/queue.template.md`, `protocol/src/lib/protocol/agents/agent.template.md` -- coding guidelines per layer
