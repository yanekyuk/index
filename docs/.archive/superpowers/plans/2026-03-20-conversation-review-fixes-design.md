# Conversation System Review Fixes — Design

Fixes for issues identified in code review of PR #542 (feat/inhouse-messages).

## Context

PR #542 replaces XMTP-based messaging with a unified, A2A-compatible conversation system. Code review identified critical security gaps, architecture layering violations, performance issues, and type safety problems.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where to enforce participant access control | Service layer | Matches existing pattern (services scope by userId); guards stay as identity/env gates only |
| `createConversation` caller validation | Controller validates `user.id` is in participants (400 if not); service stays generic | A2A needs agent-only conversations — service must not force a human caller |
| Pub/sub ownership | Move entirely into `ConversationService` | Fixes both layering violations (controller→adapter, adapter→adapter) |
| `getConversationsForUser` optimization | `DISTINCT ON` raw SQL | Avoids schema change; existing composite index supports it |
| `getOrCreateDM` race condition | Unique constraint + catch/retry | Declarative, DB-enforced, no application-level locks |
| `any` types | Replace with proper types | Project enforces `no-explicit-any` |

## Section 1: Authorization & Access Control

**Participant verification in service layer:**
- Add `verifyParticipant(userId, conversationId)` to `ConversationService` — queries `conversationParticipants` for the pair, throws 403 if not found.
- Every service method operating on a specific conversation calls this first: `getMessages`, `sendMessage`, `hideConversation`, `updateMetadata`, and task-related methods.
- `getConversationsForUser` skips verification — already scoped by userId.

**Controller-level validation on create:**
- `POST /conversations`: Validate `user.id` is in the `participants` array, return 400 if not. Service stays generic for A2A flexibility.
- `POST /conversations/dm`: Already safe — always passes `user.id` as `userA`.

**Task ownership verification:**
- `TaskService.getTask(taskId, conversationId)` — verify `task.conversationId === conversationId` before returning.
- `TaskService.getArtifacts(taskId, conversationId)` — same check.
- Combined with conversation-level participant check: user must be in the conversation, and the task must belong to that conversation.

## Section 2: Pub/Sub Restructuring (Layering Fix)

**Move all Redis pub/sub into `ConversationService`:**
- Service gets `getRedisClient`/`createRedisClient` via import (services are allowed to import adapters).
- **Publish:** `ConversationService.sendMessage()` persists via database adapter, then publishes to Redis for all participants except sender. Adapter's `createMessage` loses Redis import and pub/sub code.
- **Subscribe:** New method `ConversationService.subscribe(userId): { on, cleanup }` — creates dedicated Redis subscriber for `conversations:user:{userId}`, returns callback-based interface with keepalive, error recovery, and cleanup.
- **Controller `stream` endpoint:** Calls `conversationService.subscribe(user.id)`, pipes events into SSE response formatting. No Redis imports in controller.

**Result:**
- `database.adapter.ts` — no longer imports `cache.adapter`, pure persistence
- `conversation.controller.ts` — no longer imports `cache.adapter`, only talks to service
- `conversation.service.ts` — owns real-time logic, imports adapters (allowed)

## Section 3: Query Performance & Schema Fixes

**`getConversationsForUser` optimization:**
- Replace fetch-all-messages approach with `DISTINCT ON` raw SQL:
  ```sql
  SELECT DISTINCT ON (conversation_id) *
  FROM messages
  WHERE conversation_id = ANY($ids)
  ORDER BY conversation_id, created_at DESC
  ```
- Existing composite index `(conversationId, createdAt)` on `messages` supports this.

**Missing index on `conversationParticipants`:**
- Add index on `conversationParticipants.conversationId` for fast participant lookups and `verifyParticipant` checks. Currently only `participantId` is indexed.
- New migration (0022).

**`getOrCreateDM` race condition — unique constraint:**
- Add unique constraint to prevent duplicate DMs between the same user pair. Normalized approach (sorted participant IDs or similar).
- On conflict, catch unique violation and retry with SELECT.
- Included in 0022 migration.

## Section 4: Type Safety & Test Fixes

**Remove `any` types in `ConversationDatabaseAdapter`:**
- `(existing as any).rows` in `getOrCreateDM` — type raw SQL result properly.
- `any` casts on `parts`, `metadata`, `statusMessage` — replace with `Record<string, unknown>`, `unknown[]`, or Drizzle-inferred types.

**Test fixes:**
- `conversation-adapter.spec.ts` — add `dotenv` config loading at top before imports.
- Add authorization tests: verify unauthorized user gets 403 accessing a conversation they're not a participant of.
- Add race condition test for `getOrCreateDM` if feasible.

**Frontend fix:**
- `ConversationContext.tsx` `sendMessage` useCallback — add `user` to dependency array to prevent stale closure.
