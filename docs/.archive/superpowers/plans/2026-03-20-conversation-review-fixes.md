# Conversation Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Fix all issues from code review of PR #542 — security (authorization), architecture (layering violations), performance (query optimization), schema (missing index, race condition), type safety, and tests.

**Architecture:** Add participant verification in `ConversationService`, move Redis pub/sub from adapter+controller into the service, optimize `getConversationsForUser` with `DISTINCT ON`, add unique constraint for DM deduplication, fix `any` types, fix frontend stale closure.

**Tech Stack:** Drizzle ORM, PostgreSQL, Redis (ioredis), Bun test

---

### Task 1: Add `conversationId` Index to Schema

**Files:**
- Modify: `protocol/src/schemas/conversation.schema.ts:59-62`

**Step 1: Add the missing index**

In `conversation.schema.ts`, the `conversationParticipants` table definition (line 59-62) currently has only `participantIdIdx`. Add `conversationIdIdx`:

```typescript
(table) => ({
  pk: primaryKey({ columns: [table.conversationId, table.participantId] }),
  participantIdIdx: index('conversation_participants_participant_id_idx').on(table.participantId),
  conversationIdIdx: index('conversation_participants_conversation_id_idx').on(table.conversationId),
}),
```

**Step 2: Generate and rename migration**

```bash
cd protocol
bun run db:generate
```

Rename the generated file to `0022_add_conversation_participants_conversation_id_idx.sql`. Update `drizzle/meta/_journal.json` tag to match.

**Step 3: Apply migration**

```bash
bun run db:migrate
```

**Step 4: Verify no schema diff remains**

```bash
bun run db:generate
```

Expected: "No schema changes" or "Nothing to migrate"

**Step 5: Commit**

```bash
git add protocol/src/schemas/conversation.schema.ts protocol/drizzle/
git commit -m "feat(schema): add conversationId index on conversation_participants"
```

---

### Task 2: Add Participant Verification to ConversationService

**Files:**
- Modify: `protocol/src/services/conversation.service.ts`
- Modify: `protocol/src/adapters/database.adapter.ts` (add `isParticipant` method to `ConversationDatabaseAdapter`)
- Test: `protocol/tests/conversation-service.spec.ts`

**Step 1: Write failing tests**

Add to `protocol/tests/conversation-service.spec.ts`:

```typescript
describe('authorization', () => {
  it('should reject getMessages for non-participant', async () => {
    const conv = await service.createConversation([
      { participantId: userA, participantType: 'user' },
    ]);
    createdIds.push(conv.id);

    await expect(
      service.getMessages(conv.id, { userId: 'non-participant-user' })
    ).rejects.toThrow(/not a participant/i);
  });

  it('should reject sendMessage for non-participant', async () => {
    const conv = await service.createConversation([
      { participantId: userA, participantType: 'user' },
    ]);
    createdIds.push(conv.id);

    await expect(
      service.sendMessage(conv.id, 'non-participant-user', 'user', [{ type: 'text', text: 'hello' }])
    ).rejects.toThrow(/not a participant/i);
  });

  it('should allow getMessages for valid participant', async () => {
    const conv = await service.createConversation([
      { participantId: userA, participantType: 'user' },
    ]);
    createdIds.push(conv.id);

    const messages = await service.getMessages(conv.id, { userId: userA });
    expect(messages).toEqual([]);
  });
});
```

Use existing test user IDs (`userA`, `userB`) from the test setup.

**Step 2: Run tests to verify they fail**

```bash
cd protocol && bun test tests/conversation-service.spec.ts
```

Expected: FAIL — no authorization checks exist yet.

**Step 3: Add `isParticipant` to `ConversationDatabaseAdapter`**

Add a new method to `ConversationDatabaseAdapter` in `database.adapter.ts`:

```typescript
/**
 * Checks whether a user is a participant in a conversation.
 * @param conversationId - Conversation ID
 * @param userId - User ID to check
 * @returns True if the user is a participant
 */
async isParticipant(conversationId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ participantId: schema.conversationParticipants.participantId })
    .from(schema.conversationParticipants)
    .where(
      and(
        eq(schema.conversationParticipants.conversationId, conversationId),
        eq(schema.conversationParticipants.participantId, userId),
      ),
    )
    .limit(1);
  return !!row;
}
```

**Step 4: Add `verifyParticipant` and integrate into ConversationService**

In `conversation.service.ts`, add a private verification method and call it from each method that operates on a specific conversation:

```typescript
/**
 * Verifies a user is a participant in a conversation.
 * @param userId - User ID to verify
 * @param conversationId - Conversation ID
 * @throws Error if the user is not a participant
 */
private async verifyParticipant(userId: string, conversationId: string): Promise<void> {
  const ok = await this.db.isParticipant(conversationId, userId);
  if (!ok) throw new Error('Forbidden: not a participant in this conversation');
}
```

Add `userId` parameter and `verifyParticipant` call to these methods:

- `getMessages(conversationId, opts)` — call `this.verifyParticipant(opts.userId, conversationId)` (userId is already passed in opts)
- `sendMessage(conversationId, senderId, ...)` — call `this.verifyParticipant(senderId, conversationId)`
- `hideConversation(userId, conversationId)` — call `this.verifyParticipant(userId, conversationId)`
- `updateMetadata(conversationId, metadata, userId)` — add `userId` param, call `this.verifyParticipant(userId, conversationId)`

For task-related methods that go through `TaskService`, add `userId` and `conversationId` verification there (Task 3).

**Step 5: Run tests**

```bash
cd protocol && bun test tests/conversation-service.spec.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add protocol/src/services/conversation.service.ts protocol/src/adapters/database.adapter.ts protocol/tests/conversation-service.spec.ts
git commit -m "feat: add participant verification to ConversationService"
```

---

### Task 3: Add Task Ownership Verification to TaskService

**Files:**
- Modify: `protocol/src/services/task.service.ts`
- Test: `protocol/tests/conversation-service.spec.ts` (task tests are here)

**Step 1: Write failing tests**

```typescript
describe('task authorization', () => {
  it('should reject getTask when task does not belong to conversation', async () => {
    const conv1 = await service.createConversation([
      { participantId: userA, participantType: 'user' },
    ]);
    createdIds.push(conv1.id);
    const task = await taskService.createTask(conv1.id);

    await expect(
      taskService.getTask(task.id, 'wrong-conversation-id')
    ).rejects.toThrow(/does not belong/i);
  });

  it('should return task when it belongs to conversation', async () => {
    const conv = await service.createConversation([
      { participantId: userA, participantType: 'user' },
    ]);
    createdIds.push(conv.id);
    const task = await taskService.createTask(conv.id);

    const fetched = await taskService.getTask(task.id, conv.id);
    expect(fetched?.id).toBe(task.id);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd protocol && bun test tests/conversation-service.spec.ts
```

**Step 3: Add `conversationId` verification to TaskService**

Modify `getTask` and `getArtifacts` in `task.service.ts`:

```typescript
async getTask(taskId: string, conversationId: string) {
  const task = await this.db.getTask(taskId);
  if (task && task.conversationId !== conversationId) {
    throw new Error('Forbidden: task does not belong to this conversation');
  }
  return task;
}

async getArtifacts(taskId: string, conversationId: string) {
  const task = await this.db.getTask(taskId);
  if (!task || task.conversationId !== conversationId) {
    throw new Error('Forbidden: task does not belong to this conversation');
  }
  return this.db.getArtifacts(taskId);
}
```

**Step 4: Run tests**

```bash
cd protocol && bun test tests/conversation-service.spec.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add protocol/src/services/task.service.ts protocol/tests/conversation-service.spec.ts
git commit -m "feat: add conversation ownership verification to TaskService"
```

---

### Task 4: Add Controller-Level Validation for createConversation

**Files:**
- Modify: `protocol/src/controllers/conversation.controller.ts:52-72`

**Step 1: Add caller-in-participants validation**

In the `createConversation` handler (line 52), after validating the participants array, add:

```typescript
const callerIncluded = body.participants.some(
  (p) => p.participantId === user.id && p.participantType === 'user'
);
if (!callerIncluded) {
  return Response.json(
    { error: 'Authenticated user must be included in participants' },
    { status: 400 },
  );
}
```

Insert this between the existing `!Array.isArray` check (line 60) and the `try` block (line 64).

**Step 2: Commit**

```bash
git add protocol/src/controllers/conversation.controller.ts
git commit -m "fix: validate caller is included in createConversation participants"
```

---

### Task 5: Move Pub/Sub from Adapter to Service

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts:5264-5289` (remove pub/sub from `createMessage`)
- Modify: `protocol/src/adapters/database.adapter.ts:14` (remove `getRedisClient` import)
- Modify: `protocol/src/services/conversation.service.ts` (add publish logic)

**Step 1: Remove pub/sub from `createMessage` in database adapter**

In `database.adapter.ts`, remove lines 5264–5289 (the entire "Publish to all participants' SSE channels" block) from the `createMessage` method. Also remove the `getRedisClient` import on line 14.

The `createMessage` method should end after the `hiddenAt` clearing (line 5262), then just `return msg;`.

**Step 2: Add publish logic to `ConversationService.sendMessage`**

In `conversation.service.ts`, import `getRedisClient` and add pub/sub after persistence:

```typescript
import { getRedisClient } from '../adapters/cache.adapter';

// Inside sendMessage, after the db.createMessage call:
async sendMessage(
  conversationId: string,
  senderId: string,
  role: 'user' | 'agent',
  parts: unknown[],
  opts?: { taskId?: string; metadata?: Record<string, unknown> },
) {
  await this.verifyParticipant(senderId, conversationId);

  const msg = await this.db.createMessage({
    conversationId,
    senderId,
    role,
    parts,
    taskId: opts?.taskId,
    metadata: opts?.metadata,
  });

  // Publish to all participants' SSE channels (best-effort)
  try {
    const participants = await this.db.getParticipants(conversationId);
    const event = JSON.stringify({
      type: 'message',
      conversationId,
      message: msg,
    });
    const pubClient = getRedisClient();
    for (const p of participants) {
      if (p.participantId === senderId) continue;
      await pubClient.publish(`conversations:user:${p.participantId}`, event);
    }
  } catch (err) {
    logger.error('[sendMessage] Failed to publish SSE event', {
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return msg;
}
```

Also add a `getParticipants` method to `ConversationDatabaseAdapter` if it doesn't exist:

```typescript
async getParticipants(conversationId: string) {
  return db
    .select({
      participantId: schema.conversationParticipants.participantId,
      participantType: schema.conversationParticipants.participantType,
    })
    .from(schema.conversationParticipants)
    .where(eq(schema.conversationParticipants.conversationId, conversationId));
}
```

**Step 3: Run tests**

```bash
cd protocol && bun test tests/conversation-service.spec.ts && bun test tests/conversation-adapter.spec.ts
```

Expected: PASS

**Step 4: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts protocol/src/services/conversation.service.ts
git commit -m "refactor: move pub/sub publishing from database adapter to ConversationService"
```

---

### Task 6: Move SSE Subscribe from Controller to Service

**Files:**
- Modify: `protocol/src/controllers/conversation.controller.ts:333-380` (simplify `stream` handler)
- Modify: `protocol/src/controllers/conversation.controller.ts:5` (remove `createRedisClient` import)
- Modify: `protocol/src/services/conversation.service.ts` (add `subscribe` method)

**Step 1: Add `subscribe` method to ConversationService**

```typescript
import { createRedisClient, getRedisClient } from '../adapters/cache.adapter';

/**
 * Creates a dedicated Redis subscriber for a user's conversation events.
 * @param userId - User to subscribe for
 * @returns Object with `on` handler registration, `cleanup` teardown function, and `sendConnected` to emit initial event
 */
subscribe(userId: string) {
  const sub = createRedisClient();
  const channel = `conversations:user:${userId}`;
  let cancelled = false;

  return {
    onMessage(handler: (data: string) => void) {
      sub.on('message', (_ch: string, data: string) => {
        if (!cancelled) handler(data);
      });
      sub.subscribe(channel).catch((err) => {
        logger.error('[subscribe] Redis subscribe failed', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    },
    cleanup() {
      cancelled = true;
      sub.unsubscribe(channel).then(() => sub.disconnect()).catch(() => {});
    },
  };
}
```

**Step 2: Simplify the controller `stream` handler**

Remove the `createRedisClient` import from `conversation.controller.ts` line 5. Rewrite the `stream` method to delegate to the service:

```typescript
async stream(_req: Request, user: AuthenticatedUser) {
  const encoder = new TextEncoder();
  const { onMessage, cleanup } = this.conversationService.subscribe(user.id);
  let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

  const readableStream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

      onMessage((data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch { /* stream closed */ }
      });

      keepaliveInterval = setInterval(() => {
        try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch { clearInterval(keepaliveInterval!); }
      }, 15000);
    },
    cancel() {
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      cleanup();
    },
  });

  return new Response(readableStream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
```

Note: also removes `userId` from the connected event (minor M4 fix).

**Step 3: Verify no adapter imports remain in controller**

```bash
grep -n 'adapters' protocol/src/controllers/conversation.controller.ts
```

Expected: no output

**Step 4: Commit**

```bash
git add protocol/src/controllers/conversation.controller.ts protocol/src/services/conversation.service.ts
git commit -m "refactor: move SSE subscription from controller to ConversationService"
```

---

### Task 7: Wire Authorization into Controller Endpoints

**Files:**
- Modify: `protocol/src/controllers/conversation.controller.ts`

**Step 1: Pass `userId` through all controller calls**

Update controller methods to pass `user.id` to service methods that now require it:

- `getMessages` (line 84): already passes `userId` in opts — confirm it's passed through
- `sendMessage` (line 114): pass `user.id` as `senderId` — already done at line 127
- `updateMetadata` (line 184): add `user.id` as third argument: `this.conversationService.updateMetadata(id, body.metadata, user.id)`
- `hideConversation` (line 221): already passes `user.id`
- `listTasks` (line 247): add `user.id` — call `this.conversationService.verifyParticipant(user.id, id)` before `this.taskService.getTasksByConversation(id)` (or expose verify publicly)
- `getTask` (line 273): pass `conversationId` to `this.taskService.getTask(taskId, id)`
- `getArtifacts` (line 303): pass `conversationId` to `this.taskService.getArtifacts(taskId, id)`

For `listTasks`, the simplest approach is to make `verifyParticipant` public on `ConversationService` so the controller can call it directly for task listing (since `TaskService` doesn't have conversation membership logic).

**Step 2: Handle 403 errors in controller**

Add a catch pattern for authorization errors. In each try/catch block, check if the error message contains "Forbidden" and return 403:

```typescript
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith('Forbidden')) {
    return Response.json({ error: message }, { status: 403 });
  }
  logger.error('[methodName] Error', { userId: user.id, error: message });
  return Response.json({ error: message }, { status: 500 });
}
```

Apply this pattern to all endpoint handlers that call verified service methods.

**Step 3: Commit**

```bash
git add protocol/src/controllers/conversation.controller.ts
git commit -m "feat: wire participant authorization into all conversation controller endpoints"
```

---

### Task 8: Optimize `getConversationsForUser` with DISTINCT ON

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts:5127-5147`

**Step 1: Replace fetch-all-messages with DISTINCT ON query**

Replace lines 5127-5147 (the `allMessages` fetch and `lastMessageByConv` loop) with:

```typescript
// Fetch last message per conversation efficiently using DISTINCT ON
const lastMessageByConv = new Map<string, { parts: unknown[]; senderId: string; createdAt: Date }>();
if (ids.length > 0) {
  const lastMessages = await db.execute(sql`
    SELECT DISTINCT ON (conversation_id)
      conversation_id, parts, sender_id, created_at
    FROM messages
    WHERE conversation_id = ANY(${ids})
    ORDER BY conversation_id, created_at DESC
  `);

  const msgRows = Array.isArray(lastMessages) ? lastMessages : (lastMessages as { rows: unknown[] }).rows ?? [];
  for (const row of msgRows) {
    const r = row as { conversation_id: string; parts: unknown[]; sender_id: string; created_at: Date };
    const hiddenAt = hiddenAtByConv.get(r.conversation_id);
    if (hiddenAt && r.created_at <= hiddenAt) continue;
    lastMessageByConv.set(r.conversation_id, {
      parts: r.parts,
      senderId: r.sender_id,
      createdAt: r.created_at,
    });
  }
}
```

**Step 2: Run tests**

```bash
cd protocol && bun test tests/conversation-adapter.spec.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "perf: use DISTINCT ON for last message per conversation instead of fetching all"
```

---

### Task 9: Fix `getOrCreateDM` Race Condition with Unique Constraint

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts:5176-5207`
- Migration: New migration file

**Step 1: Add DM dedup approach**

Add a `dm_pair` column to `conversations` table that stores a normalized pair key (sorted UUIDs joined by `:`) and a unique index on it. This is simpler than a cross-table constraint.

In `conversation.schema.ts`, add to the `conversations` table:

```typescript
dmPair: text('dm_pair'), // normalized "userId1:userId2" (sorted) for DM deduplication
```

Add unique index:

```typescript
(table) => ({
  dmPairIdx: uniqueIndex('conversations_dm_pair_idx').on(table.dmPair),
}),
```

**Step 2: Generate and rename migration**

```bash
cd protocol && bun run db:generate
```

If this is the same session as Task 1, this will be migration 0023. Rename to `0023_add_conversations_dm_pair.sql` and update journal.

```bash
bun run db:migrate
```

**Step 3: Update `getOrCreateDM` to use `dmPair`**

```typescript
async getOrCreateDM(userA: string, userB: string): Promise<Conversation> {
  const dmPair = [userA, userB].sort().join(':');

  // Try to find existing DM by the unique pair key
  const [existing] = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.dmPair, dmPair))
    .limit(1);

  if (existing) return existing;

  // Try to create — unique constraint prevents duplicates
  try {
    return await this.createConversationWithDmPair(
      [
        { participantId: userA, participantType: 'user' as const },
        { participantId: userB, participantType: 'user' as const },
      ],
      dmPair,
    );
  } catch (err: unknown) {
    // Unique constraint violation — concurrent create won
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('unique') || msg.includes('duplicate')) {
      const [conv] = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.dmPair, dmPair))
        .limit(1);
      if (conv) return conv;
    }
    throw err;
  }
}
```

Add `createConversationWithDmPair` as a private helper that mirrors `createConversation` but also sets the `dmPair` field on insert.

**Step 4: Run tests**

```bash
cd protocol && bun test tests/conversation-adapter.spec.ts
```

Expected: PASS — existing `getOrCreateDM` tests should still pass.

**Step 5: Commit**

```bash
git add protocol/src/schemas/conversation.schema.ts protocol/src/adapters/database.adapter.ts protocol/drizzle/
git commit -m "fix: add dmPair unique constraint to prevent duplicate DMs"
```

---

### Task 10: Fix `any` Types in ConversationDatabaseAdapter

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts`

**Step 1: Fix all `any` occurrences**

Replace each `any` with a proper type:

| Line | Current | Replacement |
|------|---------|-------------|
| 5191 | `(existing as any).rows` | `(existing as { rows: { id: string }[] }).rows` |
| 5230 | `parts: any[]` | `parts: unknown[]` |
| 5232 | `metadata?: any` | `metadata?: Record<string, unknown> \| null` |
| 5412 | `metadata: Record<string, any>` | `metadata: Record<string, unknown>` |
| 5427 | `Record<string, any> \| null` | `Record<string, unknown> \| null` |
| 5434 | `as Record<string, any>` | `as Record<string, unknown>` |
| 5447 | `metadata?: Record<string, any>` | `metadata?: Record<string, unknown>` |
| 5467 | `statusMessage?: any` | `statusMessage?: unknown` |
| 5471 | `state as any` | `state as typeof schema.taskStateEnum.enumValues[number]` |
| 5524 | `parts: any[]` | `parts: unknown[]` |
| 5525 | `metadata?: any` | `metadata?: Record<string, unknown> \| null` |

Note: line 5191 may already be replaced by the `dmPair` approach in Task 9. If `getOrCreateDM` no longer uses raw SQL, skip that line.

**Step 2: Run type check**

```bash
cd protocol && bunx tsc --noEmit
```

Expected: no new errors

**Step 3: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "fix: replace any types with proper types in ConversationDatabaseAdapter"
```

---

### Task 11: Fix Test Env Loading and Frontend Stale Closure

**Files:**
- Modify: `protocol/tests/conversation-adapter.spec.ts:1`
- Modify: `frontend/src/contexts/ConversationContext.tsx:135`

**Step 1: Add dotenv loading to adapter spec**

Add at the very top of `conversation-adapter.spec.ts`, before any imports:

```typescript
import { config } from 'dotenv';
config({ path: '.env.development' });
```

Check how other test files in `protocol/tests/` load env and match that pattern exactly.

**Step 2: Fix sendMessage useCallback dependency array**

In `ConversationContext.tsx` line 135, change:

```typescript
}, []);
```

to:

```typescript
}, [user, apiClient]);
```

Both `user` (for `user?.id` on line 79, 98) and `apiClient` (for the POST call on line 106) are referenced inside the callback.

**Step 3: Commit**

```bash
git add protocol/tests/conversation-adapter.spec.ts frontend/src/contexts/ConversationContext.tsx
git commit -m "fix: add env loading to adapter spec and fix sendMessage stale closure"
```

---

### Task 12: Run Full Verification

**Step 1: Run all conversation tests**

```bash
cd protocol
bun test tests/conversation-adapter.spec.ts
bun test tests/conversation-service.spec.ts
bun test tests/conversation-schema.spec.ts
```

Expected: all PASS

**Step 2: Run type check**

```bash
cd protocol && bunx tsc --noEmit
```

Expected: no errors

**Step 3: Run lint**

```bash
cd protocol && bun run lint
```

Expected: no new errors (especially no `@typescript-eslint/no-explicit-any`)

**Step 4: Verify no adapter imports in controllers**

```bash
grep -rn 'from.*adapters' protocol/src/controllers/conversation.controller.ts
```

Expected: no output

**Step 5: Verify no cache import in database adapter**

```bash
grep -n 'cache.adapter' protocol/src/adapters/database.adapter.ts
```

Expected: no output
