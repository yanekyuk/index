# Discovery Pipeline Trace & Debug Visibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the chat trace panel show expandable sub-steps for tool calls (especially "Find opportunities"), persist trace/debug metadata in dedicated tables, enhance the bug icon debug copy, and add additional trace data (lens inputs, entity bundles, model identifiers).

**Architecture:** Two new metadata tables (`chat_message_metadata`, `chat_session_metadata`) store debug data separately from working data. The opportunity tool returns a `summary` field for completion text. The chat controller captures `debugMeta` from SSE events and persists it alongside messages. The frontend merges persisted metadata into trace events on page reload. The debug endpoint reads from metadata tables.

**Tech Stack:** Drizzle ORM (schema + migrations), Bun test, React (trace panel components), SSE streaming

---

### Task 1: Add `chat_message_metadata` and `chat_session_metadata` schema

**Files:**
- Modify: `protocol/src/schemas/database.schema.ts`

**Step 1: Add the new table definitions after `chatMessages` (line ~381)**

Add after the `chatMessages` table definition:

```typescript
export const chatMessageMetadata = pgTable('chat_message_metadata', {
  id: text('id').primaryKey(),
  messageId: text('message_id').notNull().references(() => chatMessages.id, { onDelete: 'cascade' }),
  traceEvents: jsonb('trace_events'),
  debugMeta: jsonb('debug_meta'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  messageIdUnique: uniqueIndex('chat_message_metadata_message_id_unique').on(table.messageId),
}));

export const chatSessionMetadata = pgTable('chat_session_metadata', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sessionIdUnique: uniqueIndex('chat_session_metadata_session_id_unique').on(table.sessionId),
}));
```

**Step 2: Add type exports near the existing chat type exports (line ~591)**

```typescript
export type ChatMessageMetadata = typeof chatMessageMetadata.$inferSelect;
export type NewChatMessageMetadata = typeof chatMessageMetadata.$inferInsert;
export type ChatSessionMetadata = typeof chatSessionMetadata.$inferSelect;
export type NewChatSessionMetadata = typeof chatSessionMetadata.$inferInsert;
```

**Step 3: Generate and rename migration**

Run: `cd protocol && bun run db:generate`

Rename the generated migration file:
```bash
mv drizzle/NNNN_*.sql drizzle/NNNN_create_chat_metadata_tables.sql
```

Update `drizzle/meta/_journal.json`: set the `tag` for that entry to match the new filename (without `.sql`).

**Step 4: Apply migration**

Run: `cd protocol && bun run db:migrate`

**Step 5: Verify no pending changes**

Run: `cd protocol && bun run db:generate`
Expected: "No schema changes" (or equivalent)

**Step 6: Commit**

```bash
git add protocol/src/schemas/database.schema.ts protocol/drizzle/
git commit -m "feat(schema): add chat_message_metadata and chat_session_metadata tables"
```

---

### Task 2: Add database adapter methods for metadata CRUD

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts`

**Step 1: Add imports for the new tables**

Add `chatMessageMetadata` and `chatSessionMetadata` to the imports from `../schemas/database.schema`.

**Step 2: Add `createMessageMetadata` method**

```typescript
async createMessageMetadata(params: {
  id: string;
  messageId: string;
  traceEvents?: unknown;
  debugMeta?: unknown;
}): Promise<void> {
  await this.db.insert(chatMessageMetadata).values({
    id: params.id,
    messageId: params.messageId,
    traceEvents: params.traceEvents,
    debugMeta: params.debugMeta,
  });
}
```

**Step 3: Add `getMessageMetadataByMessageIds` method**

```typescript
async getMessageMetadataByMessageIds(messageIds: string[]): Promise<ChatMessageMetadata[]> {
  if (messageIds.length === 0) return [];
  return this.db
    .select()
    .from(chatMessageMetadata)
    .where(inArray(chatMessageMetadata.messageId, messageIds));
}
```

**Step 4: Add `upsertSessionMetadata` method**

```typescript
async upsertSessionMetadata(params: {
  id: string;
  sessionId: string;
  metadata: unknown;
}): Promise<void> {
  await this.db
    .insert(chatSessionMetadata)
    .values({
      id: params.id,
      sessionId: params.sessionId,
      metadata: params.metadata,
    })
    .onConflictDoUpdate({
      target: chatSessionMetadata.sessionId,
      set: {
        metadata: params.metadata,
        updatedAt: new Date(),
      },
    });
}
```

**Step 5: Add `getSessionMetadata` method**

```typescript
async getSessionMetadata(sessionId: string): Promise<ChatSessionMetadata | undefined> {
  const [row] = await this.db
    .select()
    .from(chatSessionMetadata)
    .where(eq(chatSessionMetadata.sessionId, sessionId))
    .limit(1);
  return row;
}
```

**Step 6: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "feat(adapter): add chat metadata CRUD methods"
```

---

### Task 3: Add metadata persistence to chat service

**Files:**
- Modify: `protocol/src/services/chat.service.ts`

**Step 1: Add `saveMessageMetadata` method**

```typescript
async saveMessageMetadata(params: {
  messageId: string;
  traceEvents?: unknown;
  debugMeta?: unknown;
}): Promise<void> {
  const id = generateSnowflakeId();
  await this.db.createMessageMetadata({
    id,
    messageId: params.messageId,
    traceEvents: params.traceEvents,
    debugMeta: params.debugMeta,
  });
}
```

**Step 2: Add `upsertSessionMetadata` method**

```typescript
async upsertSessionMetadata(params: {
  sessionId: string;
  metadata: unknown;
}): Promise<void> {
  const id = generateSnowflakeId();
  await this.db.upsertSessionMetadata({
    id,
    sessionId: params.sessionId,
    metadata: params.metadata,
  });
}
```

**Step 3: Add `getMessageMetadata` method**

```typescript
async getMessageMetadataByMessageIds(messageIds: string[]): Promise<ChatMessageMetadata[]> {
  return this.db.getMessageMetadataByMessageIds(messageIds);
}
```

**Step 4: Add `getSessionMetadata` method**

```typescript
async getSessionMetadata(sessionId: string): Promise<ChatSessionMetadata | undefined> {
  return this.db.getSessionMetadata(sessionId);
}
```

**Step 5: Commit**

```bash
git add protocol/src/services/chat.service.ts
git commit -m "feat(service): add chat metadata persistence methods"
```

---

### Task 4: Capture and persist debugMeta in chat controller

**Files:**
- Modify: `protocol/src/controllers/chat.controller.ts`

**Step 1: Add a variable to capture debugMeta from SSE events**

Near line 247 (where `routingDecision`, `subgraphResults` are declared), add:

```typescript
let debugMeta: Record<string, unknown> | undefined;
```

**Step 2: Capture debug_meta event in the SSE loop**

After the `subgraph_result` handler (line ~278), add:

```typescript
} else if (event.type === "debug_meta") {
  debugMeta = {
    graph: event.graph,
    iterations: event.iterations,
    tools: event.tools,
  };
}
```

**Step 3: Persist metadata after assistant message save**

After line ~307 (where assistant message is saved via `addMessage`), the `addMessage` call returns a message ID. Capture it and persist metadata:

First, capture the message ID from `addMessage`:

```typescript
const assistantMessageId = await chatSessionService.addMessage({
  sessionId,
  role: "assistant",
  content: fullResponse,
  routingDecision,
  subgraphResults,
});
```

Then persist metadata:

```typescript
if (assistantMessageId && debugMeta) {
  await chatSessionService.saveMessageMetadata({
    messageId: assistantMessageId,
    debugMeta,
  });

  // Upsert session metadata with accumulated debug info
  await chatSessionService.upsertSessionMetadata({
    sessionId,
    metadata: {
      lastUpdated: new Date().toISOString(),
      turns: [
        ...(/* existing turns if any — see Step 4 */[]),
        {
          messageId: assistantMessageId,
          graph: debugMeta.graph,
          iterations: debugMeta.iterations,
          toolCount: Array.isArray(debugMeta.tools) ? debugMeta.tools.length : 0,
        },
      ],
    },
  });
}
```

**Step 4: Build session metadata accumulation**

Read existing session metadata before upserting so turns accumulate:

```typescript
const existingSessionMeta = await chatSessionService.getSessionMetadata(sessionId);
const existingTurns = Array.isArray((existingSessionMeta?.metadata as Record<string, unknown>)?.turns)
  ? (existingSessionMeta.metadata as { turns: unknown[] }).turns
  : [];
```

Use `existingTurns` in the upsert above.

**Step 5: Commit**

```bash
git add protocol/src/controllers/chat.controller.ts
git commit -m "feat(controller): capture and persist debug metadata per chat turn"
```

---

### Task 5: Add `summary` field to opportunity tool results

**Files:**
- Modify: `protocol/src/lib/protocol/tools/opportunity.tools.ts`

**Step 1: Add `summary` to each `success()` return in the `create_opportunities` tool**

Find each `return success({...})` call and add a `summary` field:

- **No results / suggest intent** (line ~537): `summary: "No matches found"`
- **No results** (line ~548): `summary: "No matches found"`
- **Existing connections only** (line ~560): `summary: "No new matches (existing connections only)"`
- **Found opportunities** (line ~628): `summary: "Found " + displayedBlocks.length + " match(es)"`
- **Continuation path** (line ~293): `summary: "Found " + displayedBlocks.length + " more match(es)"`
- **No more results on continuation** (line ~243): `summary: "No more matches found"`

**Step 2: Verify summary flows through**

The `chat.agent.ts` (line 672) already reads `payload.summary ?? parsed.summary ?? "Done"`, so these new `summary` fields will be picked up automatically. No changes needed in chat.agent.ts or chat.streamer.ts.

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/tools/opportunity.tools.ts
git commit -m "feat(tools): add summary field to opportunity tool results"
```

---

### Task 6: Add additional trace data to opportunity graph

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts`
- Modify: `protocol/src/lib/protocol/agents/model.config.ts`

**Step 1: Add model identifiers to trace entries**

In `model.config.ts`, export a helper to get the model name for an agent:

```typescript
export function getModelName(agent: keyof typeof MODEL_CONFIG): string {
  return MODEL_CONFIG[agent].model;
}
```

**Step 2: Add lens inferrer input trace entry**

In the opportunity graph's discovery node, before calling the lens inferrer, add a trace entry:

```typescript
trace.push({
  node: "lens_input",
  detail: "Profile context for lens inference",
  data: {
    profileContext: discovererProfileContext,
    model: getModelName("lensInferrer"),
  },
});
```

Find the exact location by searching for where `lensInferrer` is invoked in the discovery node.

**Step 3: Add evaluator entity bundle trace entries**

In the evaluation node, when building candidate bundles for the evaluator, add the full bundle to the candidate trace entry's `data`:

Extend existing `"candidate"` trace entries to include:

```typescript
data: {
  ...existingData,
  intents: candidateIntents,  // All active intents sent to evaluator
  profile: candidateProfile,   // Profile data sent to evaluator
  model: getModelName("opportunityEvaluator"),
}
```

**Step 4: Add model identifiers to discovery trace entries**

Add `model` field to existing discovery and evaluation summary trace entries:

```typescript
// In discovery summary trace
data: {
  ...existingData,
  model: getModelName("hydeGenerator"),  // or lensInferrer as appropriate
}

// In evaluation summary trace
data: {
  ...existingData,
  model: getModelName("opportunityEvaluator"),
}
```

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/graphs/opportunity.graph.ts protocol/src/lib/protocol/agents/model.config.ts
git commit -m "feat(graph): add lens inputs, entity bundles, and model identifiers to opportunity trace"
```

---

### Task 7: Update debug endpoint to read from metadata tables

**Files:**
- Modify: `protocol/src/controllers/debug.controller.ts`

**Step 1: Update the `/debug/chat/:id` endpoint**

Replace the current approach of reading `subgraphResults.debugMeta` from messages with reading from `chat_message_metadata` and `chat_session_metadata` tables.

After fetching messages (line ~571), fetch metadata:

```typescript
// Fetch message metadata for all assistant messages
const assistantMessageIds = messageRows
  .filter((m) => m.role === "assistant")
  .map((m) => m.id);

const messageMetadataRows = await db
  .select()
  .from(chatMessageMetadata)
  .where(inArray(chatMessageMetadata.messageId, assistantMessageIds));

const metadataByMessageId = new Map(
  messageMetadataRows.map((m) => [m.messageId, m])
);

// Fetch session metadata
const [sessionMeta] = await db
  .select()
  .from(chatSessionMetadata)
  .where(eq(chatSessionMetadata.sessionId, sessionId))
  .limit(1);
```

**Step 2: Build enhanced turns array**

Replace the current turns-building loop to use metadata:

```typescript
for (const msg of messageRows) {
  const messageIndex = messages.length;
  messages.push({ role: msg.role, content: msg.content });

  if (msg.role === "assistant") {
    const meta = metadataByMessageId.get(msg.id);
    const debugMeta = meta?.debugMeta as {
      graph?: string;
      iterations?: number;
      tools?: Array<{
        name: string;
        args?: Record<string, unknown>;
        resultSummary?: string;
        success?: boolean;
        steps?: Array<{ step: string; detail?: string; data?: Record<string, unknown> }>;
      }>;
    } | undefined;

    // Fall back to subgraphResults for older messages without metadata
    const fallbackMeta = !debugMeta
      ? (msg.subgraphResults as Record<string, unknown> | null)?.debugMeta as typeof debugMeta
      : undefined;
    const source = debugMeta ?? fallbackMeta;

    turns.push({
      messageIndex,
      graph: source?.graph ?? null,
      iterations: typeof source?.iterations === "number" ? source.iterations : null,
      tools: Array.isArray(source?.tools)
        ? source.tools.map((t) => ({
            name: t.name ?? "unknown",
            args: t.args ?? {},
            resultSummary: t.resultSummary ?? "",
            success: t.success ?? true,
            steps: t.steps ?? [],  // Now includes full sub-steps
          }))
        : [],
    });
  }
}
```

**Step 3: Include session metadata in response**

Add session metadata to the response:

```typescript
return Response.json({
  sessionId: session.id,
  exportedAt: new Date().toISOString(),
  title: session.title ?? null,
  indexId: session.indexId ?? null,
  messages,
  turns,
  sessionMetadata: sessionMeta?.metadata ?? null,
});
```

**Step 4: Commit**

```bash
git add protocol/src/controllers/debug.controller.ts
git commit -m "feat(debug): read chat debug data from metadata tables with fallback"
```

---

### Task 8: Add metadata to session loading endpoint for frontend

**Files:**
- Modify: `protocol/src/services/chat.service.ts` (or the controller that handles `/chat/session`)
- Modify: `protocol/src/controllers/chat.controller.ts`

**Step 1: Find the session loading endpoint**

Find the endpoint that handles `POST /chat/session` (loading a session with messages for the frontend).

**Step 2: Include message metadata in the response**

After loading messages, also load `chat_message_metadata` for assistant messages and include `traceEvents` and `debugMeta` in each message's response:

```typescript
const assistantIds = messages
  .filter((m) => m.role === "assistant")
  .map((m) => m.id);
const metadataRows = await chatSessionService.getMessageMetadataByMessageIds(assistantIds);
const metaMap = new Map(metadataRows.map((m) => [m.messageId, m]));

// Attach metadata to messages in response
const messagesWithMeta = messages.map((m) => {
  if (m.role !== "assistant") return { role: m.role, content: m.content, id: m.id, createdAt: m.createdAt };
  const meta = metaMap.get(m.id);
  return {
    role: m.role,
    content: m.content,
    id: m.id,
    createdAt: m.createdAt,
    traceEvents: meta?.traceEvents ?? null,
    debugMeta: meta?.debugMeta ?? null,
  };
});
```

**Step 3: Commit**

```bash
git add protocol/src/controllers/chat.controller.ts protocol/src/services/chat.service.ts
git commit -m "feat(api): include message metadata in session loading response"
```

---

### Task 9: Frontend — reconstruct trace events on page reload

**Files:**
- Modify: `frontend/src/contexts/AIChatContext.tsx`

**Step 1: Update `loadSession` to use metadata from response**

In the `loadSession` function (around line 420-452), when mapping messages from the API response, check for `traceEvents` and `debugMeta` on each assistant message:

```typescript
const loadedMessages: ChatMessage[] = data.messages.map((m: ApiMessage) => ({
  id: m.id,
  role: m.role,
  content: m.content,
  timestamp: new Date(m.createdAt),
  // Reconstruct trace events from persisted metadata
  traceEvents: m.traceEvents ?? undefined,
}));
```

**Step 2: Commit**

```bash
git add frontend/src/contexts/AIChatContext.tsx
git commit -m "feat(frontend): reconstruct trace events from persisted metadata on page reload"
```

---

### Task 10: Frontend — persist trace events before session ends

**Files:**
- Modify: `frontend/src/contexts/AIChatContext.tsx`

**Step 1: Send trace events to the backend for persistence**

The trace events are collected in the frontend during streaming. However, the backend already has `debugMeta` from the SSE pipeline. The only thing the backend doesn't have is the full `traceEvents` array (which includes iteration_start, llm_start, llm_end timing events).

After the stream completes (in the `done` event handler), send the accumulated trace events to the backend:

```typescript
case "done": {
  // ... existing done handling ...

  // Persist trace events for this message
  const currentMsg = prev.find((m) => m.id === assistantMessageId);
  if (currentMsg?.traceEvents?.length) {
    apiClient.post(`/chat/message/${assistantMessageId}/metadata`, {
      traceEvents: currentMsg.traceEvents,
    }).catch(() => {
      // Non-critical — trace persistence failure shouldn't break the chat
    });
  }
  break;
}
```

**Step 2: Add the endpoint in the chat controller**

Add a `POST /chat/message/:id/metadata` endpoint that updates the `chat_message_metadata` row's `traceEvents` field:

```typescript
@Post('/message/:id/metadata')
@UseGuards(AuthGuard)
async updateMessageMetadata(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
  const messageId = params?.id;
  if (!messageId) return Response.json({ error: 'Message ID required' }, { status: 400 });

  const body = await _req.json();
  await chatSessionService.saveMessageMetadata({
    messageId,
    traceEvents: body.traceEvents,
  });

  return Response.json({ success: true });
}
```

Note: The `saveMessageMetadata` method should handle upsert (if a row already exists from the controller's debugMeta persistence, update the traceEvents field).

**Step 3: Update `saveMessageMetadata` to support upsert**

In `chat.service.ts`, update the method to upsert:

```typescript
async saveMessageMetadata(params: {
  messageId: string;
  traceEvents?: unknown;
  debugMeta?: unknown;
}): Promise<void> {
  const id = generateSnowflakeId();
  await this.db.upsertMessageMetadata({
    id,
    messageId: params.messageId,
    traceEvents: params.traceEvents,
    debugMeta: params.debugMeta,
  });
}
```

And in the database adapter, change `createMessageMetadata` to `upsertMessageMetadata` with `onConflictDoUpdate`.

**Step 4: Commit**

```bash
git add frontend/src/contexts/AIChatContext.tsx protocol/src/controllers/chat.controller.ts protocol/src/services/chat.service.ts protocol/src/adapters/database.adapter.ts
git commit -m "feat: persist frontend trace events via metadata endpoint"
```

---

### Task 11: Run tests and verify

**Step 1: Run existing tests to check for regressions**

```bash
cd protocol && bun test tests/e2e.test.ts
```

**Step 2: Run TypeScript type checking**

```bash
cd protocol && bunx tsc --noEmit
cd frontend && bunx tsc --noEmit
```

**Step 3: Verify migration is clean**

```bash
cd protocol && bun run db:generate
```
Expected: No schema changes.

**Step 4: Manual smoke test**

1. Start dev servers: `bun run dev`
2. Open chat, trigger "find opportunities"
3. Verify trace panel shows expandable sub-steps under the tool call
4. Verify completion summary shows "Found N matches" instead of "Done"
5. Reload the page — verify trace panel still shows the sub-steps
6. Click bug icon — verify debug JSON includes full metadata with steps, model identifiers

**Step 5: Commit any fixes**

---

### Task 12: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add the new tables to the Database Layer section**

Under **Core Tables**, add:
- `chat_message_metadata` — Per-message debug metadata (trace events, debug_meta payload)
- `chat_session_metadata` — Per-session aggregated debug metadata

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add chat metadata tables to CLAUDE.md"
```
