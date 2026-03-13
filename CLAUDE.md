---
description: 
alwaysApply: true
---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Index Network is a private, intent-driven discovery protocol built on autonomous agents. Users define "intents" and competing Broker Agents work to fulfill them through relevant connections. The system leverages LangChain/LangGraph for agent orchestration, PostgreSQL with pgvector for semantic search, and a monorepo structure with protocol (backend) and frontend (Vite + React Router) workspaces.

## Development Commands

### Protocol (Backend)

```bash
cd protocol

# Development
bun run dev                                 # Start dev server with hot reload (Bun.serve, port 3001)
bun run dev:prod                            # Start dev server in production mode
bun run start                               # Start production server

# Database (Drizzle ORM)
bun run db:generate                         # Generate migrations after schema changes
bun run db:migrate                          # Apply pending migrations
bun run db:studio                           # Open Drizzle Studio (interactive DB GUI)

# Database utilities
bun run db:seed                             # Seed database with sample data
bun run db:flush                            # Flush all data from database

# Testing
bun test                                    # Run tests with bun test
bun test tests/e2e.test.ts                  # Run specific test file
bun test --watch                            # Run tests in watch mode

# Code quality
bun run lint                                # Run ESLint

# Queue monitoring

# Maintenance/CLI tools
bun run maintenance:trigger-integration     # Manually trigger integration sync
bun run maintenance:export-slack            # Export Slack data
bun run maintenance:import-slack-export     # Import Slack export files
bun run maintenance:reset-brokers           # Reset context brokers
bun run maintenance:update:embeddings       # Regenerate embeddings

# Background workers
bun run integration-worker                  # Start integration sync worker
bun run social-worker                       # Start social media sync worker
bun run audit-freshness                     # Audit intent freshness
```

### Frontend

```bash
cd frontend

# Development
bun run dev                                 # Start Vite dev server (with API proxy to protocol)
bun run build                               # Build blog assets then run Vite production build
bun run build:blog                          # Pre-build blog assets only
bun run start                               # Start Vite preview server
bun run lint                                # Run ESLint
```

### Root

```bash
# Install dependencies for all workspaces
bun install

# Development (from repo root)
bun run dev                                # Interactive list: select active branch (root) or a worktree to run dev (root runs build then dev; worktree runs worktree:dev)

# Git worktrees
bun run worktree:list                       # List worktrees and their setup status
bun run worktree:setup <name>               # Install node_modules & symlink .env files into a worktree
bun run worktree:dev <name>                 # Run all dev servers from a worktree (auto-setups if needed)
bun run worktree:build [name]               # Build at root, or in worktree <name> if given
```

## Architecture Overview

### Monorepo Structure

```
index/
├── protocol/          # Backend API & Agent Engine (Bun, Express, TypeScript)
└── frontend/          # Vite + React Router v7 SPA with React 19
```

### Protocol Architecture

**Tech Stack**: Bun runtime, Express.js, Drizzle ORM, PostgreSQL with pgvector, BullMQ (Redis-backed queues), LangChain/LangGraph

**Key Directories**:
- `src/controllers/` - API controllers (chat, intent, opportunity, profile, upload, messaging); used with decorator-based routing in `main.ts`
- `src/adapters/` - Implementations of protocol interfaces (database, embedder, cache, queue, scraper, storage, messaging); implement interfaces from `src/lib/protocol/interfaces/`
- `src/services/` - Business logic layer
- `src/schemas/` - Drizzle table definitions; primary schema is `schemas/database.schema.ts`
- `src/guards/` - Auth/validation guards for the decorator router (e.g. `auth.guard.ts`)
- `src/types/` - Shared TypeScript types
- `src/cli/` - CLI and maintenance scripts (db-seed, db-flush, db-apply-schema, db-reset-remote, backfill-profile-hyde, generate-profiles, opportunity-three-user-test, test-data). Note: some package.json maintenance scripts (trigger-integration, export-slack, import-slack-export, reset-brokers, update-embeddings, audit-intent-freshness) reference CLI files that no longer exist
- `src/lib/` - Utilities, infrastructure; includes `lib/protocol/` (graphs, agents, interfaces, docs), `lib/drizzle/`, `lib/router/`, `lib/smartest/` (LLM-based test verification framework), `lib/performance/` (performance monitoring decorators/wrappers), `lib/parallel/` (parallel execution utilities), `lib/request-context.ts` (AsyncLocalStorage for request-scoped data like originUrl)
- `src/lib/protocol/` - Protocol layer: `graphs/` (LangGraph state machines: chat, home, hyde, index, index_membership, intent, intent_index, opportunity, profile), `agents/` (chat agent, intent inferrer/indexer/reconciler/verifier/clarifier, opportunity evaluator/presenter, profile/hyde generators, home categorizer, lens inferrer, suggestion generator, chat title generator), `states/` (graph state definitions: chat, home, hyde, index, index_membership, intent, intent_index, opportunity, profile), `streamers/` (response streaming: chat.streamer, response.streamer), `support/` (protocol utilities: chat checkpointer/utils, opportunity card-text/constants/discover/enricher/persist/presentation/sanitize/utils, debug-meta sanitizer, lucide icon-catalog, protocol logger), `tools/` (agent tool definitions: contact, index, integration, intent, opportunity, profile, utility tools), `interfaces/` (database, embedder, cache, queue, scraper, storage), `docs/`
- `src/queues/` - BullMQ job queue definitions
- `src/events/` - Event emitters for agent system (intent events, index membership events)

### Server Entry Point

The protocol server is `protocol/src/main.ts`: Bun native server on port 3001, controller classes registered via `RouteRegistry` (`@Controller`, `@Get`, `@Post`, etc.) in `src/lib/router/router.decorators.ts`, guards, and adapter-injected controllers (e.g. `ChatDatabaseAdapter` for opportunity controller). Started with `bun run dev` / `bun run start`.

### Agent System (LangGraph-Based)

Agents use `createModel()` from `model.config.ts` for LLM configuration (model, temperature, max tokens) and Zod schemas for structured output validation.

**LangGraph Patterns**:

- **When to use**: Multi-step workflows with conditional logic, read/write separation, state accumulation, parallel map-reduce. Do **not** use for simple CRUD, single LLM calls, or linear agent calls.
- **File organization**: Each graph in `{domain}.graph.ts` with factory, nodes, and inline state annotation (`Annotation.Root` with reducers).
- **Factory pattern**: Factory class accepts dependencies (database, embedder, agents) via constructor; no hardcoded dependencies.
- **Nodes**: Async functions accepting state, returning partial state. Catch errors (do not throw). Use `{action}Node` naming.
- **Conditional routing**: Every graph must have at least one conditional edge. Map all branches to valid node names or END.
- **Checklist**: Conditional edge; `Annotation.Root` state; factory with DI; node error handling; fast paths; routing tests.

**Protocol Agents** (`src/lib/protocol/agents/`):

All agents live under `src/lib/protocol/agents/`. There is no separate `src/agents/` directory.

1. **Chat Agents**:
   - `chat.agent.ts` - Main chat agent with prompt in `chat.prompt.ts`
   - `chat.title.generator.ts` - Generates chat session titles

2. **Intent Agents**:
   - `intent.inferrer.ts` - Extracts intents from uploaded content
   - `intent.indexer.ts` - Assigns intents to relevant indexes (communities)
   - `intent.reconciler.ts` - Reconciles intent changes
   - `intent.verifier.ts` - Verifies intent quality
   - `intent.clarifier.ts` - Clarifies ambiguous intents

3. **Opportunity Agents**:
   - `opportunity.evaluator.ts` - Evaluates opportunity matches
   - `opportunity.presenter.ts` - Formats opportunity presentation

4. **Profile/Discovery Agents**:
   - `profile.generator.ts` - Generates user profiles from identity signals
   - `profile.hyde.generator.ts` - Creates profile-specific HyDE documents
   - `hyde.generator.ts` - Creates Hypothetical Document Embeddings for semantic search
   - `hyde.strategies.ts` - HyDE generation strategies
   - `lens.inferrer.ts` - Infers discovery lenses
   - `suggestion.generator.ts` - Generates suggestions
   - `home.categorizer.ts` - Categorizes home feed content

**Protocol Graphs** (`src/lib/protocol/graphs/`): chat, home, hyde, index, index_membership, intent, intent_index, opportunity, profile. See docs under `lib/protocol/docs/` for design details.

**Agent Execution Pattern**:
```typescript
// Agents are called from services
const result = await agent.run(input);

// Services handle persistence and event emission
await db.insert(intents).values(result);
IntentEvents.onCreated({ intentId, userId, payload?, previousStatus? });

// Brokers react to events asynchronously (they implement onIntentCreated(intentId), etc.)
```

### Database Layer (Drizzle ORM)

**Schema Location**: `protocol/src/schemas/database.schema.ts`. The Drizzle client is in `protocol/src/lib/drizzle/drizzle.ts`.

**Core Tables**:
- `users` - User accounts (Better Auth)
- `user_profiles` - User identity with vector embeddings (2000-dim, text-embedding-3-large)
- `intents` - User intents with vector embeddings and confidence scores
- `indexes` - Communities/collections of related intents; personal indexes have `isPersonal=true` (one per user, created on registration)
- `personal_indexes` - Mapping table enforcing one personal index per user (PK on `userId`, unique on `indexId`)
- `index_members` - Membership with custom prompts and auto-assignment settings
- `intent_indexes` - Many-to-many junction (intents ↔ indexes) with composite PK and optional `relevancyScore` (0.0–1.0)
- `files` / `user_integrations` - Source tracking for intents
- `chat_sessions` / `chat_messages` - Chat session and message storage (chat graph, chat.service)
- `user_notification_settings` - User notification preferences
- `opportunities` - Opportunity records (detection, actors, interpretation, context, status)
- `hyde_documents` - Stored HyDE documents for retrieval
- `sessions` / `accounts` / `verifications` / `jwks` - Better Auth tables
- `links` - Shareable link records
- `hidden_conversations` - Hidden conversation tracking
- `user_contacts` - My Network contacts (owner/user pairs with source: gmail|google_calendar|manual)

**Key Features**:
- pgvector extension for 2000-dimensional embeddings
- HNSW indexes for fast similarity search
- Polymorphic source tracking (sourceType: file|integration|link|discovery_form|enrichment)
- Soft deletes with deletedAt timestamp

**Type Safety**: Full TypeScript types auto-generated from schema via Drizzle

### Queue System (BullMQ)

**Location**: `protocol/src/queues/` and `protocol/src/jobs/`

**Queue Types**:
- `intent.queue.ts` - Intent indexing and generation jobs
- `opportunity.queue.ts` - Matching intents with opportunities
- `profile.queue.ts` - User profile generation
- `hyde.queue.ts` - HyDE document generation jobs
- `email.queue.ts` - Email delivery jobs
- `notification.queue.ts` - Notification delivery

**Job Pattern**:
- Default: 3 retries with exponential backoff (1s delay)
- Cleanup: Completed jobs removed after 24h, failed after 7d
- Default concurrency: 1 (sequential processing)

**Monitoring**: Bull Board UI is served at http://localhost:3001/dev/queues/ when the protocol server is running

### API Routes Organization

**Location**: API routes are defined by controller classes using decorators in `protocol/src/controllers/`. See Server Entry Point and Adapter/Controller patterns.

**Authentication Pattern**: Routes use guards (e.g. `auth.guard.ts`) which validate Better Auth session and create/update users in DB.

**Key Controllers and Routes**:
- `AuthController` - Authentication (Better Auth integration)
- `IntentController` - Intent CRUD, generation, suggestions
- `IndexController` - Community management
- `FileController` - File uploads and processing
- `ChatController` - Chat interface
- `ProfileController` - User profiles
- `OpportunityController` / `IndexOpportunityController` - Opportunity management
- `UploadController` - Upload handling
- `UserController` - User management
- `LinkController` - Link management
- `MessagingController` - Messaging operations
- `DebugController` - Debug endpoints for pipeline tracing (dev/admin only, gated by `DebugGuard`)
- `QueuesController` - Bull Board queue monitoring UI

### Frontend Architecture

**Framework**: Vite, React Router v7, React 19, Tailwind CSS 4

**Directory Structure**:
- `src/main.tsx` - App entry point with provider tree
- `src/routes.tsx` - Route definitions (React Router `createBrowserRouter`)
- `src/app/` - Page components (client-side, lazy loaded)
  - `/` - Home page
  - `/about` - About page
  - `/chat` - Main chat interface
  - `/profile` - User profile management
  - `/library` - Library
  - `/networks` - Networks listing; `/networks/:id` - Network detail
  - `/index/:indexId` - Index detail pages
  - `/u/:id` - User profile pages; `/u/:id/chat` - User chat
  - `/d/:id` - Discovery/detail (e.g. by id)
  - `/l/:code` - Link redirect (e.g. by code)
  - `/s/:token` - Shared session view (e.g. by share token)
  - `/blog` - Blog listing; `/blog/:slug` - Markdown-based blog posts
  - `/onboarding` - First-user onboarding chat flow (identity, profile, communities, intent)
  - `/oauth/callback` - OAuth popup callback (posts result to opener via postMessage)
  - `/pages/privacy-policy`, `/pages/terms-of-use` - Legal pages
  - `/dev/intent-proposal` - Dev tool for intent proposal testing
- `src/components/` - Reusable React components
- `src/contexts/` - React Context providers (Auth, AIChatContext, AIChatSessionsContext, API, DiscoveryFilter, Indexes, IndexFilter, Notifications, SaveBar, XMTP)
- `src/services/` - Frontend API clients (typed fetch wrappers)
- `src/lib/` - Utilities and shared logic
- `build-blog.ts` - Blog pre-build script (generates blog assets at build time)

**Routing**: React Router v7 with `createBrowserRouter`. Page components are lazy-loaded for code splitting. Route params use `:param` syntax (e.g. `/u/:id`).

**Authentication**: Better Auth (session-based; email, social, etc.)

**Blog**: Blog posts are pre-built at build time via `build-blog.ts` and rendered client-side with react-markdown.

**API Proxy**: In development, the Vite dev server proxies `/api/*` requests to the protocol backend (port 3001). In production, a reverse proxy handles this.

**UI Libraries**: Tailwind CSS 4, Radix UI, Lucide React, Ant Design, react-markdown

## Important Patterns & Conventions

### Protocol Layering Rules

Strict layering: **Controllers -> Services -> Adapters**. Violations cause tight coupling and testing pain.

1. **Only `services` may import `adapters`.** Controllers and other layers must not depend on adapters directly.
2. **`lib` implementations** that need infrastructure must receive **adapters via constructor injection**, following the contract defined in `src/lib/protocol/interfaces/*.interface.ts`. They do not import adapters; they are injected.
3. **`controllers`** import and call **`services`** (or protocol graph factories) to perform operations. Controllers handle HTTP and delegate business logic.
4. **`services` must not import other `services`.** Cross-service orchestration should use events, queues, or the shared lib/graph layer.

### Template Files

Each layer has a `*.template.md` with coding guidelines. Consult before adding or changing code:

- `protocol/src/controllers/controller.template.md`
- `protocol/src/services/service.template.md`
- `protocol/src/queues/queue.template.md`
- `protocol/src/lib/protocol/agents/agent.template.md`

### Adapter Pattern

Protocol interfaces live in `src/lib/protocol/interfaces/` (e.g. `database.interface.ts`, `storage.interface.ts`). Implementations live in `src/adapters/` (auth, database, embedder, cache, integration, queue, scraper, storage, messaging). Controllers (e.g. opportunity, chat) receive database/queue abstractions via constructor injection so they can be tested with mocks.

**Adapter file naming**: Use **conceptual** names (role/capability), not implementation technology. Pattern: `{concept}.adapter.ts`. Examples: `database.adapter.ts` (not `drizzle.adapter.ts`), `cache.adapter.ts` and `queue.adapter.ts` (not `redis.adapter.ts`), `storage.adapter.ts` (not `s3.adapter.ts`). Tests: `{concept}.adapter.spec.ts`.

### Controller and Decorator Routing

The API uses class-based controllers with `@Controller(prefix)`, `@Get(path)`, `@Post(path)`, and optional guards. Routes are registered in `RouteRegistry` and dispatched in `main.ts`. See `protocol/src/controllers/controller.template.md` and `protocol/src/lib/router/router.decorators.ts`.

### Polymorphic Source Tracking

Intents track their origin via:
```typescript
sourceType: 'file' | 'integration' | 'link' | 'discovery_form' | 'enrichment'
sourceId: uuid // foreign key to source table
```

This enables filtering intents by source and bulk re-processing.

### Confidence & Inference Tracking

```typescript
// Intents have confidence scores
confidence: number // 0-1
inferenceType: 'explicit' | 'implicit'
```

### Personal Indexes

Each user has a personal index (`isPersonal=true`) created on registration, tracked via the `personal_indexes` mapping table (one row per user). Ownership is determined through `index_members` with `permissions: ['owner']`, not a denormalized column. Personal indexes contain the user's imported contacts and are used for network-scoped discovery. Contacts synced into a personal index automatically become members with `'contact'` permissions. When a user accepts an opportunity, the counterpart is auto-added as a contact.

Personal indexes cannot be deleted, renamed, or listed publicly. They are filtered from public index listings by guards.

### Index Prompts & Auto-Assignment

```typescript
// Indexes define their purpose (used by LLM for evaluation)
indexes.prompt: "Looking for AI/ML co-founders"

// Members can customize with specific criteria
indexMembers.prompt: "Specifically seeking PyTorch experts"
indexMembers.autoAssign: boolean // Auto-tag new intents?
```

LLM agents evaluate whether intents belong in indexes based on these prompts rather than hardcoded rules.

### Relevancy Scoring (Intent-Index Attribution)

When intents are assigned to indexes, an `IntentIndexer` agent scores the fit as `relevancyScore` (0.0–1.0). This score is used during opportunity discovery to break ties when a candidate appears across multiple shared indexes — the index with the highest relevancy to the trigger intent wins. Indexes without prompts default to score 1.0.

### Queue-Based Processing

Intent creation is synchronous (fast user feedback), but complex processing is asynchronous:

```typescript
// 1. Create intent immediately
const intent = await db.insert(intents).values(...);

// 2. Enqueue background jobs
await intentQueue.add('index_intent', { intentId, indexId });
await intentQueue.add('generate_intents', { sourceId });

// 3. Workers process jobs independently
// 4. Brokers react to events asynchronously
```

### Event-Driven Broker System

Intent events live in `protocol/src/events/intent.event.ts`. API: `IntentEvents.onCreated(event)`, `IntentEvents.onUpdated(event)`, `IntentEvents.onArchived(event)` where `event` has `intentId`, `userId`, and optional `payload`, `previousStatus`. Index membership events live in `protocol/src/events/index_membership.event.ts`.

Decoupled event handling for extensibility:

```typescript
// Service emits events after DB transaction
IntentEvents.onCreated({ intentId, userId, payload?, previousStatus? });

// Other services/graphs react to events independently
```

### OpenRouter Configuration

The protocol uses OpenRouter as the LLM provider. Model settings per agent are centralized in `protocol/src/lib/protocol/agents/model.config.ts` — the single source of truth for model names, temperatures, and token limits.

**Environment Variables**:
- `OPENROUTER_API_KEY` - Required
- `OPENROUTER_BASE_URL` - Optional (defaults to `https://openrouter.ai/api/v1`)
- `CHAT_MODEL` - Override chat agent model (defaults to `google/gemini-3-pro-preview`)
- `CHAT_REASONING_EFFORT` - Chat reasoning budget (`minimal|low|medium|high|xhigh`, defaults to `low`)

## Environment Setup

### Protocol Environment Variables

**Required**:
```bash
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/protocol_db

# LLM (OpenRouter)
OPENROUTER_API_KEY=your-openrouter-api-key

# Authentication

# Server
PORT=3001
NODE_ENV=development
```

**Optional** (see `protocol/env.example` for full list):
- `REDIS_URL` - Redis connection (defaults to localhost:6379)
- `RESEND_API_KEY` - Email delivery via Resend
- `UNSTRUCTURED_API_URL` - Document parsing API
- `COMPOSIO_API_KEY` - 3rd-party integrations (Slack, Notion, Gmail)
- `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` - LLM observability
- `SENTRY_DSN` - Error tracking
- `PARALLELS_API_KEY` - Web crawling and profile extraction

### Frontend Environment Variables

See `frontend/.env.example` for frontend-specific configuration (Better Auth, API URL, etc.)

**Auth origin (`invalid_origin`)**: If login fails with this error, the app’s current origin is not in the allowed list. Ensure the app origin is allowed in your Better Auth configuration (e.g. `trustedOrigins` or CORS) when developing locally.

## Testing

### Never commit without testing

Before committing any change:

1. **Automated testing**: Run the relevant test suite (e.g. `bun test path/to/affected.spec.ts` in protocol). Do not commit if tests fail or are skipped without good reason.
2. **Smoke test**: Manually verify the change works as intended (e.g. run the app, hit the changed flow, or run a quick manual check). Do not commit on "assumption" only.

If you cannot run tests yourself (e.g. agent cannot execute `bun test`), provide the exact commands for the user to run and ask them to confirm results before committing.

### Running tests

Run tests directly when needed. Always target specific test files affected by your changes rather than running the full suite.

### Test layout and commands

Tests use `bun test` framework. Test files are located in:
- `protocol/tests/` - Integration and E2E tests
- `protocol/src/lib/*/tests/` - Unit tests alongside code

**Run tests**:
```bash
cd protocol
bun test path/to/test.ts   # Run specific test file (PREFERRED)
bun test --watch           # Watch mode
bun test                    # Run ALL tests (slow — avoid unless necessary)
```

**Important**: Always target specific test files affected by your changes rather than running the full suite. `bun test` in protocol is slow. Use `bun test path/to/specific.spec.ts` instead.

**Test Categories**:
- Integration tests: Test agent interactions with services
- E2E tests: Test full API workflows
- Smoke tests: Test external integrations (crawl4ai, etc.)

**Bun Test Standards**: Load env at top before imports. Import from `bun:test` (destructured). Use `describe` grouping with clear test names. Set timeouts (agent: 30s, graph: 60s, LLM: 120s). Clean up in `afterAll`. Use specific matchers. Mock externals with `mock()`. Test success and error paths.

Checklist: env at top; imports from `bun:test`; `describe` grouping; clear test names; timeouts set; lifecycle cleanup in `afterAll`; specific assertions; mocks for externals; success and error paths; realistic data.

## Database Workflow

### Migration Naming Convention

Drizzle generates random names like `0002_flashy_millenium_guard.sql`. **Always rename** generated migrations to descriptive names before committing.

**Format**: `{NNNN}_{action}_{target}[_{detail}].sql`

| Component | Description | Examples |
|-----------|-------------|---------|
| `NNNN` | Zero-padded sequence number | `0000`, `0001`, `0012` |
| `action` | What the migration does | `initial`, `add`, `drop`, `create`, `alter`, `rename` |
| `target` | Table or feature affected | `users`, `chat_session`, `index_members` |
| `detail` | Optional specifics | `share_token`, `wallet_columns`, `pk` |

**Examples**:
```
0000_initial_schema.sql
0001_add_chat_session_share_token.sql
0002_add_user_wallet_xmtp_columns.sql
0003_drop_agent_wallet_columns.sql
0004_create_hidden_conversations.sql
0006_add_index_members_pk.sql
```

**After renaming**: Update the `tag` field in `drizzle/meta/_journal.json` to match (tag = filename without `.sql`). **Do not rename snapshot files** — keep them as `{NNNN}_snapshot.json`.

**Checklist when generating a new migration**: (1) `bun run db:generate`. (2) Rename the generated `.sql` file (e.g. `mv drizzle/0007_random_name.sql drizzle/0007_descriptive_name.sql`). (3) Edit `drizzle/meta/_journal.json`: set the `tag` for that entry to the new filename without `.sql`. (4) `bun run db:migrate`. (5) Verify: `bun run db:generate` should report "No schema changes".

### Making Schema Changes

1. **Edit schema**: Modify `protocol/src/schemas/database.schema.ts`
2. **Generate migration**: `bun run db:generate`
3. **Rename migration**: Rename the generated `.sql` file and update the journal `tag`
4. **Review migration**: Check `drizzle/` directory for generated SQL
5. **Apply migration**: `bun run db:migrate`
6. **Verify**: `bun run db:studio` to inspect changes

### Why migrations get out of sync

Migrations break when: (1) `_journal.json` and `.sql` files diverge (every `.sql` needs a matching journal entry), (2) SQL is applied outside Drizzle (manually or via `db:apply-schema`) without updating `__drizzle_migrations`, or (3) pgvector `CREATE EXTENSION vector` is missing from the first migration. Always use `bun run db:migrate` to keep tracking consistent.

### Making db:migrate the single source of truth

- **Same DB as the app:** `drizzle.config.ts` loads `.env.development`; run `bun run db:migrate` from `protocol/` so it uses the same `DATABASE_URL` as the app.
- **Fresh DB:** Run `bun run db:migrate` once; it will apply 0000 then 0001 (and any newer migrations).
- **Existing DB that was set up with db:apply-schema or manual SQL:** Run `bun run db:migrate`; it will apply any migrations not yet in `__drizzle_migrations`. If the DB is missing a column (e.g. `share_token`), ensure the migration journal and files are in sync, then run `db:migrate` again, or apply the missing migration SQL by hand and insert the corresponding row into `__drizzle_migrations`.

### Fixing ruined migrations

If local migrations are corrupted or out of sync:

```bash
cd protocol
bun run maintenance:fix-migrations   # Reset DB, regenerate one migration with pgvector, then restore drizzle/
```

For a **remote** DB (e.g. Neon) you can reset and re-run all migrations:

```bash
bun run maintenance:reset-remote-db -- --confirm
bun run db:migrate
```

### Common Operations

```bash
# View current database state
bun run db:studio

# Reset database (development only)
bun run db:flush
bun run db:migrate
bun run db:seed
```

## Debugging & Monitoring

### Queue Monitoring

```bash
# Bull Board at http://localhost:3001/dev/queues/ (when server is running)
# View job status, retry failed jobs, clear queues
```

### LLM Observability

If Langfuse is configured (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`):
- All agent calls are traced automatically
- View traces at https://us.cloud.langfuse.com

### Error Tracking

If Sentry is configured (`SENTRY_DSN`):
- Errors and performance metrics are sent to Sentry
- Check Sentry dashboard for issues

## Code Style & Practices

### TypeScript

- Strict mode enabled
- **Do not use `any`** — use proper types or `unknown` and narrow as needed. ESLint enforces `@typescript-eslint/no-explicit-any`.
- All agents use Zod schemas for validation
- Prefer type inference from Drizzle schema over manual types
- Use `Id<'tableName'>` type from `_generated/dataModel` for document IDs

### File Naming Convention

All files in the protocol directory should follow the pattern: `{domain}.{purpose}.{extension}`

- **domain**: The scope or area (e.g., `chat`, `intent`, `profile`, `opportunity`)
- **purpose**: The type or role (e.g., `graph`, `agent`, `generator`, `verifier`, `state`, `spec`)

**Common Purpose Types**:
| Purpose | Description | Example |
|---------|-------------|---------|
| `.graph` | LangGraph state machines | `chat.graph.ts` |
| `.state` | State definitions | `chat.state.ts` |
| `.agent` | AI agents | `router.agent.ts` |
| `.generator` | Content generators | `response.generator.ts` |
| `.evaluator` | Evaluation/scoring logic | `opportunity.evaluator.ts` |
| `.verifier` | Verification/validation | `semantic.verifier.ts` |
| `.inferrer` | Inference logic | `explicit.inferrer.ts` |
| `.reconciler` | Reconciliation logic | `intent.reconciler.ts` |
| `.controller` | API controllers | `chat.controller.ts` |
| `.service` | Business logic services | `intent.service.ts` |
| `.queue` | Job queue definitions | `intent.queue.ts` |
| `.spec` | Test files | `router.agent.spec.ts` |

**Adapters** (`protocol/src/adapters/`): Name by **concept**, not by tech. Use `{concept}.adapter.ts` (e.g. `database.adapter.ts`, `cache.adapter.ts`, `queue.adapter.ts`). Do not name after the implementation (e.g. no `drizzle.adapter.ts`, `redis.adapter.ts`, `bullmq.adapter.ts`). See Adapter Pattern above.

**Exceptions** (exempt from convention):
- `index.ts` - Barrel export files
- `schema.ts` - Database schema files
- `main.ts` - Application entry points
- Single-purpose utility files at root level (e.g., `constants.ts`, `types.ts`)

**Good examples**: `chat.graph.ts`, `chat.graph.state.ts`, `router.agent.ts`, `response.generator.ts`, `explicit.inferrer.ts`, `intent.reconciler.ts`, `opportunity.evaluator.ts`. **Bad**: `chatGraph.ts` → use `chat.graph.ts`; `intentAgent.ts` → use `intent.agent.ts`; `generator.ts` → use `{domain}.generator.ts`.

**Naming new files**: (1) Identify domain/scope (e.g. chat, intent, profile). (2) Identify purpose/type (e.g. agent, graph, generator). (3) Name: `{domain}.{purpose}.ts` (e.g. message validator → `message.validator.ts`).

### Import Ordering

Order imports from most general (external) to most local (nearby), separated by blank lines:

1. **External packages** (npm modules)
2. **Deep relative imports** (multiple levels up: `../../`, `../../../`, etc.)
3. **Nearby relative imports** (siblings/children: `./` or `../`)

```typescript
// ❌ BAD - Wrong order, no grouping
import { something } from "./nearby";
import { util } from "../../../lib/utils";
import express from "express";

// ✅ GOOD
import express from "express";
import { z } from "zod";

import { util } from "../../../lib/utils";
import { helper } from "../../helpers/helper";

import { something } from "../something";
import { local } from "./nearby";
```

### TSDoc

- Add **TSDoc comments** for all **classes** (summary and, when useful, `@remarks` or `@example`)
- Add **TSDoc comments** for all **public methods** (summary, `@param`, `@returns`, `@throws` where relevant)

```typescript
/**
 * Handles intent lifecycle and persistence.
 * @remarks Delegates to adapters for DB and queue; does not call other services.
 */
export class IntentService {
  /**
   * Creates an intent and enqueues indexing jobs.
   * @param input - Validated intent payload
   * @returns The created intent with id
   */
  async create(input: CreateIntentInput): Promise<Intent> { ... }
}
```

### Agents

- Use `createModel()` from `model.config.ts` for LLM configuration
- Define input/output as Zod schemas; configure temperature/maxTokens in `model.config.ts`
- Keep agents pure (no direct DB access) - let services handle persistence

### Services

- Encapsulate business logic, handle DB transactions, emit events, return typed results
- Use Drizzle for type-safe queries
- **Must not import other services** — use events, queues, or shared lib for cross-service orchestration

### Controllers

- Handle HTTP and delegate to services/graphs; use guards for auth (e.g. `AuthGuard`)
- Validate input with Zod; return consistent JSON responses
- **Must not import adapters directly** — only services may import adapters

### Database

- Canonical schema and table definitions live in `src/schemas/database.schema.ts`; import from there (not from `lib/schema`)
- Use Drizzle's query builder for type safety
- Define relations in schema for automatic joins
- Create indexes for frequently queried columns
- Use vector similarity for semantic search
- Prefer soft deletes (deletedAt) over hard deletes

## Git Workflow

Follow these conventions for version control operations.

### Always use worktrees for fixes and new features

**Use a worktree** for any new feature or bugfix work. Do not do feature or fix work on the main working tree (e.g. on `dev` at repo root). Create a worktree, do the work there, then open PRs from that branch. This keeps `dev` stable and isolates changes.

- **New feature** → create worktree folder `feat-my-feature` (branch: `feat/my-feature`), implement and test there.
- **Bug fix** → create worktree folder `fix-issue-name` (branch: `fix/issue-name`), fix and test there.

Only use the main working tree for small docs/config edits, dependency bumps, or when explicitly told otherwise.

### Worktrees

Worktrees live in `.worktrees/` (gitignored), sharing git history with an isolated working tree. **Folder names must use dashes** (e.g. `feat-my-feature`, not `feat/my-feature`); branches inside can use slashes. Run `bun run worktree:setup <name>` after creation to symlink `.env*` files and install dependencies.

```bash
git worktree add .worktrees/feat-foo dev
bun run worktree:setup feat-foo    # symlink .env files + bun install
bun run worktree:dev feat-foo      # start all dev servers (auto-setups if needed)
```

Use `bun run worktree:list` to see worktrees and status. Root `bun run dev` lets you pick root or a worktree interactively.

### Conventional Commits

Commit messages should follow the Conventional Commits format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer]
```

**Commit Types**:
- `feat` - New feature (MINOR in SemVer)
- `fix` - Bug fix (PATCH in SemVer)
- `docs` - Documentation changes
- `style` - Formatting, whitespace (no code change)
- `refactor` - Code change that neither fixes nor adds
- `perf` - Performance improvement
- `test` - Adding/correcting tests
- `chore` - Maintenance tasks

**Breaking Changes**: Add `BREAKING CHANGE:` in body/footer, or append `!` after type (e.g., `feat!:`)

### Conventional Branches

Branch names **always** follow `<type>/<short-description>`, even when created from Linear issues. Do not use Linear issue IDs as branch names (e.g. no `IND-123`). Instead, derive a conventional branch name from the issue context.

```bash
feat/user-authentication
fix/login-redirect-loop
refactor/intent-service
test/chat-controller
```

### Pull Requests

1. Use `gh` CLI to create PRs into `upstream/dev`
2. Write PR description as a changelog with categories:
   - **New Features**
   - **Bug Fixes**
   - **Refactors**
   - **Documentation**
   - **Tests**

### Finishing a Development Branch

When a feature or fix branch is complete and ready to integrate:

1. **Update CLAUDE.md**: If the branch introduced new files, directories, tables, routes, agents, graphs, or other structural changes, update CLAUDE.md to reflect them before merging.
2. **Merge into dev**: `git checkout dev && git merge <branch-name>`
3. **Push both remotes**: `git push upstream dev && git push origin dev`
4. **Clean up**: Delete the branch (`git branch -d <branch-name>`) and remove the worktree (`git worktree remove .worktrees/<worktree-name>`)

## Key Dependencies

**Protocol**:
- `langchain` / `@langchain/core` / `@langchain/openai` - Agent orchestration
- `drizzle-orm` / `postgres` - Database ORM and driver
- `bullmq` / `ioredis` - Job queues and Redis client
- `express` / `helmet` / `cors` - HTTP server
- `zod` - Schema validation
- `openai` - OpenAI-compatible client (used with OpenRouter)
- `@composio/core` - Integration platform
- `langfuse-langchain` - LLM observability
- `resend` - Email delivery

**Frontend**:
- `vite` - Build tool and dev server
- `react-router` - Client-side routing
- `react` / `react-dom` - UI library
- `tailwindcss` - CSS framework
- `@radix-ui/*` - Accessible UI primitives
- `react-markdown` - Markdown rendering

