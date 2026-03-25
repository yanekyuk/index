# Unified Conversations: Replace XMTP + Extend Chat

**Date:** 2026-03-19
**Status:** Draft
**Author:** seref + Claude

## Problem

The current messaging system uses XMTP with server-side Ethereum wallets, encrypted key storage, installation limit handling, and SDK-specific error recovery. This is excessive complexity for what amounts to DMs between users. Meanwhile, the existing `chat_sessions`/`chat_messages` tables handle human-to-agent conversations separately, creating two parallel messaging systems.

## Goal

Replace both systems with a single unified conversation model that supports:
- Human-to-agent conversations (existing behavior)
- Human-to-human DMs (replacing XMTP)
- Agent-to-agent conversations (future, A2A protocol native)

The entire data model must align with the [A2A protocol](https://google.github.io/A2A/) so that internal storage IS the protocol — no translation layer needed when agents communicate externally.

## A2A Protocol Mapping

| A2A Concept | Our Table | Relationship |
|-------------|-----------|--------------|
| Context (`context_id`) | `conversations` | A conversation IS an A2A context |
| Message | `messages` | 1:1 mapping, A2A-shaped |
| Part | `messages.parts` jsonb | A2A Part format (field-presence, not type-discriminated) |
| Task | `tasks` | Agent work units with lifecycle states |
| TaskStatus | `tasks.state` + `tasks.statusMessage` | A2A state machine |
| Artifact | `artifacts` | Structured outputs from tasks |
| — | `conversation_participants` | Our extension (A2A has no participant model) |
| — | `conversation_metadata` | Sparse type-specific data (title, shareToken, etc.) |

## Design

### Schema

Six tables total.

#### `conversations`

Maps to A2A `context_id` — the grouping mechanism for related messages, tasks, and artifacts.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | text | PK | UUID. Serves as A2A `context_id` |
| `lastMessageAt` | timestamptz | nullable | Denormalized; updated on each sendMessage for fast sorting |
| `createdAt` | timestamptz | NOT NULL, default now | |
| `updatedAt` | timestamptz | NOT NULL, default now | |

Intentionally minimal. Type-specific data (title, shareToken, indexId, debug summaries) lives in `conversation_metadata`.

#### `conversation_participants`

Our extension — A2A has no participant model. Tracks who is in each conversation.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `conversationId` | text | FK → conversations.id, ON DELETE CASCADE | |
| `participantId` | text | NOT NULL | userId or agentId |
| `participantType` | enum(`user`, `agent`) | NOT NULL | Maps to A2A Role |
| `joinedAt` | timestamptz | NOT NULL, default now | |
| `hiddenAt` | timestamptz | nullable | Soft-hide; messages before this timestamp filtered out |

- Composite PK: `(conversationId, participantId)`
- Index: `conversation_participants_participant_idx` on `(participantId)`

The `hiddenAt` column replaces the `hidden_conversations` table. When a user hides a conversation, `hiddenAt` is set. Messages before `hiddenAt` are filtered from query results. Sending a new message or receiving one clears `hiddenAt` (un-hides).

#### `messages`

Maps 1:1 to A2A `Message`.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | text | PK | UUID. A2A `message_id` |
| `conversationId` | text | FK → conversations.id, ON DELETE CASCADE | A2A `context_id` |
| `taskId` | text | FK → tasks.id, ON DELETE SET NULL, nullable | A2A `task_id` — links message to a task |
| `senderId` | text | NOT NULL | Our extension — A2A only has `role` |
| `role` | enum(`user`, `agent`) | NOT NULL | A2A `role` |
| `parts` | jsonb | NOT NULL | A2A `Part[]` — field-presence format |
| `metadata` | jsonb | nullable | A2A `metadata` — trace events, debug, routing |
| `extensions` | jsonb | nullable | A2A `extensions` — URI array of extensions used |
| `referenceTaskIds` | jsonb | nullable | A2A `reference_task_ids` — cross-task references |
| `createdAt` | timestamptz | NOT NULL, default now | |

- Index: `messages_conversation_created_idx` on `(conversationId, createdAt DESC)` — paginated loading
- Index: `messages_sender_idx` on `(senderId)`
- Index: `messages_task_idx` on `(taskId)` — fetch task history

Note: `senderId` intentionally has no FK constraint. Agent participants are not in the `users` table. The `conversation_participants` table is the authoritative source for valid senders.

#### `tasks`

Maps to A2A `Task`. Represents a unit of agent work within a conversation.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | text | PK | UUID. A2A `task_id` |
| `conversationId` | text | FK → conversations.id, ON DELETE CASCADE | A2A `context_id` |
| `state` | enum (see TaskState) | NOT NULL, default `submitted` | A2A `TaskStatus.state` |
| `statusMessage` | jsonb | nullable | A2A `TaskStatus.message` — a Message object |
| `statusTimestamp` | timestamptz | nullable | A2A `TaskStatus.timestamp` |
| `metadata` | jsonb | nullable | A2A `metadata` — accumulated debug summaries, config |
| `extensions` | jsonb | nullable | A2A `extensions` — URI array |
| `createdAt` | timestamptz | NOT NULL, default now | |
| `updatedAt` | timestamptz | NOT NULL, default now | |

- Index: `tasks_conversation_idx` on `(conversationId)`
- Index: `tasks_state_idx` on `(state)` — filter by active/completed

**TaskState enum** (A2A-aligned):

| Value | A2A Name | Meaning | Terminal? |
|-------|----------|---------|-----------|
| `submitted` | TASK_STATE_SUBMITTED | Acknowledged, queued | No |
| `working` | TASK_STATE_WORKING | Actively processing | No |
| `input_required` | TASK_STATE_INPUT_REQUIRED | Needs user input | Interrupted |
| `completed` | TASK_STATE_COMPLETED | Finished successfully | Yes |
| `failed` | TASK_STATE_FAILED | Finished with error | Yes |
| `canceled` | TASK_STATE_CANCELED | Canceled | Yes |
| `rejected` | TASK_STATE_REJECTED | Agent declined | Yes |
| `auth_required` | TASK_STATE_AUTH_REQUIRED | Needs authentication | Interrupted |

**How existing data maps:**
- `chat_session_metadata.metadata` (accumulated turn summaries, debug) → `tasks.metadata`
- Each agent chat "turn" (user message → agent response cycle) becomes a Task
- The chat session itself is the conversation (context); each invocation of the agent graph is a Task within it

#### `artifacts`

Maps to A2A `Artifact`. Structured outputs produced by tasks.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | text | PK | UUID. A2A `artifact_id` |
| `taskId` | text | FK → tasks.id, ON DELETE CASCADE | Task that produced this |
| `name` | text | nullable | A2A `name` — human-readable |
| `description` | text | nullable | A2A `description` |
| `parts` | jsonb | NOT NULL | A2A `Part[]` — same format as message parts |
| `metadata` | jsonb | nullable | A2A `metadata` |
| `extensions` | jsonb | nullable | A2A `extensions` — URI array |
| `createdAt` | timestamptz | NOT NULL, default now | |

- Index: `artifacts_task_idx` on `(taskId)`

**What becomes an Artifact:**
- Opportunity cards (DataPart with opportunity details)
- Generated profiles / HyDE documents
- Intent analysis results
- Any structured output the agent produces that isn't conversational

#### `conversation_metadata`

Our extension — sparse type-specific data that varies by conversation type.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `conversationId` | text | PK, FK → conversations.id, ON DELETE CASCADE | 1:1 with conversations |
| `metadata` | jsonb | NOT NULL | title, shareToken, indexId |
| `createdAt` | timestamptz | NOT NULL, default now | |
| `updatedAt` | timestamptz | NOT NULL, default now | |

### A2A Part Format

Parts use A2A's **field-presence** format (not type-discriminated). Each part has exactly one content field (`text`, `url`, `raw`, or `data`) plus optional metadata fields.

```jsonc
// Text content
{ "text": "hello" }

// File by URL
{ "url": "https://storage.example.com/report.pdf", "media_type": "application/pdf", "filename": "report.pdf" }

// Inline binary (base64)
{ "raw": "iVBORw0KGgo...", "media_type": "image/png", "filename": "chart.png" }

// Structured data
{ "data": { "opportunityId": "abc", "score": 0.87 }, "media_type": "application/json" }

// Any part can carry metadata
{ "text": "analysis complete", "metadata": { "confidence": 0.95 } }
```

**Validation rule:** Exactly one of `text`, `url`, `raw`, `data` must be present per part.

### Existing Metadata Table Mapping

| Old Table | New Location | What Moves |
|-----------|-------------|------------|
| `chat_message_metadata.traceEvents` | `messages.metadata.traceEvents` | Per-message trace events |
| `chat_message_metadata.debugMeta` | `messages.metadata.debugMeta` | Per-message debug payload |
| `chat_session_metadata.metadata` | `tasks.metadata` | Accumulated turn summaries, debug aggregates |

The separate metadata tables (`chat_message_metadata`, `chat_session_metadata`) are eliminated. Their data merges into the `metadata` jsonb columns on `messages` and `tasks` respectively — both of which are A2A's native `metadata` field.

### Agent Participant Identity

For human-to-agent conversations, the agent participant uses a well-known identifier:
- `participantId`: `"system-agent"` (constant string)
- `participantType`: `"agent"`

This is used for both the `conversation_participants` row and as the `senderId` on agent messages. If multiple distinct agents are introduced later, each gets its own identifier (e.g., `"opportunity-agent"`, `"intent-agent"`).

### Conversation Type Inference

There is no `type` column. Conversation type is inferred from participants:
- All participants are `user` type → human-to-human
- Mix of `user` and `agent` → human-to-agent
- All participants are `agent` type → agent-to-agent

### DM Deduplication Query

`getOrCreateDM(userA, userB)` must find an existing DM between exactly two users:

```sql
SELECT cp1."conversationId"
FROM conversation_participants cp1
JOIN conversation_participants cp2 ON cp1."conversationId" = cp2."conversationId"
WHERE cp1."participantId" = :userA
  AND cp2."participantId" = :userB
  AND cp1."participantType" = 'user'
  AND cp2."participantType" = 'user'
  AND (SELECT count(*) FROM conversation_participants cp3
       WHERE cp3."conversationId" = cp1."conversationId") = 2
LIMIT 1
```

### Role Mapping (Migration)

The existing `chatMessageRoleEnum` has values `['user', 'assistant', 'system']`. The new `role` enum is `['user', 'agent']`. Migration mapping:

| Old role | New role | Rationale |
|----------|----------|-----------|
| `user` | `user` | Direct mapping |
| `assistant` | `agent` | Agent responses |
| `system` | `agent` | System prompts are agent-generated; stored with `metadata: { "isSystem": true }` for UI differentiation if needed |

### Task Lifecycle in Agent Chat

When a user sends a message in an agent chat:

```
1. User sends Message (role: "user", parts: [{ "text": "find me opportunities" }])
2. System creates Task (state: "submitted", conversationId: <context>)
3. Message.taskId set to new Task.id
4. Agent graph starts → Task state: "working"
5. Agent emits trace events → stored in response Message.metadata
6. Agent produces results → Artifact created (e.g., opportunity card DataPart)
7. Agent sends response Message (role: "agent", taskId: <task>, parts: [...])
8. Task state: "completed", accumulated debug → Task.metadata
```

For DMs (human-to-human), no Tasks are created — just Messages.

## Deletion Plan

### XMTP Backend (protocol)

| File/Location | Action |
|---------------|--------|
| `src/lib/xmtp/xmtp.interface.ts` | Delete |
| `src/lib/xmtp/xmtp.crypto.ts` | Delete |
| `src/lib/xmtp/xmtp.client.ts` | Delete |
| `src/lib/xmtp/tests/xmtp.crypto.spec.ts` | Delete |
| `src/lib/xmtp/tests/xmtp.client.spec.ts` | Delete |
| `src/adapters/messaging.adapter.ts` | Delete |
| `src/adapters/database.adapter.ts` → `MessagingDatabaseAdapter` class | Remove class (~90 lines) |
| `src/services/messaging.service.ts` | Delete (replaced by conversation.service.ts) |
| `src/controllers/messaging.controller.ts` | Delete (replaced by conversation.controller.ts) |
| `src/cli/xmtp-sync-all.ts` | Delete |
| `src/cli/xmtp-server-sync.ts` | Delete |
| `src/cli/xmtp-diagnose.ts` | Delete |
| `src/main.ts` | Remove XMTP initialization (~20 lines), remove `ensureWallet` from auth config |
| `src/adapters/auth.adapter.ts` (or `betterauth.ts`) | Remove `ensureWallet` callback from Better Auth setup |
| `package.json` | Remove `@xmtp/node-sdk`, XMTP CLI scripts |
| `src/cli/db-flush.ts` | Update to flush new tables instead of `chatSessions`/`chatMessages` |

### XMTP Frontend (committed files only)

| File | Action |
|------|--------|
| `src/services/xmtp.ts` | Delete (replaced by conversation service) |
| `src/contexts/XMTPContext.tsx` | Delete (replaced by ConversationContext) |
| `src/components/ChatSidebar.tsx` | Refactor to use new conversation service |

Note: files from the unmerged `feat/xmtp-client` branch (`XMTPClientContext.tsx`, `useXmtpKeyManager.ts`, `lib/xmtp/xmtp.client.ts`) will be discarded when that branch is abandoned.

### Frontend Contexts Migration

| Context | Action |
|---------|--------|
| `AIChatContext.tsx` | Refactor to use new `conversations`/`messages`/`tasks` schema |
| `AIChatSessionsContext.tsx` | Merge into `ConversationContext` or refactor to use `conversations` table |
| `XMTPContext.tsx` | Delete. Functionality absorbed by `ConversationContext` |

The new `ConversationContext` unifies:
- DM state management (from `XMTPContext`)
- Agent chat session listing (from `AIChatSessionsContext`)
- SSE real-time streaming (pattern from both contexts)
- Task status tracking (new — surfaces agent work progress)

### Database Schema Changes (Migration)

**New tables:** `conversations`, `conversation_participants`, `messages`, `tasks`, `artifacts`, `conversation_metadata`

**New enums:** `participant_type` (`user`, `agent`), `message_role` (`user`, `agent`), `task_state` (`submitted`, `working`, `input_required`, `completed`, `failed`, `canceled`, `rejected`, `auth_required`)

**Data migration** (run as SQL migration script):

```
chat_sessions → conversations + conversation_metadata + conversation_participants
  - chat_sessions.id → conversations.id (preserve IDs for cross-references)
  - chat_sessions.userId → conversation_participants (participantType: 'user')
  - Add "system-agent" participant (participantType: 'agent') for all migrated sessions
  - chat_sessions.title, shareToken, indexId → conversation_metadata.metadata
  - chat_sessions.metadata → conversation_metadata.metadata (merge)

chat_messages → messages
  - content → parts as [{ "text": <content> }] (A2A TextPart format)
  - role mapping: user→user, assistant→agent, system→agent (with metadata.isSystem: true)
  - routingDecision, subgraphResults, tokenCount → messages.metadata

chat_message_metadata → messages.metadata (merge traceEvents + debugMeta)

chat_session_metadata → tasks.metadata
  - Create one Task per session (state: "completed") to preserve debug aggregates
  - Link all messages in that session via taskId
```

**Cross-reference updates:**
- `OpportunityContext.conversationId` (typed as `Id<'chatSessions'>`) → update type to reference `conversations`
- Update `opportunity.discover.ts` and `database.interface.ts` references

**Drop (after data migration verified):**
- `chat_sessions`, `chat_messages`, `chat_message_metadata`, `chat_session_metadata` tables
- `hidden_conversations` table
- `walletAddress`, `walletEncryptedKey`, `xmtpInboxId` columns from `users` table
- `chatMessageRoleEnum` type

**Env cleanup:** `WALLET_ENCRYPTION_KEY`, `XMTP_ENV` — no longer required

## New Code

### Protocol

| File | Purpose |
|------|---------|
| `src/services/conversation.service.ts` | Conversation lifecycle, messages, DM dedup |
| `src/services/task.service.ts` | Task state machine, artifact management |
| `src/controllers/conversation.controller.ts` | REST API for conversations and messages |
| `src/adapters/database.adapter.ts` | Add `ConversationDatabaseAdapter` |

#### Conversation Service API

```typescript
class ConversationService {
  createConversation(participants: Participant[]): Promise<Conversation>
  getConversation(conversationId: string): Promise<Conversation | null>
  getConversations(userId: string): Promise<ConversationSummary[]>
  getOrCreateDM(userA: string, userB: string): Promise<Conversation>

  sendMessage(conversationId: string, senderId: string, role: Role, parts: Part[], opts?: { taskId?: string; metadata?: Record<string, any> }): Promise<Message>
  getMessages(conversationId: string, opts?: { limit?: number; before?: string; taskId?: string }): Promise<Message[]>

  hideConversation(userId: string, conversationId: string): Promise<void>
  updateMetadata(conversationId: string, metadata: Partial<ConversationMeta>): Promise<void>
}
```

#### Task Service API

```typescript
class TaskService {
  createTask(conversationId: string, metadata?: Record<string, any>): Promise<Task>
  updateState(taskId: string, state: TaskState, statusMessage?: Message): Promise<Task>
  getTask(taskId: string): Promise<Task | null>
  getTasksByConversation(conversationId: string): Promise<Task[]>

  createArtifact(taskId: string, artifact: { name?: string; description?: string; parts: Part[]; metadata?: Record<string, any> }): Promise<Artifact>
  getArtifacts(taskId: string): Promise<Artifact[]>
}
```

#### REST API Routes

All routes require `AuthGuard`:

**Conversations** (`/conversations`):

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/` | List user's conversations with last message |
| POST | `/` | Create conversation with participants |
| GET | `/:id/messages` | Get messages (paginated, cursor-based; optional `?taskId=` filter) |
| POST | `/:id/messages` | Send message |
| POST | `/dm` | Get or create DM with another user |
| PATCH | `/:id/metadata` | Update conversation metadata |
| DELETE | `/:id` | Hide conversation (sets hiddenAt) |
| GET | `/stream` | SSE stream for real-time messages + task status updates |

**Tasks** (`/conversations/:id/tasks`):

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/` | List tasks in conversation |
| GET | `/:taskId` | Get task with status and artifacts |
| GET | `/:taskId/artifacts` | Get artifacts for task |

#### Chat Controller Transition

The existing `ChatController` retains agent-chat-specific orchestration (invoking LangGraph, streaming agent responses) but uses `ConversationService` + `TaskService` for persistence:
- Session creation → `ConversationService.createConversation()`
- Agent invocation → `TaskService.createTask()` + state updates
- Agent response → `ConversationService.sendMessage()` with `taskId`
- Agent outputs → `TaskService.createArtifact()`
- Debug metadata → `messages.metadata` and `tasks.metadata`

#### Shared Session View (`/s/:token`)

Share tokens move from `chat_sessions.shareToken` to `conversation_metadata.metadata.shareToken`. The shared session route handler and `ShareGuard` must be updated accordingly.

### Frontend

| File | Purpose |
|------|---------|
| `src/services/conversation.ts` | Typed API client for conversation + task endpoints |
| `src/contexts/ConversationContext.tsx` | Unified context replacing XMTPContext + AIChatSessionsContext |

### Real-Time Delivery

SSE pattern stays. The stream now carries two event types:

```typescript
// Message event (new message in any conversation)
{ type: "message", conversationId, message: Message }

// Task status event (agent work progress)
{ type: "task_status", conversationId, taskId, state: TaskState, statusMessage?: Message }

// Artifact event (agent produced output)
{ type: "artifact", conversationId, taskId, artifact: Artifact }
```

Source: database insert + Redis pub/sub (replaces XMTP network polling). On `sendMessage`, publish to Redis channel keyed by recipient userId. Same keepalive (15s) and auto-reconnect patterns.

### LangGraph Integration

LangGraph's checkpointer uses its own internal tables (`checkpoint`, `checkpoint_writes`, `checkpoint_metadata`) — unchanged. The service layer that bridges LangGraph output to the database writes to `messages` + `tasks` + `artifacts` instead of `chat_messages` + `chat_message_metadata` + `chat_session_metadata`.

## Out of Scope

- End-to-end encryption (the new system stores messages in plaintext in our DB — acceptable for current product stage)
- Group conversations beyond DMs (schema supports it, no UI/API work now)
- Agent-to-agent messaging (schema supports it, no implementation now)
- FilePart / DataPart rendering in UI (only TextPart implemented initially)
- Read receipts / typing indicators
- Message editing / deletion
- A2A JSON-RPC transport layer (we align the data model; the RPC protocol is future work)
- A2A AgentCard / skill discovery (future — when agents are exposed externally)
- Push notification config (A2A `TaskPushNotificationConfig` — future)

## Risks

1. **Data migration** — existing chat history must migrate cleanly. Role mapping (`assistant`→`agent`, `system`→`agent`) and metadata merging must be tested. Creating Tasks from existing sessions adds complexity.
2. **OpportunityContext cross-reference** — `conversationId` typed to `Id<'chatSessions'>` must be updated across opportunity discovery code, database interface, and schema types.
3. **Auth integration** — `ensureWallet` is called on every user registration. Removing it without cleaning up the auth config crashes signups.
4. **Task granularity** — defining what constitutes a "task" in agent chat (per-turn? per-graph-invocation?) needs careful design during implementation. Start with one Task per user message → agent response cycle.
5. **SSE event types** — adding task_status and artifact events to the stream increases frontend complexity. Start with message events only; add task/artifact events when the UI needs them.
6. **Frontend atomicity** — frontend must be updated atomically with backend.
