# Controller Template Guide

This document provides comprehensive guidelines for writing controller files in this project, based on patterns established in [`ProfileController`](profile.controller.ts).

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [File Structure Conventions](#file-structure-conventions)
3. [Adapter Pattern Guidelines](#adapter-pattern-guidelines)
4. [Decorator Usage](#decorator-usage)
5. [Dependency Injection Patterns](#dependency-injection-patterns)
6. [Testing Guidelines](#testing-guidelines)
7. [Best Practices](#best-practices)

---

## Architecture Overview

Controllers in this project follow a layered architecture that separates concerns:

```mermaid
graph TB
    subgraph Controller Layer
        C[Controller Class]
    end
    
    subgraph Service Layer
        S[Service Classes]
    end
    
    subgraph Adapters
        DA[Database Adapter]
        SA[Scraper Adapter]
        EA[Embedder Adapter]
    end
    
    subgraph Interfaces
        DI[Database Interface]
        SI[Scraper Interface]
        EI[Embedder Interface]
    end
    
    subgraph Infrastructure
        DB[(Drizzle ORM)]
        API[External APIs]
        EMB[Embedding Service]
    end
    
    subgraph Protocol Layer
        GF[Graph Factory]
        G[LangGraph Graph]
    end
    
    C --> S
    C --> GF
    S --> DB
    GF --> DA
    GF --> SA
    GF --> EA
    
    DA -.implements.-> DI
    SA -.implements.-> SI
    EA -.implements.-> EI
    
    DA --> DB
    SA --> API
    EA --> EMB
    
    GF --> G
```

### Key Architectural Principles

1. **Separation of Concerns**: Controllers handle HTTP, Services handle business logic, Adapters connect to Protocol layer
2. **No Direct Database Access in Controllers**: Controllers MUST use Services or Adapters, never import `db` directly
3. **Adapter Pattern**: Concrete implementations wrapped in adapters that implement protocol interfaces (used by graphs/agents)
4. **Service Pattern**: Business logic layer that uses Drizzle directly for data operations (used by controllers)
5. **Factory Pattern**: Graph creation is delegated to factory classes
6. **Decorator-based Routing**: Routes and guards are defined via TypeScript decorators

### When to Use Adapters vs Services

**Use Adapters when:**
- The controller needs to pass dependencies to a Protocol Layer graph or agent
- Implementing a protocol interface from `src/lib/protocol/interfaces/`
- The graph/agent needs database operations

**Use Services when:**
- The controller needs data operations (CRUD, queries)
- Business logic that doesn't involve protocol graphs
- File operations, user management, session management
- Any direct database access outside of protocol layer

**Example:**
```typescript
// Controller using both patterns
export class ChatController {
  private db: ChatGraphCompositeDatabase;  // Adapter for graph
  private embedder: Embedder;              // Adapter for graph
  private factory: ChatGraphFactory;       // Graph factory

  constructor() {
    // Adapters for protocol layer
    this.db = new ChatDatabaseAdapter();
    this.embedder = new EmbedderAdapter();
    this.factory = new ChatGraphFactory(this.db, this.embedder);
  }

  async getSessions(req: Request, user: AuthenticatedUser) {
    // Use service for simple data operations
    const sessions = await chatSessionService.getUserSessions(user.id);
    return Response.json({ sessions });
  }

  async processMessage(req: Request, user: AuthenticatedUser) {
    // Use graph factory with adapters for complex AI operations
    const graph = this.factory.createGraph();
    const result = await graph.invoke({ userId: user.id });
    return Response.json(result);
  }
}
```

---

## File Structure Conventions

### Naming Convention

Controller files follow the pattern: `{feature}.controller.ts`

- `profile.controller.ts` - Profile management controller
- `intent.controller.ts` - Intent handling controller
- `opportunity.controller.ts` - Opportunity management controller

### Internal File Organization

```typescript
// 1. Protocol imports (interfaces, factories, types)
import { Database } from '../lib/protocol/interfaces/database.interface';
import { Scraper } from '../lib/protocol/interfaces/scraper.interface';
import { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import { SomeGraphFactory } from '../lib/protocol/graphs/some/some.graph';

// 2. Service imports (for business logic)
import { userService } from '../services/user.service';
import { fileService } from '../services/file.service';

// 3. Adapter imports (for protocol layer)
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';

// 4. Decorator imports
import { Controller, Post, Get, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';

// 5. Logging
import { log } from '../lib/log';
const logger = log.controller.from('feature');

// 6. Controller class
@Controller('/resource-path')
export class SomeController {
  private db: Database;
  private embedder: Embedder;
  private factory: SomeGraphFactory;

  constructor() {
    // Initialize adapters for protocol layer
    this.db = new ChatDatabaseAdapter();
    this.embedder = new EmbedderAdapter();
    this.factory = new SomeGraphFactory(this.db, this.embedder);
  }

  @Get('/:id')
  @UseGuards(AuthGuard)
  async getData(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    // Use services for data operations
    const data = await userService.findById(params?.id);
    return Response.json(data);
  }

  @Post('/process')
  @UseGuards(AuthGuard)
  async process(req: Request, user: AuthenticatedUser) {
    // Use graph factory for protocol operations
    const graph = this.factory.createGraph();
    const result = await graph.invoke({ userId: user.id });
    return Response.json(result);
  }
}
```

### CRITICAL RULES

**Controllers MUST NOT:**
- Import `db` from `../lib/drizzle/drizzle`
- Import Drizzle operators (`eq`, `and`, `desc`, etc.)
- Import schema directly (`../schemas/database.schema`)
- Perform direct database queries

**Controllers MUST:**
- Use services for all data operations (CRUD, queries, business logic)
- Use adapters only for passing to protocol graphs/factories
- Handle HTTP concerns (parsing, validation, response formatting)
- Delegate all business logic to services

---

## Adapter Pattern Guidelines

Adapters bridge the gap between external dependencies and protocol interfaces. They are defined in `src/adapters/` and imported by controllers when needed for protocol graphs.

### When to Create New Adapters

Create adapters in `src/adapters/` when:
- A new protocol interface needs implementation
- A graph requires a different database interface subset
- Integrating a new external service (scraper, embedder, cache)

### Using Existing Adapters

Controllers should import pre-built adapters from `src/adapters/`:

```typescript
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
```

### Available Adapters

| Adapter | Interface | Purpose |
|---------|-----------|---------|
| `ChatDatabaseAdapter` | `ChatGraphCompositeDatabase` | Chat graph database operations |
| `IntentDatabaseAdapter` | `IntentGraphDatabase` | Intent graph database operations |
| `EmbedderAdapter` | `Embedder` | Vector embeddings generation and search |
| `ScraperAdapter` | `Scraper` | Web scraping and data extraction |
| `RedisCacheAdapter` | `HydeCache` | Redis-backed caching for HyDE |

### Adapter Usage Pattern

```typescript
@Controller('/profiles')
export class ProfileController {
  private db: ProfileGraphDatabase;
  private embedder: Embedder;
  private scraper: Scraper;
  private factory: ProfileGraphFactory;

  constructor() {
    // Import and instantiate adapters
    this.db = new ChatDatabaseAdapter() as ProfileGraphDatabase;
    this.embedder = new EmbedderAdapter();
    this.scraper = new ScraperAdapter();
    
    // Pass adapters to graph factory
    this.factory = new ProfileGraphFactory(this.db, this.embedder, this.scraper);
  }

  @Post('/sync')
  @UseGuards(AuthGuard)
  async sync(req: Request, user: AuthenticatedUser) {
    // Use factory to create and invoke graph
    const graph = this.factory.createGraph();
    const result = await graph.invoke({ userId: user.id });
    return Response.json(result);
  }
}
```

### Adapter Best Practices

1. **Reuse Existing Adapters**: Check `src/adapters/` before creating new ones
2. **Type Narrowing**: Use type assertions when an adapter implements multiple interfaces
3. **No Controller-Local Adapters**: Don't define adapters inside controller files
4. **Testing**: Adapters can be mocked in tests for faster, isolated controller testing

---

## Decorator Usage

The project uses custom decorators from [`router.decorators.ts`](../lib/router/router.decorators.ts) for routing and guards.

### Available Decorators

| Decorator | Purpose | Example |
|-----------|---------|---------|
| `@Controller(path)` | Class decorator defining base route path | `@Controller('/profiles')` |
| `@Get(path)` | GET endpoint | `@Get('/:id')` |
| `@Post(path)` | POST endpoint | `@Post('/sync')` |
| `@Put(path)` | PUT endpoint | `@Put('/:id')` |
| `@Delete(path)` | DELETE endpoint | `@Delete('/:id')` |
| `@UseGuards(...guards)` | Apply authentication/validation guards | `@UseGuards(AuthGuard)` |

### Decorator Application Order

Decorators are applied bottom-up, so place them in this order:

```typescript
@Controller('/profiles')
export class ProfileController {
  
  @Post('/sync')           // 1. Route definition
  @UseGuards(AuthGuard)    // 2. Guards (applied first at runtime)
  async sync(req: Request, user: AuthenticatedUser) {
    // Method implementation
  }
}
```

### Controller Class Structure

```typescript
@Controller('/resource-name')
export class ResourceController {
  // Private dependency fields
  private db: Database;
  private embedder: Embedder;
  private scraper: Scraper;
  private factory: SomeGraphFactory;

  // Constructor initializes adapters and factory
  constructor() {
    this.db = new DrizzleDatabaseAdapter();
    this.embedder = new IndexEmbedder();
    this.scraper = new ParallelScraperAdapter();
    this.factory = new SomeGraphFactory(this.db, this.embedder, this.scraper);
  }

  /**
   * JSDoc describing the endpoint purpose
   */
  @Post('/action')
  @UseGuards(AuthGuard)
  async action(req: Request, user: AuthenticatedUser) {
    const graph = this.factory.createGraph();
    const result = await graph.invoke({ userId: user.id });
    return Response.json(result);
  }
}
```

---

## Dependency Injection Patterns

### Interface Definitions

Interfaces are defined in [`src/lib/protocol/interfaces/`](../lib/protocol/interfaces/):

```typescript
// database.interface.ts - Full interface with all possible methods
export interface Database {
  getProfile(userId: string): Promise<ProfileDocument | null>;
  saveProfile(userId: string, profile: ProfileDocument): Promise<void>;
  saveHydeProfile(userId: string, description: string, embedding: number[]): Promise<void>;
  getUser(userId: string): Promise<User | null>;
  // ... other methods for different features
}

// scraper.interface.ts
export interface Scraper {
  scrape(url: string): Promise<string>;
}

// embedder.interface.ts
export interface Embedder extends EmbeddingGenerator, VectorStore { }
```

### Interface Narrowing with Pick

**Important**: Graphs should not depend on the full `Database` interface. Instead, they should use TypeScript's `Pick` utility to require only the specific methods they need. This ensures:

1. **Minimal coupling** - Graphs only depend on what they actually use
2. **Easier testing** - Mocks only need to implement required methods
3. **Clear contracts** - Self-documenting which database operations a graph needs

#### Graph Factory Example

```typescript
// In profile.graph.ts - Define narrow interface for this specific graph
type ProfileGraphDatabase = Pick<Database, 'getProfile' | 'saveProfile' | 'getUser'>;

export class ProfileGraphFactory {
  constructor(
    private db: ProfileGraphDatabase,  // Only requires 3 methods
    private embedder: Embedder,
    private scraper: Scraper
  ) {}
  
  createGraph() {
    // Graph implementation uses only getProfile, saveProfile, getUser
  }
}
```

```typescript
// Another graph might need different methods
type HydeGraphDatabase = Pick<Database, 'getProfile' | 'saveHydeProfile'>;

export class HydeGraphFactory {
  constructor(
    private db: HydeGraphDatabase  // Only requires 2 methods
  ) {}
}
```

#### Controller Adapter Implementation

Controllers implement only the methods required by their graph factories:

```typescript
// Controller adapter - implements what the graph needs
export class DrizzleDatabaseAdapter implements Pick<Database, 'getProfile' | 'saveProfile' | 'getUser'> {
  
  async getProfile(userId: string): Promise<ProfileDocument | null> {
    // Implementation
  }

  async saveProfile(userId: string, profile: ProfileDocument): Promise<void> {
    // Implementation
  }

  async getUser(userId: string): Promise<User | null> {
    // Implementation
  }
  
  // Note: saveHydeProfile is NOT implemented here because this graph doesn't need it
}
```

### Full Interface vs Picked Interface

| Approach | Use Case |
|----------|----------|
| `Database` full interface | Shared utility classes that need all methods |
| `Pick<Database, 'method1' \| 'method2'>` | Graph factories with specific needs |
| Adapter implementing `Pick<...>` | Controllers providing minimal implementation |

### Constructor Injection Pattern

```typescript
export class ProfileController {
  private db: Pick<Database, 'getProfile' | 'saveProfile' | 'getUser'>;
  private embedder: Embedder;
  private scraper: Scraper;
  private factory: ProfileGraphFactory;

  constructor() {
    // Instantiate concrete adapters implementing only required methods
    this.db = new DrizzleDatabaseAdapter();
    this.embedder = new IndexEmbedder();
    this.scraper = new ParallelScraperAdapter();
    
    // Pass dependencies to factory
    this.factory = new ProfileGraphFactory(this.db, this.embedder, this.scraper);
  }
}
```

### Graph Factory Pattern

Factories receive dependencies and create configured graph instances:

```typescript
// In controller method
const graph = this.factory.createGraph();
const result = await graph.invoke({ userId: user.id });
```

---

## Testing Guidelines

Test files follow the pattern: `{feature}.controller.spec.ts`

### Test File Structure

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";

import { config } from "dotenv";
config({ path: '.env.development', override: true });

import { SomeController } from "./some.controller";
import type { AuthenticatedUser } from "../guards/auth.guard";
import db, { closeDb } from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { eq } from 'drizzle-orm';

describe("SomeController Integration", () => {
  let controller: SomeController;
  let testUserId: string;

  beforeAll(async () => {
    // Setup: Create test data
  });

  afterAll(async () => {
    // Cleanup: Remove test data
    await closeDb();
  });

  test("should do something", async () => {
    // Test implementation
  }, 60000); // Timeout for long-running tests
});
```

### Setup and Teardown Pattern

```typescript
beforeAll(async () => {
  // 1. Define unique test identifiers
  const email = "test-controller@example.com";

  // 2. Clean up any existing test data (idempotent setup)
  const existingUser = await db.select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (existingUser.length > 0) {
    await db.delete(schema.users)
      .where(eq(schema.users.email, email));
  }

  // 3. Create fresh test data
  const [user] = await db.insert(schema.users).values({
    email: email,
    name: "Test User",
    privyId: `privy:${Date.now()}`, // Unique ID
    intro: "Test intro",
    location: "Test Location",
    socials: { x: "https://x.com/test" }
  }).returning();

  testUserId = user.id;

  // 4. Initialize controller
  controller = new SomeController();
});

afterAll(async () => {
  // Clean up test data
  if (testUserId) {
    await db.delete(schema.users)
      .where(eq(schema.users.id, testUserId));
  }
  await closeDb();
});
```

### Test Case Pattern

```typescript
test("sync should generate a profile for a new user", async () => {
  // 1. Arrange - Create mock request and user
  const mockRequest = {} as Request;
  const mockUser: AuthenticatedUser = {
    id: testUserId,
    privyId: `privy:${Date.now()}`,
    email: "test@example.com",
    name: "Test User"
  };

  // 2. Act - Execute controller method
  const result = await controller.sync(mockRequest, mockUser);

  // 3. Assert - Verify database state
  const profile = await db.select()
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, testUserId));

  expect(profile.length).toBe(1);
  expect(profile[0].identity?.name).toBeDefined();
  expect(profile[0].embedding).not.toBeNull();
}, 120000); // Extended timeout for LLM/external calls
```

### Testing Idempotency

```typescript
test("sync should be idempotent (second run should just verify)", async () => {
  const mockRequest = {} as Request;
  const mockUser: AuthenticatedUser = {
    id: testUserId,
    privyId: `privy:${Date.now()}`,
    email: "test@example.com",
    name: "Test User"
  };

  const start = Date.now();
  await controller.sync(mockRequest, mockUser);
  const duration = Date.now() - start;

  // Verify state remains consistent
  const profile = await db.select()
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, testUserId));
  
  expect(profile.length).toBe(1);
}, 60000);
```

### Test Timeouts

| Scenario | Recommended Timeout |
|----------|---------------------|
| Simple DB operations | Default (5000ms) |
| Single LLM call | 30000ms |
| Graph with multiple LLM calls | 60000-120000ms |
| External API integration | 60000ms |

---

## Best Practices

### 1. Response Handling

Always return proper `Response` objects:

```typescript
// Good
return Response.json(result);
return Response.json({ success: true, data: result });

// With status codes
return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
```

### 2. Error Handling in Adapters

```typescript
async scrape(objective: string): Promise<string> {
  try {
    const response = await externalService.call(objective);
    return formatResponse(response);
  } catch (error: any) {
    console.error("Adapter error:", error);
    // Return graceful fallback - don't crash the flow
    return `Fallback response: ${error.message}`;
  }
}
```

### 3. Type Safety

```typescript
// Use explicit type imports
import type { AuthenticatedUser } from "../guards/auth.guard";

// Type guard for safe casting
function isProfileDocument(obj: unknown): obj is ProfileDocument {
  return obj !== null && typeof obj === 'object' && 'identity' in obj;
}

// Use type assertions sparingly with comments
return (result[0] as unknown as ProfileDocument) || null;
```

### 4. JSDoc Documentation

```typescript
/**
 * Syncs/Generates a profile for the given user.
 * This is the main entry point to trigger the profile graph.
 * 
 * @param req - The HTTP request object
 * @param user - The authenticated user from AuthGuard
 * @returns JSON response with graph execution result
 */
@Post('/sync')
@UseGuards(AuthGuard)
async sync(req: Request, user: AuthenticatedUser) {
  // Implementation
}
```

### 5. Guard Usage

```typescript
// AuthGuard provides AuthenticatedUser as second parameter
@UseGuards(AuthGuard)
async protectedMethod(req: Request, user: AuthenticatedUser) {
  // user is guaranteed to be authenticated
  const userId = user.id;
}
```

### 6. Graph Integration

```typescript
// Create graph instance per request
const graph = this.factory.createGraph();

// Invoke with initial state
const result = await graph.invoke({ userId: user.id });

// Return result
return Response.json(result);
```

---

## Quick Reference: Creating a New Controller

1. **Create file**: `src/controllers/{feature}.controller.ts`
2. **Define adapters** for each external dependency
3. **Import interfaces** from `src/lib/protocol/interfaces/`
4. **Create controller class** with `@Controller` decorator
5. **Define methods** with route decorators and guards
6. **Initialize factory** in constructor with adapters
7. **Create test file**: `src/controllers/{feature}.controller.spec.ts`
8. **Write integration tests** with proper setup/teardown

### Minimal Controller Template

```typescript
// Protocol imports
import type { Database } from '../lib/protocol/interfaces/database.interface';
import { SomeGraphFactory } from '../lib/protocol/graphs/some/some.graph';

// Adapter imports
import { SomeDatabaseAdapter } from '../adapters/database.adapter';

// Service imports
import { userService } from '../services/user.service';
import { featureService } from '../services/feature.service';

// Routing imports
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';

// Logging
import { log } from '../lib/log';
const logger = log.controller.from('feature');

@Controller('/features')
export class FeatureController {
  private db: Database;
  private factory: SomeGraphFactory;

  constructor() {
    // Initialize adapters for protocol graphs
    this.db = new SomeDatabaseAdapter();
    this.factory = new SomeGraphFactory(this.db);
  }

  /**
   * Simple data retrieval - use service
   */
  @Get('/:id')
  @UseGuards(AuthGuard)
  async get(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const feature = await featureService.getById(params?.id);
    if (!feature) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }
    return Response.json(feature);
  }

  /**
   * Complex processing - use graph via factory
   */
  @Post('/process')
  @UseGuards(AuthGuard)
  async process(req: Request, user: AuthenticatedUser) {
    logger.info('Processing feature', { userId: user.id });
    const graph = this.factory.createGraph();
    const result = await graph.invoke({ userId: user.id });
    return Response.json(result);
  }
}
```
