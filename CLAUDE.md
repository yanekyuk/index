# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Index Network is a private, intent-driven discovery protocol built on autonomous agents. Users define "intents" and competing Broker Agents work to fulfill them through relevant connections. The system leverages LangChain/LangGraph for agent orchestration, PostgreSQL with pgvector for semantic search, and a monorepo structure with protocol (backend) and frontend (Next.js) workspaces.

## Development Commands

### Protocol (Backend)

```bash
cd protocol

# Development
bun --watch src/index.ts                    # Start dev server with hot reload
bun dist/index.js                           # Start production server

# Database (Drizzle ORM)
bun run db:generate                         # Generate migrations after schema changes
bun run db:migrate                          # Apply pending migrations
bun run db:studio                           # Open Drizzle Studio (interactive DB GUI)

# Database utilities
bun run db:seed                             # Seed database with sample data
bun run db:flush                            # Flush all data from database

# Testing
bun test                                    # Run tests with vitest
bun test tests/e2e.test.ts                  # Run specific test file
bun test --watch                            # Run tests in watch mode

# Code quality
bun run lint                                # Run ESLint

# Queue monitoring
bun run admin-queues                        # Start BullBoard UI for queue monitoring

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
bun run dev                                 # Start Next.js dev server (Turbopack)
bun run build                               # Build for production
bun run start                               # Start production server
bun run lint                                # Run ESLint
```

### Root

```bash
# Install dependencies for all workspaces
bun install
```

## Architecture Overview

### Monorepo Structure

```
index/
├── protocol/          # Backend API & Agent Engine (Bun, Express, TypeScript)
├── frontend/          # Next.js 15 App with React 19
├── contracts/         # Smart contracts (blockchain)
├── redis/            # Redis configuration
└── txt/              # Documentation/knowledge base
```

### Protocol Architecture

**Tech Stack**: Bun runtime, Express.js, Drizzle ORM, PostgreSQL with pgvector, BullMQ (Redis-backed queues), LangChain/LangGraph

**Key Directories**:
- `src/agents/` - LangGraph-based AI agents for intent processing
- `src/routes/` - Express API route handlers
- `src/services/` - Business logic layer
- `src/lib/` - Utilities, database schema, infrastructure
- `src/middleware/` - Express middleware (auth, validation)
- `src/queues/` - BullMQ job queue definitions
- `src/jobs/` - Scheduled cron jobs
- `src/events/` - Event emitters for agent system

### Agent System (LangGraph-Based)

All agents extend `BaseLangChainAgent` which wraps LangChain's ChatOpenAI model (configured for OpenRouter). Agents use Zod schemas for structured output validation.

**Agent Categories**:

1. **Intent Agents** (`agents/intent/`):
   - `ExplicitIntentInferrer` - Extracts intents from uploaded content (files, links)
   - `ImplicitInferrer` - Infers intents from implicit signals
   - `IntentManager` - Orchestrates intent lifecycle (create/update/expire actions)
   - `IntentRefiner` - Refines intent descriptions
   - `SyntacticEvaluator` / `SemanticEvaluator` - Validates intent quality using felicity conditions (Searle's Speech Acts)

2. **Core Agents** (`agents/core/`):
   - `IntentIndexer` - Assigns intents to relevant indexes (communities)
   - `IntentSummarizer` - Generates concise summaries
   - `IntentTagSuggester` - Recommends categorization tags
   - `IntentFreshnessAuditor` - Monitors intent staleness

3. **Profile Agents** (`agents/profile/`):
   - `ProfileGenerator` - Generates user profiles from identity signals
   - `HydeGenerator` - Creates Hypothetical Document Embeddings for semantic search

4. **Context Brokers** (`agents/context_brokers/`):
   - Event-driven agents that react to intent lifecycle (onIntentCreated, onIntentUpdated, onIntentArchived)
   - Example: `SemanticRelevancyBroker` finds semantically related intents and creates stakes linking them

**Agent Execution Pattern**:
```typescript
// Agents are called from services
const result = await agent.run(input);

// Services handle persistence and event emission
await db.insert(intents).values(result);
IntentEvents.onIntentCreated(intentId);

// Brokers react to events asynchronously
```

### Database Layer (Drizzle ORM)

**Schema Location**: `protocol/src/lib/schema.ts`

**Core Tables**:
- `users` - User accounts (Privy authentication)
- `user_profiles` - User identity with vector embeddings (2000-dim, text-embedding-3-large)
- `intents` - User intents with vector embeddings and confidence scores
- `indexes` - Communities/collections of related intents
- `index_members` - Membership with custom prompts and auto-assignment settings
- `intent_indexes` - Many-to-many junction (intents ↔ indexes)
- `intent_stakes` - Relationships between intents with confidence tracking
- `files` / `user_integrations` - Source tracking for intents
- `user_connection_events` - Connection requests/approvals

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
- `newsletter.queue.ts` - Weekly digest generation
- `opportunity.queue.ts` - Matching intents with opportunities
- `profile.queue.ts` - User profile generation

**Job Pattern**:
- Default: 3 retries with exponential backoff (1s delay)
- Cleanup: Completed jobs removed after 24h, failed after 7d
- Default concurrency: 1 (sequential processing)

**Monitoring**: Use `bun run admin-queues` to start BullBoard UI at http://localhost:3001/admin/queues

### API Routes Organization

**Location**: `protocol/src/routes/`

**Middleware Pattern**: All routes use `authenticatePrivy` middleware which validates Privy JWT tokens and creates/updates users in DB.

**Key Routes**:
- `/api/auth` - Authentication (Privy integration)
- `/api/intents` - Intent CRUD, generation, suggestions
- `/api/indexes` - Community management
- `/api/files` - File uploads and processing
- `/api/connections` - User-to-user connections
- `/api/integrations` - External service connectors (Slack, Notion, etc.)
- `/api/discover` - Discovery/matching endpoint
- `/api/chat` - Chat interface
- `/api/queue` - Queue monitoring

### Frontend Architecture

**Framework**: Next.js 15 (App Router), React 19, Tailwind CSS

**Directory Structure**:
- `src/app/` - Next.js App Router pages (file-based routing)
  - `/index/[indexId]` - Index detail pages
  - `/u/[id]` - User profile pages
  - `/i/[id]` - Intent detail pages
  - `/onboarding` - User onboarding flows
  - `/inbox` - User inbox/notifications
  - `/blog` - Markdown-based blog posts
- `src/components/` - Reusable React components
- `src/contexts/` - React Context providers (Auth, API, Notifications, StreamChat)
- `src/services/` - Frontend API clients (typed fetch wrappers)
- `src/lib/` - Utilities and shared logic

**Authentication**: Privy (Web3 authentication with email, social, wallet support)

**UI Libraries**: Tailwind CSS, Radix UI, Lucide React, Ant Design, react-markdown

## Important Patterns & Conventions

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

// Intent stakes track relationships with reasoning
intentStakes: { confidence, reasoning, ... }
```

### Index Prompts & Auto-Assignment

```typescript
// Indexes define their purpose (used by LLM for evaluation)
indexes.prompt: "Looking for AI/ML co-founders"

// Members can customize with specific criteria
indexMembers.prompt: "Specifically seeking PyTorch experts"
indexMembers.autoAssign: boolean // Auto-tag new intents?
```

LLM agents evaluate whether intents belong in indexes based on these prompts rather than hardcoded rules.

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

Decoupled event handling for extensibility:

```typescript
// Service emits events after DB transaction
IntentEvents.onIntentCreated(intentId);

// Brokers listen and react independently
SemanticRelevancyBroker.onIntentCreated(intentId);
// - Finds related intents via vector search
// - Creates intentStakes linking them
// - Enables discovery
```

Add new brokers without modifying intent logic.

### OpenRouter Configuration

The protocol uses OpenRouter as the LLM provider with **presets** for different agent types. Each preset is configured at https://openrouter.ai/settings/presets with specific model, temperature, and max_tokens settings.

**Required Presets** (configure in OpenRouter dashboard):
- `intent-inferrer` - Complex structured output generation from content
- `intent-summarizer` - Text summarization with length constraints
- `intent-tag-suggester` - Tag/cluster generation from intent analysis
- `intent-indexer` - Intent appropriateness evaluation scoring
- `vibe-checker` - Collaboration synthesis generation
- `intro-maker` - Email introduction generation
- `semantic-relevancy` - Semantic intent relationship analysis
- `intent-freshness-auditor` - Intent expiration detection based on temporal markers

**Environment Variables**:
```bash
OPENROUTER_API_KEY=your-openrouter-api-key
```

Agents reference presets by name in their configuration. This allows centralized control of model selection and parameters for each agent type.

## Environment Setup

### Protocol Environment Variables

**Required**:
```bash
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/protocol_db

# LLM (OpenRouter)
OPENROUTER_API_KEY=your-openrouter-api-key
# Note: Create presets at https://openrouter.ai/settings/presets
# See "OpenRouter Configuration" section above for required preset names

# Authentication
PRIVY_APP_ID=your-privy-app-id
PRIVY_APP_SECRET=your-privy-app-secret

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
- `SNOWFLAKE_*` - Social media data warehouse

### Frontend Environment Variables

See `frontend/.env.example` for frontend-specific configuration (Privy app ID, API URL, etc.)

## Testing

Tests use Vitest framework. Test files are located in:
- `protocol/tests/` - Integration and E2E tests
- `protocol/src/lib/*/tests/` - Unit tests alongside code

**Run tests**:
```bash
cd protocol
bun test                    # Run all tests
bun test --watch           # Watch mode
bun test path/to/test.ts   # Specific test file
```

**Test Categories**:
- Integration tests: Test agent interactions with services
- E2E tests: Test full API workflows
- Smoke tests: Test external integrations (crawl4ai, etc.)

## Database Workflow

### Making Schema Changes

1. **Edit schema**: Modify `protocol/src/lib/schema.ts`
2. **Generate migration**: `bun run db:generate`
3. **Review migration**: Check `drizzle/` directory for generated SQL
4. **Apply migration**: `bun run db:migrate`
5. **Verify**: `bun run db:studio` to inspect changes

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
bun run admin-queues
# Opens BullBoard UI at http://localhost:3001/admin/queues
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
- All agents use Zod schemas for validation
- Prefer type inference from Drizzle schema over manual types
- Use `Id<'tableName'>` type from `_generated/dataModel` for document IDs

### Agents

- Extend `BaseLangChainAgent` for consistency
- Define input/output as Zod schemas
- Set appropriate temperature per agent type
- Use Langfuse middleware for tracing
- Keep agents pure (no direct DB access) - let services handle persistence

### Services

- Services encapsulate business logic
- Handle database transactions
- Emit events after successful operations
- Return typed results
- Use Drizzle for type-safe queries

### API Routes

- All routes use `authenticatePrivy` middleware
- Validate input with express-validator
- Use `AuthRequest` type for authenticated requests
- Handle errors with try/catch and proper HTTP status codes
- Return consistent JSON responses

### Database

- Use Drizzle's query builder for type safety
- Define relations in schema for automatic joins
- Create indexes for frequently queried columns
- Use vector similarity for semantic search
- Prefer soft deletes (deletedAt) over hard deletes

## Key Dependencies

**Protocol**:
- `langchain` / `@langchain/core` / `@langchain/openai` - Agent orchestration
- `drizzle-orm` / `postgres` - Database ORM and driver
- `bullmq` / `ioredis` - Job queues and Redis client
- `express` / `helmet` / `cors` - HTTP server
- `@privy-io/server-auth` - Authentication
- `zod` - Schema validation
- `openai` - OpenAI-compatible client (used with OpenRouter)
- `@composio/core` - Integration platform
- `langfuse-langchain` - LLM observability
- `resend` - Email delivery
- `vitest` - Testing framework

**Frontend**:
- `next` - React framework
- `react` / `react-dom` - UI library
- `@privy-io/react-auth` - Authentication
- `tailwindcss` - CSS framework
- `@radix-ui/*` - Accessible UI primitives
- `stream-chat` - Real-time chat
- `react-markdown` - Markdown rendering

## Convex Guidelines (from .cursor/rules)

**Note**: The project includes Convex guidelines in `.cursor/rules/convex_rules.mdc`. While this codebase doesn't currently use Convex, the file contains patterns for:
- Function syntax and registration
- Schema design with validators
- Query/mutation/action patterns
- TypeScript best practices

These guidelines are preserved for reference but don't apply to the current Drizzle-based architecture.
