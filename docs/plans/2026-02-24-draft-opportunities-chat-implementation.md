# Draft Opportunities + Chat-Only Discovery — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Chat-created opportunities use a new "draft" status and are visible only in that chat session; system-found opportunities stay "latent". Discovery in chat uses the signed-in user's profile + conversation query with RAG over profile and intent embeddings (no intent creation first). Chat does not list opportunities; home shows all non-draft opportunities.

**Architecture:** Add `draft` to `opportunity_status`; when creating from chat set `status: 'draft'` and `context.conversationId = chatSessionId`. List/get APIs: without session → exclude draft; with session → include draft for that session. Chat discovery path: profile + query → RAG (profiles + intents), cap results, no `createIntentSuggested`. `update_opportunity` allows draft → pending.

**Tech Stack:** Bun, Drizzle ORM, PostgreSQL/pgvector, LangGraph (opportunity graph), protocol tools and adapters.

**Prerequisites:** Consent-based intent proposal is assumed implemented. `list_opportunities` already removed from chat tools (done in this worktree).

---

## Task 1: Add `draft` to opportunity_status enum (schema + migration)

**Files:**
- Modify: `protocol/src/schemas/database.schema.ts` (line 11: opportunityStatusEnum)
- Create: `protocol/drizzle/0007_add_opportunity_status_draft.sql`
- Modify: `protocol/drizzle/meta/_journal.json`

**Step 1: Update schema enum**

In `protocol/src/schemas/database.schema.ts`, change line 11 from:

```typescript
export const opportunityStatusEnum = pgEnum('opportunity_status', ['latent', 'pending', 'viewed', 'accepted', 'rejected', 'expired']);
```

to:

```typescript
export const opportunityStatusEnum = pgEnum('opportunity_status', ['latent', 'draft', 'pending', 'viewed', 'accepted', 'rejected', 'expired']);
```

**Step 2: Generate migration**

Run: `cd protocol && bun run db:generate`

**Step 3: Rename migration and update journal**

Rename the generated SQL file to `0007_add_opportunity_status_draft.sql`. In PostgreSQL, adding an enum value is:

```sql
ALTER TYPE "public"."opportunity_status" ADD VALUE 'draft';
```

If Drizzle generated something different, ensure the migration only adds the new value. Then in `protocol/drizzle/meta/_journal.json`, add an entry (or update the last one) so the new migration tag is `0007_add_opportunity_status_draft`.

**Step 4: Apply migration**

Run: `cd protocol && bun run db:migrate`

**Step 5: Commit**

```bash
git add protocol/src/schemas/database.schema.ts protocol/drizzle/0007_add_opportunity_status_draft.sql protocol/drizzle/meta/_journal.json
git commit -m "feat(opportunities): add draft status to opportunity_status enum"
```

---

## Task 2: Update OpportunityStatus type and adapter/controller usages

**Files:**
- Modify: `protocol/src/lib/protocol/interfaces/database.interface.ts` (OpportunityStatus type ~line 323)
- Modify: `protocol/src/controllers/opportunity.controller.ts` (allowed statuses ~line 149-150)
- Modify: `protocol/src/adapters/database.adapter.ts` (any literal status arrays for opportunities; grep for 'latent' | 'pending' etc. in opportunity context)

**Step 1: Add 'draft' to OpportunityStatus**

In `protocol/src/lib/protocol/interfaces/database.interface.ts`:

```typescript
export type OpportunityStatus = 'latent' | 'draft' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';
```

**Step 2: Allow 'draft' in opportunity controller**

In `protocol/src/controllers/opportunity.controller.ts`, update the allowed status list to include `'draft'` where status updates are validated.

**Step 3: Update database adapter**

In `protocol/src/adapters/database.adapter.ts`, ensure any typed status arrays or conditions that list opportunity statuses include `'draft'` where appropriate (e.g. updateOpportunityStatus validation, getOpportunitiesForUser filters). Search for `'latent' | 'pending'` and add `'draft'`.

**Step 4: Run lint**

Run: `cd protocol && bun run lint`

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/interfaces/database.interface.ts protocol/src/controllers/opportunity.controller.ts protocol/src/adapters/database.adapter.ts
git commit -m "feat(opportunities): add draft to OpportunityStatus and allow in API"
```

---

## Task 3: getOpportunitiesForUser: support conversationId and exclude draft when no session

**Files:**
- Modify: `protocol/src/lib/protocol/interfaces/database.interface.ts` (OpportunityQueryOptions: add conversationId?: string)
- Modify: `protocol/src/adapters/database.adapter.ts` (getOpportunitiesForUser implementation: when options.conversationId is absent, exclude status = 'draft'; when present, include opportunities where (status = 'draft' AND context.conversationId = conversationId) OR status != 'draft')

**Step 1: Extend OpportunityQueryOptions**

In `protocol/src/lib/protocol/interfaces/database.interface.ts`, add to `OpportunityQueryOptions`:

```typescript
/** When set, include draft opportunities for this chat session. When unset, exclude all draft opportunities (e.g. home view, API). */
conversationId?: string;
```

**Step 2: Implement filtering in adapter**

In the adapter's `getOpportunitiesForUser`, build the query so that:
- If `options.conversationId` is not set: add condition `status != 'draft'` (or equivalent so draft rows are excluded).
- If `options.conversationId` is set: return opportunities where the user is an actor AND ( (status = 'draft' AND context->>'conversationId' = options.conversationId) OR status != 'draft' ).

Context is JSONB; use the adapter's query builder to filter on `context.conversationId`. Reference existing queries that use `opportunities.context` or similar.

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/interfaces/database.interface.ts protocol/src/adapters/database.adapter.ts
git commit -m "feat(opportunities): filter draft by conversationId in getOpportunitiesForUser"
```

---

## Task 4: Pass chatSessionId and initialStatus 'draft' when creating opportunities from chat

**Files:**
- Modify: `protocol/src/lib/protocol/tools/opportunity.tools.ts` (create_opportunities handler: accept sessionId from context, pass to discover/persist path; set initialStatus to 'draft' and context.conversationId when sessionId present)
- Modify: `protocol/src/lib/protocol/tools/tool.helpers.ts` or ResolvedToolContext (ensure sessionId is available on context when chat is session-scoped)
- Modify: `protocol/src/lib/protocol/support/opportunity.discover.ts` (DiscoverInput: add chatSessionId?: string; pass through to graph options)
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts` (invoke input: accept chatSessionId; options: initialStatus 'draft' when chatSessionId set; persist node: set context.conversationId when chatSessionId present)
- Modify: `protocol/src/lib/protocol/states/opportunity.state.ts` (add chatSessionId to state if not present; add to CreateOpportunityData/context in persist)

**Step 1: Ensure ResolvedToolContext has sessionId**

Check `protocol/src/lib/protocol/tools/tool.helpers.ts` and the type `ResolvedToolContext`. If chat session id is not there, add `sessionId?: string` (or `chatSessionId`) and ensure the chat graph or controller passes it when resolving context for tools.

**Step 2: Opportunity graph state and invoke**

In `protocol/src/lib/protocol/states/opportunity.state.ts`, add optional `chatSessionId?: string` to the state annotation if the graph needs it. In `opportunity.graph.ts`, when building `CreateOpportunityData` in the persist node, set `context: { indexId: ..., conversationId: state.chatSessionId ?? undefined }` when `state.chatSessionId` is set. Set `initialStatus: 'draft'` in options when `state.chatSessionId` is set.

**Step 3: runDiscoverFromQuery and create_opportunities tool**

In `opportunity.discover.ts`, add `chatSessionId?: string` to `DiscoverInput` and pass it into the graph invoke. In `opportunity.tools.ts`, in the discovery branch of `create_opportunities`, get `context.sessionId` (or equivalent) and pass it to `runDiscoverFromQuery` and ensure the graph is invoked with `chatSessionId` and `options: { initialStatus: 'draft', ... }` when sessionId is present.

**Step 4: Introduction mode from chat**

When create_opportunities is used in introduction mode (partyUserIds + entities) and context has sessionId, also set initialStatus to 'draft' and context.conversationId so intro-from-chat creates draft opportunities.

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/tools/opportunity.tools.ts protocol/src/lib/protocol/support/opportunity.discover.ts protocol/src/lib/protocol/graphs/opportunity.graph.ts protocol/src/lib/protocol/states/opportunity.state.ts
git commit -m "feat(opportunities): create draft opportunities in chat with conversationId"
```

---

## Task 5: update_opportunity: allow draft → pending

**Files:**
- Modify: `protocol/src/lib/protocol/tools/opportunity.tools.ts` (update_opportunity: allow status transition from 'draft' to 'pending' in addition to 'latent' to 'pending')
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts` (send node if present: allow draft as well as latent for "send")
- Modify: `protocol/src/adapters/database.adapter.ts` (updateOpportunityStatus: allow draft where latent was previously the only "sendable" status)
- Modify: `protocol/src/controllers/opportunity.controller.ts` (allow 'draft' in allowed list if not already)

**Step 1: Tool and graph**

Where the code checks "only latent can be sent", change to "latent or draft can be sent" (e.g. `opp.status === 'latent'` → `(opp.status === 'latent' || opp.status === 'draft')`). In the update_opportunity tool handler, when the user requests status 'pending', allow it if current status is 'latent' or 'draft'.

**Step 2: Adapter**

In the database adapter, any guard that prevents status update from non-latent should allow draft the same as latent for the transition to pending.

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/tools/opportunity.tools.ts protocol/src/lib/protocol/graphs/opportunity.graph.ts protocol/src/adapters/database.adapter.ts protocol/src/controllers/opportunity.controller.ts
git commit -m "feat(opportunities): allow draft to pending in update_opportunity"
```

---

## Task 6: Chat discovery without intents: RAG from profile + query (no createIntentSuggested)

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts` (prep/scope: when chatSessionId is set and searchQuery is set, do not require indexedIntents; use sourceProfile + searchQuery only; discovery node: RAG over profile embeddings and intent embeddings from other users in scope, cap results)
- Modify: `protocol/src/lib/protocol/support/opportunity.discover.ts` (when chatSessionId present, do not return createIntentSuggested; or remove createIntentSuggested from chat path entirely)
- Modify: `protocol/src/lib/protocol/agents/chat.agent.ts` (remove or no-op handleCreateIntentCallback when using chat discovery; or keep for non-chat flows)

**Step 1: Opportunity graph — chat discovery path**

When `state.chatSessionId` is set and `state.searchQuery` is non-empty, the graph should:
- Not require user intents (indexedIntents can be empty).
- Use user's sourceProfile (embedding) and searchQuery to produce a combined or query embedding.
- In the discovery/candidate node: search other users' profile embeddings and intent embeddings (in scope) via vector similarity, with a limit (e.g. 20 profiles + 20 intents, then merge/dedupe and take top N candidates).
- Run evaluation and persist as draft with conversationId.

Reuse existing HyDE/embedder and database methods (e.g. search profiles by embedding, search intents by embedding in index scope). Add a branch or option so that when chatSessionId + searchQuery are set, the graph skips intent-based discovery and uses this RAG path instead.

**Step 2: Remove createIntentSuggested for chat**

In `opportunity.discover.ts`, when `input.chatSessionId` (or equivalent) is set, do not return `createIntentSuggested`/`suggestedIntentDescription` from the result; return "no matches" or the RAG results only. In the tool, when calling runDiscoverFromQuery from chat, pass chatSessionId so the discover layer knows not to suggest intent creation.

**Step 3: Chat agent**

Optionally simplify or remove the createIntentSuggested retry logic in `chat.agent.ts` for the chat path (if all chat discovery goes through the new path that never returns createIntentSuggested). Or leave it for non-chat callers that might still use discovery with intent suggestion.

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/graphs/opportunity.graph.ts protocol/src/lib/protocol/support/opportunity.discover.ts protocol/src/lib/protocol/agents/chat.agent.ts
git commit -m "feat(opportunities): RAG discovery in chat from profile+query, no createIntentSuggested"
```

---

## Task 7: Home graph excludes draft opportunities

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/home.graph.ts` (when calling getOpportunitiesForUser, pass no conversationId so adapter excludes draft; or explicitly pass excludeDraft: true if that becomes an option)

**Step 1: Verify home graph**

Home graph (or the adapter it uses) should call `getOpportunitiesForUser(userId, options)` without `conversationId`. With Task 3 implemented, that already excludes draft. Verify the home graph does not pass conversationId; if it does for some other reason, ensure the intent is "show non-draft only" for the main home view.

**Step 2: Commit (if any change)**

```bash
git add protocol/src/lib/protocol/graphs/home.graph.ts
git commit -m "chore(opportunities): ensure home view excludes draft opportunities"
```

---

## Task 8: Tests and prompt tweaks

**Files:**
- Modify: `protocol/src/lib/protocol/tools/tests/chat.tools.spec.ts` (update_opportunity tests: allow draft as sendable status where latent was; add test for draft → pending if needed)
- Modify: `protocol/src/lib/protocol/agents/chat.prompt.ts` (status translation already mentions draft; ensure update_opportunity description says draft can be sent to pending)

**Step 1: Tool tests**

In `protocol/src/lib/protocol/tools/tests/chat.tools.spec.ts`, update tests that assert "only latent can be sent" to allow "latent or draft". Add a test that draft opportunity can be updated to pending.

**Step 2: Prompt**

In `protocol/src/lib/protocol/agents/chat.prompt.ts`, in the update_opportunity description or status section, mention that draft opportunities can be sent (status → pending).

**Step 3: Run tests**

Run: `cd protocol && bun test src/lib/protocol/tools/tests/chat.tools.spec.ts`

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/tools/tests/chat.tools.spec.ts protocol/src/lib/protocol/agents/chat.prompt.ts
git commit -m "test(opportunities): draft status in update_opportunity; prompt tweak"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add `draft` to opportunity_status enum (schema + migration) |
| 2 | Update OpportunityStatus type and adapter/controller |
| 3 | getOpportunitiesForUser: conversationId filter, exclude draft when no session |
| 4 | Pass chatSessionId and create draft opportunities from chat |
| 5 | update_opportunity: allow draft → pending |
| 6 | Chat discovery: RAG from profile+query, no createIntentSuggested |
| 7 | Home graph excludes draft (verify) |
| 8 | Tests and prompt tweaks |

---

## Execution

Plan complete and saved to `docs/plans/2026-02-24-draft-opportunities-chat-implementation.md`.

**Two execution options:**

1. **Subagent-driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel session (separate)** — You open a new session with @superpowers:executing-plans and run the plan task-by-task with checkpoints.

Which approach do you want?
