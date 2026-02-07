# Latent Opportunity Lifecycle — Implementation Plan

> **Status**: READY  
> **Branch**: `feat/latent-opportunities`  
> **Scope**: Add `latent` opportunity status, update discovery to persist as latent, add `send_opportunity` chat tool, update `create_opportunity_between_members` to create as latent.  
> **See also**: [Design Doc](../src/lib/protocol/docs/Latent%20Opportunity%20Lifecycle.md), [Opportunity Graph README](../src/lib/protocol/graphs/opportunity/README.md)

---

## Overview

When a user says "find opportunities for me," the `create_opportunities` chat tool invokes the **Opportunity Graph** — a linear multi-step workflow (similar to the Intent Graph) that discovers, evaluates, and persists opportunities in a **latent** state. Opportunities are only found between intents that share the same index. Non-indexed intents cannot participate in discovery.

The user then chooses to **send** (promote to pending + notify) or dismiss. Users never directly create opportunities; they only act on agent-created ones.

**Key Architectural Principle**: Chat tools are simple CRUD operations. Complex logic lives in graphs. The chat agent's system prompt guides it to handle complex user requests using these simple tools.

---

## Current State (post-cleanup)

| Component | Location | Current Behavior |
|-----------|----------|-----------------|
| Status enum | `src/schemas/database.schema.ts:18` | `pending, viewed, accepted, rejected, expired` |
| `OpportunityStatus` type | `src/lib/protocol/interfaces/database.interface.ts:284` | Mirrors enum |
| `persistOpportunitiesNode` | `src/lib/protocol/graphs/opportunity/opportunity.graph.ts:393` | Hardcodes `status: 'pending'` |
| `create_opportunities` tool | `src/lib/protocol/graphs/chat/chat.tools.ts` | Calls `runDiscoverFromQuery` → full opportunity graph (persist as latent) |
| `create_opportunity_between_members` | `src/lib/protocol/graphs/chat/chat.tools.ts:1111-1232` | Creates with `status: 'pending'`, immediately queues notifications |
| `PATCH /:id/status` | `src/controllers/opportunity.controller.ts:78-120` | Accepts `pending, viewed, accepted, rejected, expired` |
| `updateOpportunityStatus` | `src/adapters/database.adapter.ts:2121-2131` | Same union as controller |
| Notifications | `src/queues/notification.queue.ts` | `queueOpportunityNotification(id, recipientId, priority)` |
| Latest migration | `drizzle/0022_rename_personal_index_to_my_own_private.sql` | — |

---

## Architectural Decisions & Constraints

### Why a Linear Multi-Step Graph?

The opportunity discovery process has inherent complexity that requires orchestration:
1. **Context gathering**: Need to fetch user's indexed intents with hyde documents
2. **Scope determination**: Must identify which indexes to search within
3. **Semantic search**: Vector similarity search across multiple indexes
4. **Quality evaluation**: LLM-based scoring of candidate matches
5. **Ranking & limiting**: Sort by confidence and apply reasonable limits
6. **Persistence**: Batch create opportunities in database

This is conceptually similar to the intent graph's: infer → verify → reconcile → execute flow. Both require state accumulation across multiple steps with potential for conditional routing.

### Why CRUD-Only Chat Tools?

**Constraint**: The chat tools layer (`chat.tools.ts`) must remain simple CRUD operations. Complex multi-step logic should not live in tools.

**Rationale**: 
- Tools are LangChain tool wrappers exposed to the LLM via function calling
- The LLM sees tool descriptions and decides when to call them
- Complex logic in tools makes them harder to test, compose, and reason about
- Graphs provide better observability, retry logic, and state management

**Solution**: 
- Tool description and chat agent system prompt provide the intelligence
- Tools are thin wrappers around graphs or database operations
- Agent prompt teaches the LLM how to handle complex user requests using simple tools

### Index-Scoped Discovery

**Constraint**: Opportunities only exist between intents that share the same index. Non-indexed intents cannot participate.

**Rationale**:
- Privacy: Users control what they share by choosing which indexes to join
- Relevance: Index prompts provide context for appropriate matching
- Scalability: Bounded search space prevents O(n²) matching across all users
- Trust: Indexes can have membership criteria, vouch systems, etc.

**Implementation**: The discovery node filters candidates by index membership before performing vector search.

### Hyde Documents for Semantic Search

**Constraint**: Both source and candidate intents must have hyde documents (with embeddings) to participate in opportunity discovery.

**Rationale**:
- Hyde provides richer semantic representation than raw intent text
- Better cross-domain matching (finds "need React help" ↔ "offering frontend mentorship")
- Consistent with existing profile and intent matching infrastructure

**Implementation**: The prep node validates that user's intents have hyde documents. Discovery node performs similarity search on hyde embeddings.

---

## Implementation Steps

### Step 1: Schema and types — add `latent` status

**Goal**: Make `latent` a valid opportunity status at every layer.

**Files to change**:

1. **`src/schemas/database.schema.ts`** (line 18)
   - Change `opportunityStatusEnum` from `['pending', 'viewed', 'accepted', 'rejected', 'expired']` to `['latent', 'pending', 'viewed', 'accepted', 'rejected', 'expired']`.

2. **`src/lib/protocol/interfaces/database.interface.ts`** (line 284)
   - Change `OpportunityStatus` to: `'latent' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired'`

3. **`src/adapters/database.adapter.ts`**
   - `OpportunityDatabaseAdapter.updateOpportunityStatus` (line 2121-2124): add `'latent'` to the status union.
   - `ChatDatabaseAdapter.updateOpportunityStatus` (line 1868-1871): add `'latent'` to the status union.

4. **`src/controllers/opportunity.controller.ts`** (line 102)
   - Add `'latent'` to the `allowed` array: `const allowed = ['latent', 'pending', 'viewed', 'accepted', 'rejected', 'expired'];`

**Verification**: `bun run lint` passes; TypeScript compiles.

---

### Step 2: Database migration

**Goal**: Add `latent` value to the PostgreSQL enum.

**Action**:
1. Run `bun run db:generate` to auto-generate the migration from the schema change.
2. Verify the generated SQL is equivalent to:
   ```sql
   ALTER TYPE opportunity_status ADD VALUE IF NOT EXISTS 'latent' BEFORE 'pending';
   ```
3. Run `bun run db:migrate` to apply.

**Verification**: `bun run db:studio` — confirm `opportunity_status` enum includes `latent`.

---

### Step 3: Refactor Opportunity Graph — Linear Multi-Step Workflow

**Goal**: Restructure the opportunity graph to follow the intent graph pattern: a linear sequence of nodes with proper state management and conditional routing.

**Motivation**: The current graph mixes concerns (HyDE generation, search, evaluation, persistence). We need a cleaner separation aligned with the intent graph architecture.

**New Graph Structure**:

```
Prep → Scope → Discovery → Evaluation → Ranking → Persist → END
```

**Files to create/modify**:

1. **Create `src/lib/protocol/graphs/opportunity/opportunity.graph.state.ts`**
   - Define state annotation with proper reducers
   - Input: `userId`, `searchQuery`, `indexId?`, `options`
   - Intermediate: `indexedIntents`, `targetIndexes`, `candidates`, `evaluatedCandidates`
   - Output: `opportunities`, `error?`

2. **Refactor `src/lib/protocol/graphs/opportunity/opportunity.graph.ts`**
   - Convert to factory pattern: `OpportunityGraphFactory` class
   - Constructor accepts `database`, `embedder`, `hydeCache`
   - Implement six nodes:
     - `prepNode`: Fetch user's indexed intents with hyde documents
     - `scopeNode`: Determine which indexes to search
     - `discoveryNode`: Vector search within target indexes
     - `evaluationNode`: Parallel evaluation using OpportunityEvaluator
     - `rankingNode`: Sort by confidence, apply limit
     - `persistNode`: Create opportunities with `initialStatus` from options
   - Add conditional routing: early exit if no indexed intents

3. **Update `src/lib/protocol/agents/opportunity/opportunity.evaluator.ts`**
   - Ensure it accepts candidate pairs with index context
   - Add `initialStatus?: OpportunityStatus` to options (for persist node)

**Verification**: 
- Graph compiles without errors
- Each node logs entry/exit
- State flows correctly through all nodes

---

### Step 4: Simplify Chat Tools — CRUD Only

**Goal**: Simplify `create_opportunities` tool to just invoke the opportunity graph. Remove complex logic from tools; rely on graph and agent prompt to handle complexity.

**Files to change**:

1. **`src/lib/protocol/graphs/chat/chat.tools.ts`**
   - Simplify `create_opportunities` tool:
     - Accepts `searchQuery` (string) and optional `indexId` (UUID)
     - Invokes refactored opportunity graph: `opportunityGraph.invoke({ userId, searchQuery, indexId?, options: { initialStatus: 'latent' } })`
     - Returns formatted result with opportunity count
   - Keep tool description clear: "Create draft opportunities by searching for relevant connections. Pass searchQuery and optional indexId. Results are saved as drafts (latent)."

2. **Remove or simplify `src/lib/protocol/graphs/chat/nodes/discover.nodes.ts`** (if it still exists)
   - If this file wraps the opportunity graph, consider removing it and calling the graph directly from the tool
   - Or keep it minimal as a thin adapter layer

**Key Principle**: Tools should be thin wrappers around graphs or database calls. The chat agent's system prompt provides the intelligence to use these tools correctly.

**Verification**: 
- Call `create_opportunities` via chat
- Verify it invokes the new opportunity graph
- Check DB for `status = 'latent'` on created opportunities

---

### Step 5: New chat tool — `send_opportunity`

**Goal**: Allow users to promote a latent opportunity to pending and trigger notifications.

**File to change**: `src/lib/protocol/graphs/chat/chat.tools.ts`

Add a new tool after the existing discovery tools section:

```typescript
const sendOpportunity = tool(
  async (args: { opportunityId: string }) => {
    logger.info("Tool: send_opportunity", { userId, opportunityId: args.opportunityId });

    try {
      const opportunity = await database.getOpportunity(args.opportunityId);
      if (!opportunity) {
        return error("Opportunity not found.");
      }
      if (opportunity.status !== 'latent') {
        return error(`Opportunity is already ${opportunity.status}; only draft (latent) opportunities can be sent.`);
      }
      const isActor = opportunity.actors.some((a) => a.identityId === userId);
      if (!isActor) {
        return error("You are not part of this opportunity.");
      }

      await database.updateOpportunityStatus(args.opportunityId, 'pending');

      const recipients = opportunity.actors.filter((a) => a.identityId !== userId);
      for (const recipient of recipients) {
        await queueOpportunityNotification(opportunity.id, recipient.identityId, 'high');
      }

      const recipientNames = recipients.map((a) => a.identityId);
      return success({
        sent: true,
        opportunityId: opportunity.id,
        notified: recipientNames,
        message: "Opportunity sent. The other person has been notified.",
      });
    } catch (err) {
      logger.error("send_opportunity failed", { error: err });
      return error("Failed to send opportunity. Please try again.");
    }
  },
  {
    name: "send_opportunity",
    description:
      "Sends a draft (latent) opportunity to the other person, promoting it to pending and triggering a notification. Use after create_opportunities or create_opportunity_between_members when the user wants to send the intro.",
    schema: z.object({
      opportunityId: z.string().describe("The opportunity ID to send (from create_opportunities or list_my_opportunities)"),
    }),
  }
);
```

Also add `sendOpportunity` to the returned tools array in `createChatTools`.

**Verification**: Create a latent opportunity, then call `send_opportunity` via chat; confirm status changes to `pending` and notification is queued.

---

### Step 6: Remove `create_opportunity_between_members` tool

**Goal**: Simplify to a single unified `create_opportunities` tool that handles both discovery and curator modes.

**Rationale**: 
- Both flows result in creating draft opportunities
- Discovery mode: semantic search across indexed intents
- Curator mode: explicit member selection (future enhancement)
- Single tool reduces complexity and maintains CRUD-only principle

**File to change**: `src/lib/protocol/graphs/chat/chat.tools.ts`

1. Remove the entire `createOpportunityBetweenMembers` tool definition (~lines 1310-1429)

2. Remove it from the returned tools array at the end of `createChatTools`

3. Update agent system prompt to remove references to `create_opportunity_between_members`

**Future Enhancement**: When curator mode is needed, extend `create_opportunities` to accept:
- Optional `candidateUserIds: string[]` parameter
- If provided, skip discovery and create opportunities directly between users
- Still creates as `latent` status (same flow)

**Verification**: 
- Tool is removed from chat tools
- Agent system prompt no longer references it
- Code compiles without errors

---

### Step 7: Update Agent System Prompt — Guide Complex Request Handling

**Goal**: The chat agent's system prompt provides comprehensive guidance on using simple CRUD tools to handle complex user requests. The agent understands constraints (index-scoped search, hyde requirements) and guides users appropriately.

**Files to change**:

1. **`src/lib/protocol/graphs/chat/chat.agent.ts`**

   - **Discovery tools section** (~lines 61-68): Update:
     ```markdown
     - **create_opportunities**: Invoke opportunity graph to find relevant connections. Pass `searchQuery` (what user is looking for) and optional `indexId` (UUID) to scope search. Results are saved as **drafts** (latent status). The graph handles all complexity: fetching indexed intents, hyde-based semantic search, evaluation, ranking. Use when user says "find opportunities", "find me a mentor", "who needs help with X".
     - **send_opportunity**: Promote a draft opportunity to pending and notify the other person. Requires `opportunityId` from list_my_opportunities. Use when user says "send intro to [name]", "send that opportunity", "notify Alice".
     ```

   - **Guidelines** (~line 79-95): Add comprehensive guidance:
     ```markdown
     ### Opportunity Discovery Constraints
     - Opportunities are only found between intents that **share the same index**. Non-indexed intents cannot participate.
     - Both intents must have hyde documents (auto-generated) for semantic matching.
     - If user has no indexed intents, explain: "You'll need to join an index and add some intents first before finding opportunities."
     - After calling create_opportunities, tell user how many drafts were created and that they can send intros when ready (e.g., "Found 3 draft opportunities. You can say 'send intro to [name]' when ready.").
     - When creating opportunity between members (curator flow), inform introducer it's a draft and they need to say "send it" to notify both parties.
     
     ### Handling Complex Queries
     - "Find me a React developer in the AI index" → create_opportunities(searchQuery="React developer", indexId=<ai-index-uuid>)
     - "Who can help with fundraising?" → create_opportunities(searchQuery="help with fundraising") (searches all user's indexes)
     - "Send intro to Alice" → list_my_opportunities() first to find opportunityId, then send_opportunity(opportunityId=...)
     ```

   - **Table formatting** (~line 152): Note that `latent` status displays as "Draft" in tables.

2. **`src/lib/protocol/graphs/chat/streaming/chat.streaming.ts`** (~line 33-39)

   Ensure streaming labels are present:
   ```typescript
   create_opportunities: "Creating draft opportunities...",
   send_opportunity: "Sending opportunity...",
   ```

**Verification**: 
- Read system prompt in code
- Confirm all guidance is present
- Test chat flow: "find me opportunities" → agent calls create_opportunities → agent explains drafts

---

### Step 8: Update Tests and Documentation

**Goal**: Tests pass, new graph structure is validated, and README documents the new architecture.

**Files to change**:

1. **Create `src/lib/protocol/graphs/opportunity/opportunity.graph.spec.ts`**
   - Test prep node: returns empty if user has no indexed intents
   - Test scope node: correctly determines target indexes from input
   - Test discovery node: performs vector search within index scope
   - Test evaluation node: parallel processing with OpportunityEvaluator
   - Test ranking node: sorts by confidence and applies limit
   - Test persist node: when `options.initialStatus` is `'latent'`, opportunities are created with `status: 'latent'`
   - Test backward compat: when `options.initialStatus` is omitted, defaults to `'pending'`
   - Test conditional routing: early exit if no indexed intents

2. **Update `src/lib/protocol/graphs/opportunity/README.md`**
   - Document new graph architecture (six nodes)
   - Explain index-scoped search with hyde documents
   - Add mermaid diagram showing node flow
   - Document state structure
   - Add usage examples

3. **Update `src/lib/protocol/graphs/chat/chat.tools.spec.ts`** (if exists)
   - Test `create_opportunities` invokes opportunity graph with correct params
   - Test `send_opportunity` promotes latent → pending and queues notifications

**Verification**: 
- `bun test` passes all tests
- README is comprehensive and up-to-date
- Mermaid diagrams render correctly

---

## Step Summary

| Step | Files | Description |
|------|-------|-------------|
| 1 | `database.schema.ts`, `database.interface.ts`, `database.adapter.ts`, `opportunity.controller.ts` | Add `latent` to status enum, type, adapter, controller |
| 2 | `drizzle/0024_*.sql` | Database migration (add `latent` to enum) |
| 3 | `opportunity.graph.state.ts` (new), `opportunity.graph.ts` (refactor), `opportunity.evaluator.ts` | Refactor opportunity graph to linear multi-step workflow following intent graph pattern |
| 4 | `chat.tools.ts`, `discover.nodes.ts` | Simplify `create_opportunities` to invoke refactored graph; remove complex logic from tool |
| 5 | `chat.tools.ts` | New `send_opportunity` tool (simple status update + notification) |
| 6 | `chat.tools.ts`, `chat.agent.ts` | Remove `create_opportunity_between_members` tool (unified in `create_opportunities`) |
| 7 | `chat.agent.ts`, `chat.streaming.ts` | Comprehensive system prompt guidance for handling complex requests with simple tools |
| 8 | `opportunity.graph.spec.ts` (new), `opportunity/README.md`, `chat.tools.spec.ts` | Tests for new graph nodes, README documenting architecture |

## Checklist

- [x] Step 1: `latent` in schema, interface, adapter, controller *(completed)*
- [x] Step 2: Migration generated and applied *(completed)*
- [x] Step 3: Refactor opportunity graph to linear multi-step workflow *(in progress - core complete)*
  - [x] Create `opportunity.graph.state.ts` with proper state annotation
  - [x] Refactor `opportunity.graph.ts` to factory pattern with six nodes
  - [x] Implement prep, scope, discovery, evaluation, ranking, persist nodes
  - [x] Add conditional routing (early exit if no indexed intents/indexes)
  - [ ] Test the refactored graph end-to-end
  - [ ] Update `opportunity.evaluator.ts` if needed (currently compatible)
- [x] Step 4: Simplify `create_opportunities` chat tool *(completed)*
  - [x] Updated to invoke refactored graph with new signature
  - [x] Updated tool instantiation to use factory pattern
  - [x] Kept `discover.nodes.ts` as thin wrapper (CRUD principle)
- [x] Step 5: `send_opportunity` chat tool implemented *(completed)*
- [x] Step 6: Remove `create_opportunity_between_members` tool (unified approach) *(completed)*
- [ ] Step 7: System prompt guidance for complex request handling
  - [ ] Update `chat.agent.ts` with comprehensive guidelines
  - [ ] Add index-scoped search constraints explanation
  - [ ] Add complex query handling examples
  - [ ] Update streaming labels in `chat.streaming.ts`
- [ ] Step 8: Tests and documentation
  - [ ] Create `opportunity.graph.spec.ts` with node tests
  - [ ] Update `opportunity/README.md` with new architecture
  - [ ] Add mermaid diagrams
  - [ ] Update `chat.tools.spec.ts` if needed
- [ ] `bun run lint` clean
- [ ] `bun test` green
- [ ] Integration test: full flow from "find opportunities" → create drafts → send intro
