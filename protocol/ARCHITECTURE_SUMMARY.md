# Architecture Summary: Controllers, Services, and Adapters

## Overview

This document clarifies the separation of concerns between Controllers, Services, and Adapters in the protocol codebase.

## Layered Architecture

```
┌─────────────────────────────────────┐
│     Controller Layer (HTTP)         │
│  - Request/response handling        │
│  - Input validation                 │
│  - Route decorators                 │
└──────────┬──────────────────┬───────┘
           │                  │
           ↓                  ↓
┌──────────────────┐  ┌─────────────────┐
│  Service Layer   │  │  Adapter Layer  │
│  - Business      │  │  - Protocol     │
│    logic         │  │    interfaces   │
│  - CRUD ops      │  │  - Graph deps   │
└────────┬─────────┘  └────────┬────────┘
         │                     │
         ↓                     ↓
┌──────────────────────────────────────┐
│         Infrastructure               │
│  - Drizzle ORM (database)            │
│  - External APIs (scraper, embedder) │
│  - Redis (cache)                     │
└──────────────────────────────────────┘
```

## Critical Rules

### Controllers MUST NOT:
- ❌ Import `db` from `../lib/drizzle/drizzle`
- ❌ Import Drizzle operators (`eq`, `and`, `desc`, etc.)
- ❌ Import schema directly (`../schemas/database.schema`)
- ❌ Perform direct database queries

### Controllers MUST:
- ✅ Use services for all data operations (CRUD, queries)
- ✅ Use adapters only for passing to protocol graphs/factories
- ✅ Handle HTTP concerns (parsing, validation, responses)
- ✅ Delegate all business logic to services

### Services MUST:
- ✅ Use Drizzle directly for database operations
- ✅ Import `db` from `../lib/drizzle/drizzle`
- ✅ Import tables from `../schemas/database.schema`
- ✅ Handle business logic and data validation
- ✅ Be called by controllers for data needs

### Adapters MUST:
- ✅ Implement protocol interfaces from `src/lib/protocol/interfaces/`
- ✅ Be defined in `src/adapters/` directory
- ✅ Be passed to graph factories by controllers
- ✅ Use Drizzle directly to implement interface methods
- ✅ Be testable with mock implementations

## When to Use What

### Use Services When:
- Controller needs CRUD operations
- Business logic doesn't involve protocol graphs
- File operations, user management, sessions
- Complex queries and data aggregation
- Any data access outside protocol layer

**Example:**
```typescript
// In controller
import { userService } from '../services/user.service';

@Get('/users/:id')
@UseGuards(AuthGuard)
async getUser(req: Request, user: AuthenticatedUser, params?: RouteParams) {
  const userData = await userService.findById(params?.id);
  return Response.json(userData);
}
```

### Use Adapters When:
- Controller needs to invoke a protocol graph/agent
- Passing dependencies to graph factories
- Implementing protocol interfaces for graphs

**Example:**
```typescript
// In controller
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ChatGraphFactory } from '../lib/protocol/graphs/chat/chat.graph';

export class ChatController {
  private db: ChatGraphCompositeDatabase;
  private embedder: Embedder;
  private factory: ChatGraphFactory;

  constructor() {
    this.db = new ChatDatabaseAdapter();
    this.embedder = new EmbedderAdapter();
    this.factory = new ChatGraphFactory(this.db, this.embedder);
  }

  @Post('/message')
  @UseGuards(AuthGuard)
  async message(req: Request, user: AuthenticatedUser) {
    const graph = this.factory.createGraph();
    const result = await graph.invoke({ userId: user.id });
    return Response.json(result);
  }
}
```

## Current Violations

The following controllers currently violate these rules by importing `db` directly:

1. **chat.controller.ts** (line 3)
   - `loadAttachedFileContent` method should be moved to `file.service.ts`

2. **intent.controller.ts** (line 3)
   - User profile fetching should use `userService` or the adapter

3. **upload.controller.ts** (line 20)
   - File operations should be moved to `file.service.ts`

## Migration Path

To fix violations:

1. **Create missing services** (e.g., `file.service.ts`)
2. **Move database operations** from controllers to services
3. **Remove `db` imports** from controllers
4. **Update controller methods** to call services instead

## Benefits

This architecture provides:

- **Clear separation of concerns**: Each layer has a single responsibility
- **Testability**: Services and adapters can be easily mocked
- **Maintainability**: Business logic is centralized in services
- **Protocol isolation**: Graph dependencies are isolated in adapters
- **Type safety**: Protocol interfaces ensure contract compliance

## References

- Controller template: `src/controllers/controller.template.md`
- Service template: `src/services/service.template.md`
- Adapter implementations: `src/adapters/`
