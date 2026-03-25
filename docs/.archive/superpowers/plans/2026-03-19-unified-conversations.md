# Unified Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace XMTP messaging and extend the existing chat system into a single A2A-compatible conversation model with tasks and artifacts.

**Architecture:** Six new tables (`conversations`, `conversation_participants`, `messages`, `tasks`, `artifacts`, `conversation_metadata`) replace the existing chat tables and XMTP infrastructure. All XMTP code (~15 files) is deleted. The message format follows the A2A protocol (field-presence Parts, role: user|agent). Existing agent chat is migrated via SQL data migration. Real-time delivery uses SSE + Redis pub/sub.

**Tech Stack:** Drizzle ORM, PostgreSQL, BullMQ/Redis, Bun, Express, React 19, React Router v7

**Spec:** `docs/superpowers/specs/2026-03-19-unified-conversations-design.md`

---

## File Structure

### New Files (Protocol)

| File | Responsibility |
|------|---------------|
| `protocol/src/schemas/conversation.schema.ts` | New table definitions: conversations, conversation_participants, messages, tasks, artifacts, conversation_metadata + enums + relations + types |
| `protocol/src/services/conversation.service.ts` | Conversation lifecycle, messages, DM dedup, hide/unhide |
| `protocol/src/services/task.service.ts` | Task state machine, artifact CRUD |
| `protocol/src/controllers/conversation.controller.ts` | REST API for conversations, messages, tasks, SSE stream |

### New Files (Frontend)

| File | Responsibility |
|------|---------------|
| `frontend/src/services/conversation.ts` | Typed API client for conversation + task endpoints |
| `frontend/src/contexts/ConversationContext.tsx` | Unified context: DM state + agent chat sessions + SSE streaming |

### Modified Files (Protocol)

| File | Changes |
|------|---------|
| `protocol/src/schemas/database.schema.ts` | Remove wallet columns from users, remove chatSessions/chatMessages/chatMessageMetadata/chatSessionMetadata/hiddenConversations tables, remove chatMessageRoleEnum. Import and re-export from conversation.schema.ts |
| `protocol/src/adapters/database.adapter.ts` | Remove `MessagingDatabaseAdapter` class (~90 lines). Add `ConversationDatabaseAdapter` class. Refactor `ChatDatabaseAdapter` to use new tables. |
| `protocol/src/services/chat.service.ts` | Refactor to use ConversationService + TaskService for persistence instead of ChatDatabaseAdapter directly |
| `protocol/src/controllers/chat.controller.ts` | Refactor session creation/listing to use ConversationService |
| `protocol/src/main.ts` | Remove XMTP initialization (lines 17-19, 99-119, 133). Remove `ensureWallet` from auth config. Add ConversationController. |
| `protocol/src/lib/betterauth/betterauth.ts` | Remove `ensureWallet` from AuthDeps interface and usage |
| `protocol/src/cli/db-flush.ts` | Update table references to new tables |
| `protocol/package.json` | Remove `@xmtp/node-sdk`, remove XMTP CLI scripts |

### Modified Files (Frontend)

| File | Changes |
|------|---------|
| `frontend/src/components/ChatSidebar.tsx` | Replace `useXMTP()` with `useConversation()` |
| `frontend/src/components/chat/ChatView.tsx` | Replace `useXMTP()`, `XmtpChatContext`, `xmtpSend`, `loadMessages`, `getChatContext`, `deleteConversation` with ConversationContext equivalents |
| `frontend/src/components/Sidebar.tsx` | Replace `useXMTP()` (isConnected, totalUnreadCount) with ConversationContext |
| `frontend/src/components/ClientWrapper.tsx` | Replace `XMTPProvider` with `ConversationProvider` |

### Deleted Files

| File | Reason |
|------|--------|
| `protocol/src/lib/xmtp/xmtp.interface.ts` | XMTP removed |
| `protocol/src/lib/xmtp/xmtp.crypto.ts` | XMTP removed |
| `protocol/src/lib/xmtp/xmtp.client.ts` | XMTP removed |
| `protocol/src/lib/xmtp/tests/xmtp.crypto.spec.ts` | XMTP removed |
| `protocol/src/lib/xmtp/tests/xmtp.client.spec.ts` | XMTP removed |
| `protocol/src/adapters/messaging.adapter.ts` | XMTP removed |
| `protocol/src/services/messaging.service.ts` | Replaced by conversation.service.ts |
| `protocol/src/controllers/messaging.controller.ts` | Replaced by conversation.controller.ts |
| `protocol/src/cli/xmtp-sync-all.ts` | XMTP removed |
| `protocol/src/cli/xmtp-server-sync.ts` | XMTP removed |
| `protocol/src/cli/xmtp-diagnose.ts` | XMTP removed |
| `frontend/src/services/xmtp.ts` | Replaced by conversation.ts |
| `frontend/src/contexts/XMTPContext.tsx` | Replaced by ConversationContext.tsx |

---

## Task 1: Schema — New Tables & Enums

**Files:**
- Create: `protocol/src/schemas/conversation.schema.ts`
- Modify: `protocol/src/schemas/database.schema.ts`
- Test: `protocol/tests/conversation-schema.spec.ts`

- [ ] **Step 1: Write schema test**

```typescript
// protocol/tests/conversation-schema.spec.ts
import { loadEnvFile } from 'node:process';
loadEnvFile('.env.test');

import { describe, it, expect } from 'bun:test';
import {
  conversations, conversationParticipants, messages, tasks, artifacts, conversationMetadata,
  participantTypeEnum, messageRoleEnum, taskStateEnum,
} from '../src/schemas/conversation.schema';

describe('conversation schema', () => {
  it('exports all tables', () => {
    expect(conversations).toBeDefined();
    expect(conversationParticipants).toBeDefined();
    expect(messages).toBeDefined();
    expect(tasks).toBeDefined();
    expect(artifacts).toBeDefined();
    expect(conversationMetadata).toBeDefined();
  });

  it('exports all enums', () => {
    expect(participantTypeEnum.enumValues).toEqual(['user', 'agent']);
    expect(messageRoleEnum.enumValues).toEqual(['user', 'agent']);
    expect(taskStateEnum.enumValues).toEqual([
      'submitted', 'working', 'input_required', 'completed', 'failed', 'canceled', 'rejected', 'auth_required',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd protocol && bun test tests/conversation-schema.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create conversation.schema.ts**

Create `protocol/src/schemas/conversation.schema.ts` with all six tables, three enums, relations, and exported types as defined in the spec:

- `participantTypeEnum`: `['user', 'agent']`
- `messageRoleEnum`: `['user', 'agent']`
- `taskStateEnum`: `['submitted', 'working', 'input_required', 'completed', 'failed', 'canceled', 'rejected', 'auth_required']`
- `conversations`: id, lastMessageAt, createdAt, updatedAt
- `conversationParticipants`: conversationId (FK), participantId, participantType, joinedAt, hiddenAt. Composite PK. Index on participantId.
- `messages`: id, conversationId (FK), taskId (FK nullable), senderId, role, parts (jsonb), metadata (jsonb nullable), extensions (jsonb nullable), referenceTaskIds (jsonb nullable), createdAt. Indexes: `(conversationId, createdAt DESC)`, `(senderId)`, `(taskId)`.
- `tasks`: id, conversationId (FK), state, statusMessage (jsonb nullable), statusTimestamp (nullable), metadata (jsonb nullable), extensions (jsonb nullable), createdAt, updatedAt. Indexes: `(conversationId)`, `(state)`.
- `artifacts`: id, taskId (FK), name (nullable), description (nullable), parts (jsonb), metadata (jsonb nullable), extensions (jsonb nullable), createdAt. Index: `(taskId)`.
- `conversationMetadata`: conversationId (PK, FK), metadata (jsonb), createdAt, updatedAt.
- All relations defined.
- Export types: `Conversation`, `NewConversation`, `ConversationParticipant`, `Message`, `NewMessage`, `Task`, `NewTask`, `Artifact`, `NewArtifact`, `ConversationMetadata`.

Reference the spec's schema section for exact column definitions. Reference `database.schema.ts` lines 1-4 for import patterns and lines 357-402 for Drizzle table definition style.

- [ ] **Step 4: Update database.schema.ts**

In `protocol/src/schemas/database.schema.ts`:
- Add `import * as conversationSchema from './conversation.schema';` at top
- Add `export * from './conversation.schema';` after existing exports
- Do NOT remove old tables yet (they are needed for migration). Mark them with a `@deprecated` comment.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd protocol && bun test tests/conversation-schema.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add protocol/src/schemas/conversation.schema.ts protocol/src/schemas/database.schema.ts protocol/tests/conversation-schema.spec.ts
git commit -m "feat: add A2A-compatible conversation schema tables and enums"
```

---

## Task 2: Migration — Create Tables & Migrate Data

**Files:**
- Modify: `protocol/drizzle/` (generated migration)
- Modify: `protocol/drizzle/meta/_journal.json`

- [ ] **Step 1: Generate migration**

Run: `cd protocol && bun run db:generate`

This generates a migration SQL file for the new tables and enums.

- [ ] **Step 2: Rename migration file**

Rename the generated file to a descriptive name following the convention:

```bash
# Check the generated filename
ls -la protocol/drizzle/*.sql | tail -1
# Rename (adjust NNNN to actual sequence number)
mv protocol/drizzle/NNNN_random_name.sql protocol/drizzle/NNNN_create_conversations_tables.sql
```

- [ ] **Step 3: Update journal tag**

Edit `protocol/drizzle/meta/_journal.json`: set the `tag` for the new entry to match the renamed filename (without `.sql`).

- [ ] **Step 4: Review generated SQL**

Read the generated migration SQL. Verify it creates:
- Three enums: `participant_type`, `message_role`, `task_state`
- Six tables: `conversations`, `conversation_participants`, `messages`, `tasks`, `artifacts`, `conversation_metadata`
- All indexes and foreign keys as specified

- [ ] **Step 5: Apply migration**

Run: `cd protocol && bun run db:migrate`

- [ ] **Step 6: Verify no pending changes**

Run: `cd protocol && bun run db:generate`
Expected: "No schema changes" (or similar — no new migration file generated)

- [ ] **Step 7: Commit**

```bash
git add protocol/drizzle/
git commit -m "feat: add migration for A2A conversation tables"
```

---

## Task 3: Database Adapter — ConversationDatabaseAdapter

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts`
- Test: `protocol/tests/conversation-adapter.spec.ts`

- [ ] **Step 1: Write adapter test**

```typescript
// protocol/tests/conversation-adapter.spec.ts
import { loadEnvFile } from 'node:process';
loadEnvFile('.env.test');

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { ConversationDatabaseAdapter } from '../src/adapters/database.adapter';

describe('ConversationDatabaseAdapter', () => {
  const adapter = new ConversationDatabaseAdapter();
  let conversationId: string;

  describe('createConversation', () => {
    it('creates a conversation with participants', async () => {
      const result = await adapter.createConversation([
        { participantId: 'user-1', participantType: 'user' },
        { participantId: 'system-agent', participantType: 'agent' },
      ]);
      expect(result.id).toBeDefined();
      conversationId = result.id;
    }, 10000);
  });

  describe('getConversation', () => {
    it('returns conversation with participants', async () => {
      const result = await adapter.getConversation(conversationId);
      expect(result).not.toBeNull();
      expect(result!.participants).toHaveLength(2);
    }, 10000);
  });

  describe('createMessage', () => {
    it('creates a message with A2A parts', async () => {
      const msg = await adapter.createMessage({
        conversationId,
        senderId: 'user-1',
        role: 'user',
        parts: [{ text: 'hello' }],
      });
      expect(msg.id).toBeDefined();
      expect(msg.parts).toEqual([{ text: 'hello' }]);
    }, 10000);
  });

  describe('getMessages', () => {
    it('returns messages in order', async () => {
      const msgs = await adapter.getMessages(conversationId);
      expect(msgs.length).toBeGreaterThanOrEqual(1);
      expect(msgs[0].parts).toEqual([{ text: 'hello' }]);
    }, 10000);
  });

  describe('getOrCreateDM', () => {
    it('finds existing DM', async () => {
      const dm = await adapter.createConversation([
        { participantId: 'user-a', participantType: 'user' },
        { participantId: 'user-b', participantType: 'user' },
      ]);
      const found = await adapter.getOrCreateDM('user-a', 'user-b');
      expect(found.id).toBe(dm.id);
    }, 10000);

    it('creates DM if none exists', async () => {
      const dm = await adapter.getOrCreateDM('user-x', 'user-y');
      expect(dm.id).toBeDefined();
    }, 10000);
  });

  describe('tasks', () => {
    it('creates and updates task state', async () => {
      const task = await adapter.createTask(conversationId);
      expect(task.state).toBe('submitted');

      const updated = await adapter.updateTaskState(task.id, 'working');
      expect(updated.state).toBe('working');
    }, 10000);
  });

  describe('artifacts', () => {
    it('creates artifact linked to task', async () => {
      const task = await adapter.createTask(conversationId);
      const artifact = await adapter.createArtifact({
        taskId: task.id,
        name: 'test-artifact',
        parts: [{ data: { score: 0.9 }, media_type: 'application/json' }],
      });
      expect(artifact.id).toBeDefined();
      expect(artifact.taskId).toBe(task.id);
    }, 10000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd protocol && bun test tests/conversation-adapter.spec.ts`
Expected: FAIL — ConversationDatabaseAdapter not found

- [ ] **Step 3: Implement ConversationDatabaseAdapter**

Add `ConversationDatabaseAdapter` class to `protocol/src/adapters/database.adapter.ts`. Import the new schema tables from `conversation.schema.ts`. Implement these methods:

```typescript
class ConversationDatabaseAdapter {
  async createConversation(participants: { participantId: string; participantType: 'user' | 'agent' }[]): Promise<Conversation>
  async getConversation(id: string): Promise<(Conversation & { participants: ConversationParticipant[] }) | null>
  async getConversationsForUser(userId: string): Promise<ConversationSummary[]>
  async getOrCreateDM(userA: string, userB: string): Promise<Conversation>

  async createMessage(data: { conversationId: string; senderId: string; role: 'user' | 'agent'; parts: any[]; taskId?: string; metadata?: any; extensions?: string[]; referenceTaskIds?: string[] }): Promise<Message>
  async getMessages(conversationId: string, opts?: { limit?: number; before?: string; taskId?: string }): Promise<Message[]>

  async updateLastMessageAt(conversationId: string): Promise<void>

  async hideConversation(userId: string, conversationId: string): Promise<void>
  async unhideConversation(userId: string, conversationId: string): Promise<void>

  async upsertMetadata(conversationId: string, metadata: Record<string, any>): Promise<void>
  async getMetadata(conversationId: string): Promise<Record<string, any> | null>

  async createTask(conversationId: string, metadata?: Record<string, any>): Promise<Task>
  async updateTaskState(taskId: string, state: string, statusMessage?: any): Promise<Task>
  async getTask(taskId: string): Promise<Task | null>
  async getTasksByConversation(conversationId: string): Promise<Task[]>

  async createArtifact(data: { taskId: string; name?: string; description?: string; parts: any[]; metadata?: any }): Promise<Artifact>
  async getArtifacts(taskId: string): Promise<Artifact[]>
}
```

For `getOrCreateDM`, use the DM dedup query from the spec. For `getConversationsForUser`, join `conversation_participants` → `conversations`, order by `lastMessageAt DESC`, and include the last message via a lateral join or subquery.

Reference `database.adapter.ts` lines 685-850 for existing adapter patterns (Drizzle query style, error handling).

- [ ] **Step 4: Export the adapter instance**

Add at bottom of file: `export const conversationDatabaseAdapter = new ConversationDatabaseAdapter();`

- [ ] **Step 5: Run tests**

Run: `cd protocol && bun test tests/conversation-adapter.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts protocol/tests/conversation-adapter.spec.ts
git commit -m "feat: add ConversationDatabaseAdapter with A2A-compatible operations"
```

---

## Task 4: Services — ConversationService & TaskService

**Files:**
- Create: `protocol/src/services/conversation.service.ts`
- Create: `protocol/src/services/task.service.ts`
- Test: `protocol/tests/conversation-service.spec.ts`

- [ ] **Step 1: Write service test**

```typescript
// protocol/tests/conversation-service.spec.ts
import { loadEnvFile } from 'node:process';
loadEnvFile('.env.test');

import { describe, it, expect } from 'bun:test';
import { ConversationService } from '../src/services/conversation.service';
import { TaskService } from '../src/services/task.service';

describe('ConversationService', () => {
  const service = new ConversationService();

  it('creates conversation and sends message', async () => {
    const conv = await service.createConversation([
      { participantId: 'test-user-1', participantType: 'user' },
      { participantId: 'system-agent', participantType: 'agent' },
    ]);
    expect(conv.id).toBeDefined();

    const msg = await service.sendMessage(conv.id, 'test-user-1', 'user', [{ text: 'test message' }]);
    expect(msg.id).toBeDefined();
    expect(msg.parts).toEqual([{ text: 'test message' }]);
  }, 15000);

  it('getOrCreateDM deduplicates', async () => {
    const dm1 = await service.getOrCreateDM('dm-user-a', 'dm-user-b');
    const dm2 = await service.getOrCreateDM('dm-user-a', 'dm-user-b');
    expect(dm1.id).toBe(dm2.id);
  }, 15000);
});

describe('TaskService', () => {
  const convService = new ConversationService();
  const taskService = new TaskService();

  it('creates task and transitions states', async () => {
    const conv = await convService.createConversation([
      { participantId: 'task-user', participantType: 'user' },
      { participantId: 'system-agent', participantType: 'agent' },
    ]);

    const task = await taskService.createTask(conv.id);
    expect(task.state).toBe('submitted');

    const working = await taskService.updateState(task.id, 'working');
    expect(working.state).toBe('working');

    const completed = await taskService.updateState(task.id, 'completed');
    expect(completed.state).toBe('completed');
  }, 15000);

  it('creates artifacts for a task', async () => {
    const conv = await convService.createConversation([
      { participantId: 'art-user', participantType: 'user' },
      { participantId: 'system-agent', participantType: 'agent' },
    ]);
    const task = await taskService.createTask(conv.id);

    const artifact = await taskService.createArtifact(task.id, {
      name: 'opportunity-card',
      parts: [{ data: { opportunityId: 'opp-1', score: 0.85 }, media_type: 'application/json' }],
    });
    expect(artifact.name).toBe('opportunity-card');

    const artifacts = await taskService.getArtifacts(task.id);
    expect(artifacts).toHaveLength(1);
  }, 15000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd protocol && bun test tests/conversation-service.spec.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement ConversationService**

Create `protocol/src/services/conversation.service.ts`:

```typescript
import { conversationDatabaseAdapter } from '../adapters/database.adapter';

export class ConversationService {
  constructor(private db = conversationDatabaseAdapter) {}

  async createConversation(participants) { ... }
  async getConversation(id) { ... }
  async getConversations(userId) { ... }
  async getOrCreateDM(userA, userB) { ... }
  async sendMessage(conversationId, senderId, role, parts, opts?) { ... }
  async getMessages(conversationId, opts?) { ... }
  async hideConversation(userId, conversationId) { ... }
  async updateMetadata(conversationId, metadata) { ... }
}
```

Key: `sendMessage` must also call `updateLastMessageAt` on the conversation.

Reference `protocol/src/services/service.template.md` for service conventions. Reference `protocol/src/services/chat.service.ts` lines 41-60 for constructor/adapter injection pattern.

- [ ] **Step 4: Implement TaskService**

Create `protocol/src/services/task.service.ts`:

```typescript
import { conversationDatabaseAdapter } from '../adapters/database.adapter';

export class TaskService {
  constructor(private db = conversationDatabaseAdapter) {}

  async createTask(conversationId, metadata?) { ... }
  async updateState(taskId, state, statusMessage?) { ... }
  async getTask(taskId) { ... }
  async getTasksByConversation(conversationId) { ... }
  async createArtifact(taskId, data) { ... }
  async getArtifacts(taskId) { ... }
}
```

- [ ] **Step 5: Run tests**

Run: `cd protocol && bun test tests/conversation-service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add protocol/src/services/conversation.service.ts protocol/src/services/task.service.ts protocol/tests/conversation-service.spec.ts
git commit -m "feat: add ConversationService and TaskService"
```

---

## Task 5: Controller — REST API for Conversations

**Files:**
- Create: `protocol/src/controllers/conversation.controller.ts`
- Test: `protocol/tests/conversation-controller.spec.ts`

- [ ] **Step 1: Write controller test**

Test the key endpoints using the API (integration test against running server or direct controller invocation). At minimum test:

- `GET /api/conversations` — returns user's conversations
- `POST /api/conversations` — creates conversation
- `POST /api/conversations/dm` — get or create DM
- `POST /api/conversations/:id/messages` — send message
- `GET /api/conversations/:id/messages` — get messages

- [ ] **Step 2: Run test to verify it fails**

Run: `cd protocol && bun test tests/conversation-controller.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement ConversationController**

Create `protocol/src/controllers/conversation.controller.ts` with decorator-based routing:

```typescript
@Controller('/conversations')
export class ConversationController {
  constructor(
    private conversationService: ConversationService,
    private taskService: TaskService,
  ) {}

  @Get('/')
  @UseGuards(AuthGuard)
  async listConversations(req, res) { ... }

  @Post('/')
  @UseGuards(AuthGuard)
  async createConversation(req, res) { ... }

  @Get('/:id/messages')
  @UseGuards(AuthGuard)
  async getMessages(req, res) { ... }

  @Post('/:id/messages')
  @UseGuards(AuthGuard)
  async sendMessage(req, res) { ... }

  @Post('/dm')
  @UseGuards(AuthGuard)
  async getOrCreateDM(req, res) { ... }

  @Patch('/:id/metadata')
  @UseGuards(AuthGuard)
  async updateMetadata(req, res) { ... }

  @Delete('/:id')
  @UseGuards(AuthGuard)
  async hideConversation(req, res) { ... }

  @Get('/:id/tasks')
  @UseGuards(AuthGuard)
  async listTasks(req, res) { ... }

  @Get('/:id/tasks/:taskId')
  @UseGuards(AuthGuard)
  async getTask(req, res) { ... }

  @Get('/:id/tasks/:taskId/artifacts')
  @UseGuards(AuthGuard)
  async getArtifacts(req, res) { ... }

  @Get('/stream')
  @UseGuards(AuthGuard)
  async stream(req, res) { ... }
}
```

Reference `protocol/src/controllers/controller.template.md` for conventions. Reference `protocol/src/controllers/messaging.controller.ts` for SSE stream pattern (lines 208-252). Reference `protocol/src/lib/router/router.decorators.ts` for decorator syntax.

- [ ] **Step 4: Register controller in main.ts**

In `protocol/src/main.ts`:
- Add import: `import { ConversationController } from './controllers/conversation.controller';`
- Add to controllerInstances map: `controllerInstances.set(ConversationController, new ConversationController(new ConversationService(), new TaskService()));`

- [ ] **Step 5: Run tests**

Run: `cd protocol && bun test tests/conversation-controller.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add protocol/src/controllers/conversation.controller.ts protocol/tests/conversation-controller.spec.ts protocol/src/main.ts
git commit -m "feat: add ConversationController with REST API and SSE stream"
```

---

## Task 6: Delete XMTP — Backend

**Files:**
- Delete: 12 files (see list below)
- Modify: `protocol/src/main.ts`
- Modify: `protocol/src/lib/betterauth/betterauth.ts`
- Modify: `protocol/src/adapters/database.adapter.ts`
- Modify: `protocol/src/startup.env.ts`
- Modify: `protocol/package.json`

- [ ] **Step 1: Delete XMTP library files**

```bash
rm -rf protocol/src/lib/xmtp/
```

- [ ] **Step 2: Delete XMTP adapter, service, controller**

```bash
rm protocol/src/adapters/messaging.adapter.ts
rm protocol/src/services/messaging.service.ts
rm protocol/src/controllers/messaging.controller.ts
```

- [ ] **Step 3: Delete XMTP CLI scripts**

```bash
rm protocol/src/cli/xmtp-sync-all.ts
rm protocol/src/cli/xmtp-server-sync.ts
rm protocol/src/cli/xmtp-diagnose.ts
```

- [ ] **Step 4: Clean up main.ts**

In `protocol/src/main.ts`:
- Remove imports: `MessagingController` (line 17), `MessagingDatabaseAdapter` (line 18), `MessagingService` (line 19), `path` (line 20 — check if used elsewhere)
- Remove wallet master key block (lines 99-104)
- Remove `messagingStore` creation (line 106)
- Remove `ensureWallet` from auth config (line 113) — change to just:
  ```typescript
  const auth = createAuth({ authDb, getTrustedOrigins, sendMagicLinkEmail });
  ```
- Remove `messagingService` creation (lines 115-119)
- Remove `MessagingController` from controllerInstances (line 133)

- [ ] **Step 5: Clean up betterauth.ts**

In `protocol/src/lib/betterauth/betterauth.ts`:
- Remove `ensureWallet` from `AuthDeps` interface (line 26)
- Remove `ensureWallet` from destructuring (line 38)
- Remove the wallet call in user.create.after hook (lines 58-60)

- [ ] **Step 6: Remove MessagingDatabaseAdapter from database.adapter.ts**

In `protocol/src/adapters/database.adapter.ts`:
- Remove the `MessagingDatabaseAdapter` class (around lines 4421-4503)
- Remove `MessagingStore` import from `'../lib/xmtp'`
- Remove any `messaging.adapter` related imports

- [ ] **Step 7: Clean up startup.env.ts**

In `protocol/src/startup.env.ts`:
- Remove `WALLET_ENCRYPTION_KEY: requiredUnlessTest` (line 59)
- Remove `XMTP_ENV: z.enum(['dev', 'production']).default('dev')` (line 60)
- Remove the `// 5. Messaging (XMTP)` section comment (line 58)

Without this, the server will refuse to start without env vars that serve no purpose.

- [ ] **Step 8: Clean up package.json**

In `protocol/package.json`:
- Remove `"@xmtp/node-sdk"` from dependencies
- Remove `"maintenance:xmtp-sync-all"`, `"maintenance:xmtp-server-sync"`, `"maintenance:xmtp-diagnose"` from scripts

- [ ] **Step 9: Run bun install to update lockfile**

Run: `cd protocol && bun install`

- [ ] **Step 10: Verify build**

Run: `cd protocol && bun run lint`
Expected: No errors related to missing XMTP imports. Fix any remaining import references.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: remove all XMTP code (lib, adapter, service, controller, CLI)"
```

---

## Task 7: Delete XMTP — Frontend

**Files:**
- Delete: `frontend/src/services/xmtp.ts`, `frontend/src/contexts/XMTPContext.tsx`
- Modify: `frontend/src/components/ClientWrapper.tsx`
- Modify: `frontend/src/components/chat/ChatView.tsx` (imports useXMTP, XmtpChatContext, xmtpSend, loadMessages, getChatContext, deleteConversation)
- Modify: `frontend/src/components/Sidebar.tsx` (imports useXMTP for isConnected, totalUnreadCount)
- Modify: `frontend/src/components/ChatSidebar.tsx` (imports useXMTP)

- [ ] **Step 1: Delete XMTP frontend files**

```bash
rm frontend/src/services/xmtp.ts
rm frontend/src/contexts/XMTPContext.tsx
```

- [ ] **Step 2: Remove XMTPProvider from ClientWrapper**

In `frontend/src/components/ClientWrapper.tsx`:
- Remove `XMTPProvider` import
- Remove `<XMTPProvider>` from the provider tree

- [ ] **Step 3: Stub out XMTP hooks in ChatView.tsx, Sidebar.tsx, ChatSidebar.tsx**

These files have significant XMTP integration that needs refactoring (not just import removal):

In `frontend/src/components/chat/ChatView.tsx`:
- Remove `useXMTP()` import and usage (`xmtpSend`, `loadMessages`, `getChatContext`, `deleteConversation`)
- Comment out or stub the DM messaging functionality (will be re-implemented in Task 8 with ConversationContext)

In `frontend/src/components/Sidebar.tsx`:
- Remove `useXMTP()` import and usage (`isConnected`, `totalUnreadCount`)
- Replace with hardcoded defaults temporarily (`isConnected: false`, `totalUnreadCount: 0`)

In `frontend/src/components/ChatSidebar.tsx`:
- Remove `useXMTP()` import and usage
- Stub with empty conversations array (will be re-implemented in Task 8)

- [ ] **Step 4: Verify no remaining XMTP references**

Run: `cd frontend && grep -r "xmtp\|useXMTP\|XMTPProvider\|XMTPContext\|XmtpChatContext" src/ --include="*.tsx" --include="*.ts" -l`

Expected: No results.

- [ ] **Step 5: Verify frontend builds**

Run: `cd frontend && bun run build`
Expected: Build succeeds (with conversation features temporarily stubbed)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove XMTP frontend (context, service, provider)"
```

---

## Task 8: Frontend — ConversationContext & Service

**Files:**
- Create: `frontend/src/services/conversation.ts`
- Create: `frontend/src/contexts/ConversationContext.tsx`
- Modify: `frontend/src/components/ClientWrapper.tsx`
- Modify: `frontend/src/components/ChatSidebar.tsx`
- Modify: `frontend/src/components/chat/ChatView.tsx` (replace XMTP stubs with ConversationContext)
- Modify: `frontend/src/components/Sidebar.tsx` (replace XMTP stubs with ConversationContext)

- [ ] **Step 1: Create conversation service**

Create `frontend/src/services/conversation.ts` — typed API client for the new endpoints:

```typescript
export interface ConversationSummary {
  id: string;
  participants: { participantId: string; participantType: 'user' | 'agent' }[];
  lastMessage: { parts: any[]; senderId: string; createdAt: string } | null;
  metadata: { title?: string } | null;
  lastMessageAt: string | null;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  senderId: string;
  role: 'user' | 'agent';
  parts: any[];
  metadata?: Record<string, any>;
  createdAt: string;
}

export const createConversationService = (api: { get: Function; post: Function; patch: Function; delete: Function }) => ({
  getConversations: () => api.get('/conversations'),
  getMessages: (conversationId: string, opts?: { limit?: number; before?: string }) =>
    api.get(`/conversations/${conversationId}/messages`, { params: opts }),
  sendMessage: (conversationId: string, parts: any[]) =>
    api.post(`/conversations/${conversationId}/messages`, { parts }),
  getOrCreateDM: (peerUserId: string) =>
    api.post('/conversations/dm', { peerUserId }),
  hideConversation: (conversationId: string) =>
    api.delete(`/conversations/${conversationId}`),
  updateMetadata: (conversationId: string, metadata: Record<string, any>) =>
    api.patch(`/conversations/${conversationId}/metadata`, { metadata }),
});
```

Reference `frontend/src/services/xmtp.ts` (now deleted) for the factory pattern — match the same style.

- [ ] **Step 2: Create ConversationContext**

Create `frontend/src/contexts/ConversationContext.tsx`:

- State: `conversations`, `messages` (Map), `isConnected`
- SSE stream to `/api/conversations/stream` for real-time messages
- Methods: `loadMessages`, `sendMessage`, `refreshConversations`, `hideConversation`, `getOrCreateDM`
- Optimistic updates on send

Reference the deleted `XMTPContext.tsx` patterns — SSE connection with keepalive, auto-reconnect on error (5s backoff), event parsing.

- [ ] **Step 3: Wire up ConversationProvider in ClientWrapper**

In `frontend/src/components/ClientWrapper.tsx`:
- Import `ConversationProvider`
- Add `<ConversationProvider>` to the provider tree (where `XMTPProvider` was)

- [ ] **Step 4: Update ChatSidebar**

In `frontend/src/components/ChatSidebar.tsx`:
- Replace stubs with `useConversation()` from the new context
- Update data access to match new types (e.g., `conversation.lastMessage.parts[0].text` instead of `lastMessage.content`)

- [ ] **Step 5: Update ChatView.tsx**

In `frontend/src/components/chat/ChatView.tsx`:
- Replace XMTP stubs with `useConversation()` equivalents
- `xmtpSend` → `sendMessage` from ConversationContext
- `loadMessages` → `loadMessages` from ConversationContext
- `getChatContext` → `getOrCreateDM` from ConversationContext
- `deleteConversation` → `hideConversation` from ConversationContext

- [ ] **Step 6: Update Sidebar.tsx**

In `frontend/src/components/Sidebar.tsx`:
- Replace hardcoded stubs with `useConversation()` context values
- `isConnected` from ConversationContext
- `totalUnreadCount` — keep as 0 for now (unread tracking is out of scope)

- [ ] **Step 7: Verify frontend builds and DM sidebar renders**

Run: `cd frontend && bun run build`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add frontend/src/services/conversation.ts frontend/src/contexts/ConversationContext.tsx frontend/src/components/ClientWrapper.tsx frontend/src/components/ChatSidebar.tsx frontend/src/components/chat/ChatView.tsx frontend/src/components/Sidebar.tsx
git commit -m "feat: add ConversationContext and service for unified messaging"
```

---

## Task 9: Refactor Agent Chat — Use New Tables

**Files:**
- Modify: `protocol/src/services/chat.service.ts`
- Modify: `protocol/src/controllers/chat.controller.ts`
- Modify: `protocol/src/controllers/debug.controller.ts` (references chatSessions, chatMessages, chatMessageMetadata, chatSessionMetadata directly)
- Modify: `protocol/src/adapters/database.adapter.ts` (ChatDatabaseAdapter methods)
- Test: `protocol/tests/chat-refactor-regression.spec.ts`

This is the most delicate task. The agent chat system (LangGraph) currently writes to `chat_sessions`/`chat_messages`. We need to redirect it to the new `conversations`/`messages` tables while keeping LangGraph's checkpointer (which uses its own tables) untouched.

- [ ] **Step 1: Refactor ChatDatabaseAdapter**

In `protocol/src/adapters/database.adapter.ts`, update `ChatDatabaseAdapter` methods (lines 685-850) to use the new tables:

- `createSession` → create a `conversation` + `conversation_participants` (user + system-agent) + `conversation_metadata`
- `getSession` → query `conversations` joined with `conversation_metadata`
- `getUserSessions` → query via `conversation_participants` where participantId = userId, joined with conversations, ordered by `lastMessageAt`
- `createMessage` → insert into `messages` with `parts: [{ text: content }]`, `role` mapped (assistant→agent), `metadata` for routingDecision/subgraphResults/tokenCount
- `getSessionMessages` → query `messages` by conversationId
- `updateSessionTitle` → upsert `conversation_metadata`
- `setShareToken` → upsert into `conversation_metadata.metadata.shareToken`
- `getSessionByShareToken` → query `conversation_metadata` where `metadata->>'shareToken' = ?`
- Metadata methods → use `messages.metadata` instead of separate `chat_message_metadata` table

Keep the method signatures backward-compatible so `chat.service.ts` and `chat.controller.ts` changes are minimal.

- [ ] **Step 2: Write regression test**

Create `protocol/tests/chat-refactor-regression.spec.ts`:

```typescript
import { loadEnvFile } from 'node:process';
loadEnvFile('.env.test');

import { describe, it, expect } from 'bun:test';
import { ChatDatabaseAdapter } from '../src/adapters/database.adapter';

describe('ChatDatabaseAdapter (post-refactor)', () => {
  const adapter = new ChatDatabaseAdapter();

  it('creates session and stores in conversations table', async () => {
    const sessionId = crypto.randomUUID();
    await adapter.createSession({ id: sessionId, userId: 'regression-user', title: 'Test' });
    const session = await adapter.getSession(sessionId);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(sessionId);
  }, 10000);

  it('creates message with A2A parts format', async () => {
    const sessionId = crypto.randomUUID();
    await adapter.createSession({ id: sessionId, userId: 'regression-user' });
    await adapter.createMessage({
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content: 'test message',
    });
    const msgs = await adapter.getSessionMessages(sessionId);
    expect(msgs.length).toBe(1);
  }, 10000);

  it('share token round-trips via metadata', async () => {
    const sessionId = crypto.randomUUID();
    await adapter.createSession({ id: sessionId, userId: 'regression-user' });
    await adapter.setShareToken(sessionId, 'test-token-123');
    const found = await adapter.getSessionByShareToken('test-token-123');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(sessionId);
  }, 10000);

  it('message metadata stored in messages.metadata', async () => {
    const sessionId = crypto.randomUUID();
    const msgId = crypto.randomUUID();
    await adapter.createSession({ id: sessionId, userId: 'regression-user' });
    await adapter.createMessage({ id: msgId, sessionId, role: 'assistant', content: 'response' });
    await adapter.upsertMessageMetadata({ id: crypto.randomUUID(), messageId: msgId, traceEvents: [{ type: 'test' }] });
    // Verify metadata is retrievable
    const meta = await adapter.getMessageMetadata(msgId);
    expect(meta).not.toBeNull();
  }, 10000);
});
```

- [ ] **Step 3: Run regression test to verify it fails**

Run: `cd protocol && bun test tests/chat-refactor-regression.spec.ts`
Expected: FAIL (adapter still uses old tables, or methods not updated yet)

- [ ] **Step 4: Update ChatSessionService**

In `protocol/src/services/chat.service.ts`:
- Update any direct references to old schema types
- The service should work with minimal changes if ChatDatabaseAdapter signatures are preserved

- [ ] **Step 5: Update ChatController**

In `protocol/src/controllers/chat.controller.ts`:
- Minimal changes if the service interface is preserved
- Verify session listing, creation, and message endpoints work

- [ ] **Step 6: Update DebugController**

In `protocol/src/controllers/debug.controller.ts`:
- Replace imports of `chatSessions`, `chatMessages`, `chatMessageMetadata`, `chatSessionMetadata` with new conversation schema tables
- Update all queries to use `conversations`, `messages`, `conversationMetadata` etc.
- This controller directly queries schema tables (not through adapters), so every table reference must be updated

- [ ] **Step 7: Run regression tests**

Run: `cd protocol && bun test tests/chat-refactor-regression.spec.ts`
Expected: PASS

- [ ] **Step 8: Manual smoke test**

Start the dev server: `cd protocol && bun run dev`
Verify agent chat works: create a session, send a message, get a response.

- [ ] **Step 9: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts protocol/src/services/chat.service.ts protocol/src/controllers/chat.controller.ts protocol/src/controllers/debug.controller.ts protocol/tests/chat-refactor-regression.spec.ts
git commit -m "refactor: redirect agent chat to unified conversations tables"
```

---

## Task 10: Data Migration — Move Existing Chat History

**Files:**
- Create: `protocol/src/cli/migrate-chat-to-conversations.ts`

- [ ] **Step 1: Write migration script**

Create `protocol/src/cli/migrate-chat-to-conversations.ts`:

```typescript
/**
 * Migrates existing chat_sessions/chat_messages data to new conversations tables.
 * Run once after Task 9 is deployed.
 *
 * Mapping:
 * - chat_sessions → conversations + conversation_participants + conversation_metadata
 * - chat_messages → messages (content → parts, role mapped, metadata merged)
 * - chat_message_metadata → messages.metadata
 * - chat_session_metadata → tasks.metadata (one task per session)
 */
```

Key migration logic:
1. For each `chat_session`:
   - Insert into `conversations` (preserve ID)
   - Insert two `conversation_participants`: the userId (type: user) + "system-agent" (type: agent)
   - Insert `conversation_metadata` with title, shareToken, indexId from the session
   - Create one `task` (state: completed) per session if `chat_session_metadata` exists
2. For each `chat_message`:
   - Insert into `messages`:
     - `conversationId` = sessionId
     - `parts` = `[{ "text": content }]`
     - `role` = user→user, assistant→agent, system→agent
     - `metadata` = merge routingDecision, subgraphResults, tokenCount
   - If `chat_message_metadata` exists for this message, merge traceEvents and debugMeta into `messages.metadata`
   - Link to the session's task via `taskId`
3. Update `conversations.lastMessageAt` from the latest message per conversation
4. Log counts: sessions migrated, messages migrated, tasks created

- [ ] **Step 2: Add script to package.json**

Add to `protocol/package.json` scripts:
```json
"maintenance:migrate-chat": "bun run src/cli/migrate-chat-to-conversations.ts"
```

- [ ] **Step 3: Test migration on dev database**

Run: `cd protocol && bun run maintenance:migrate-chat`
Expected: Logs showing migrated counts. Verify in `bun run db:studio` that conversations and messages tables have data.

- [ ] **Step 4: Verify migrated data**

Spot-check in Drizzle Studio:
- Conversations have correct participants
- Messages have proper A2A parts format
- Metadata is merged correctly
- Tasks exist for sessions with debug metadata

- [ ] **Step 5: Commit**

```bash
git add protocol/src/cli/migrate-chat-to-conversations.ts protocol/package.json
git commit -m "feat: add data migration script for chat to conversations"
```

---

## Task 11: Schema Cleanup — Drop Old Tables

**Files:**
- Modify: `protocol/src/schemas/database.schema.ts`
- Generate: new migration

This task runs AFTER migration is verified.

- [ ] **Step 1: Remove old table definitions from schema**

In `protocol/src/schemas/database.schema.ts`:
- Remove `chatMessageRoleEnum` (line 355)
- Remove `chatSessions` table (lines 357-369)
- Remove `chatMessages` table (lines 371-382)
- Remove `chatMessageMetadata` table (lines 384-392)
- Remove `chatSessionMetadata` table (lines 394-402)
- Remove `hiddenConversations` table (lines 568-574)
- Remove all their relations (lines 527-562)
- Remove wallet columns from `users` table: `walletAddress` (line 94), `walletEncryptedKey` (line 95), `xmtpInboxId` (line 96), and the `// XMTP wallet` comment (line 93)
- Remove exported types: `ChatSession`, `NewChatSession`, `ChatMessage`, `NewChatMessage` (lines 596-599)
- Update `OpportunityContext.conversationId` type from `Id<'chatSessions'>` to `Id<'conversations'>` (line 235)

- [ ] **Step 2: Update OpportunityContext cross-references**

The `OpportunityContext` interface in `database.schema.ts` (line 235) has `conversationId?: Id<'chatSessions'>`. Update to `Id<'conversations'>`. Then update all files that construct or read this field:

- `protocol/src/schemas/database.schema.ts` — type definition
- `protocol/src/adapters/database.adapter.ts` — opportunity queries referencing conversationId
- `protocol/src/lib/protocol/interfaces/database.interface.ts` — interface definition

Run: `cd protocol && grep -r "OpportunityContext\|Id<'chatSessions'>" src/ --include="*.ts" -l`

Update each file. The conversationId field itself stays — only the type reference changes.

- [ ] **Step 3: Fix remaining imports**

Search for any remaining imports of the removed tables/types and update them:

Run: `cd protocol && grep -r "chatSessions\|chatMessages\|chatMessageMetadata\|chatSessionMetadata\|hiddenConversations\|ChatSession\|ChatMessage\|NewChatSession\|NewChatMessage\|chatMessageRoleEnum" src/ --include="*.ts" -l`

Update each file to use the new conversation schema types.

- [ ] **Step 4: Generate migration**

Run: `cd protocol && bun run db:generate`

- [ ] **Step 5: Rename migration**

Rename to `NNNN_drop_old_chat_and_xmtp_tables.sql` and update journal.

- [ ] **Step 6: Review migration SQL**

Verify it drops: `chat_sessions`, `chat_messages`, `chat_message_metadata`, `chat_session_metadata`, `hidden_conversations`, `chat_message_role` enum, and wallet columns from users.

- [ ] **Step 7: Apply migration**

Run: `cd protocol && bun run db:migrate`

- [ ] **Step 8: Update db-flush.ts**

In `protocol/src/cli/db-flush.ts`: check for references to old table names. If present, replace with new ones (`conversations`, `messages`, `tasks`, `artifacts`, `conversationMetadata`, `conversationParticipants`). If not present (file may use a different pattern), skip this step.

- [ ] **Step 9: Verify**

Run: `cd protocol && bun run db:generate`
Expected: No pending changes

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: drop old chat/XMTP tables and wallet columns from users"
```

---

## Task 12: Frontend — Refactor AIChatContext

**Files:**
- Modify: `frontend/src/contexts/AIChatContext.tsx`
- Modify: `frontend/src/contexts/AIChatSessionsContext.tsx`

- [ ] **Step 1: Update AIChatContext**

In `frontend/src/contexts/AIChatContext.tsx`:
- Update any types referencing the old schema (`ChatSession`, `ChatMessage`)
- Verify the context works with the refactored chat controller (which now returns data shaped by the new tables)
- The `ChatMessage` interface in this context (role, content) maps to the API response; update if the response format changed

- [ ] **Step 2: Update AIChatSessionsContext**

If `AIChatSessionsContext` queries the session list endpoint, verify it's compatible with the refactored chat controller response.

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && bun run build`
Expected: PASS

- [ ] **Step 4: Manual smoke test**

Start both servers. Verify:
- Agent chat: create session, send message, receive response
- DM sidebar: conversations listed
- DM: send and receive messages

- [ ] **Step 5: Commit**

```bash
git add frontend/src/contexts/AIChatContext.tsx frontend/src/contexts/AIChatSessionsContext.tsx
git commit -m "refactor: update frontend chat contexts for unified conversations schema"
```

---

## Task 13: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update schema documentation**

Update the Database Layer section in CLAUDE.md:
- Replace chat tables with new conversation tables
- Document the A2A alignment
- Update the Core Tables list
- Remove XMTP/wallet references from users table
- Add `conversations`, `conversation_participants`, `messages`, `tasks`, `artifacts`, `conversation_metadata` to the table list

- [ ] **Step 2: Update controller/service documentation**

- Remove `MessagingController` and XMTP references
- Add `ConversationController` with its routes
- Add `ConversationService` and `TaskService`
- Update the Key Controllers and Routes table

- [ ] **Step 3: Update environment variables**

- Remove `WALLET_ENCRYPTION_KEY` and `XMTP_ENV` from required/optional vars

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for unified conversations architecture"
```
