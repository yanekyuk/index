# Index Management: Agentic Architecture

**Status:** Documentation  
**Date:** 2026-01-31  
**Related:** [Intent Graph](../intent/), [IntentIndexer Agent](../../agents/intent/indexer/)

---

## Overview

Index Management in Index Network governs how **Indexes** (communities) curate and organize **Intents** (user goals). The agentic layer automates intent-to-index assignment through LLM-based evaluation, enabling intelligent, context-aware curation without manual intervention.

This document covers the **agentic business logic** for Index Management—the AI-driven components that evaluate, assign, and manage intent-index relationships.

---

## Table of Contents

1. [Core Concepts](#1-core-concepts)
2. [The IntentIndexer Agent](#2-the-intentindexer-agent)
3. [Event-Driven Auto-Assignment](#3-event-driven-auto-assignment)
4. [Scoring Algorithm](#4-scoring-algorithm)
5. [Queue Processing](#5-queue-processing)
6. [Service Layer Integration](#6-service-layer-integration)
7. [Flow Diagrams](#7-flow-diagrams)
8. [API & Frontend Integration](#8-api--frontend-integration)
9. [Future Considerations](#9-future-considerations)

---

## 1. Core Concepts

### Indexes (Communities)

An **Index** represents a curated community or collection of related intents. Each index has:

| Field | Description |
|-------|-------------|
| `title` | Human-readable name for the community |
| `prompt` | LLM-evaluated purpose/scope definition (e.g., "AI/ML professionals seeking collaborators") |
| `permissions` | Access control (joinPolicy, invitationLink) |

### Index Members

Members participate in indexes with role-based permissions:

| Role | Capabilities |
|------|-------------|
| `owner` | Full control (create, update, delete, manage members, promote owners) |
| `admin` | Manage members (add/remove/update permissions), but cannot promote to owner |
| `member` | View intents, manage own intents in the index |

Each member has additional settings:

| Setting | Description |
|---------|-------------|
| `prompt` | Member-specific sharing preferences (overrides/supplements index prompt) |
| `autoAssign` | Boolean flag enabling automatic intent-to-index assignment |

### Intent-Index Relationships

Intents are linked to Indexes via the `intentIndexes` junction table. This relationship can be:

1. **Manually assigned** - User explicitly adds/removes intents
2. **Auto-assigned** - LLM evaluates appropriateness and assigns/removes automatically

---

## 2. The IntentIndexer Agent

### Location

```
protocol/src/agents/intent/indexer/intent.indexer.ts
```

### Purpose

The **IntentIndexer** is a LangChain-based agent that evaluates whether an intent is appropriate for a given index and member context. It produces dual scores:

1. **indexScore** - How well the intent fits the index's purpose
2. **memberScore** - How well the intent matches the member's sharing preferences

### Implementation

```typescript
export class IntentIndexer extends BaseLangChainAgent {
  constructor() {
    super({
      preset: 'intent-indexer',     // OpenRouter preset
      responseFormat: IntentIndexerOutputSchema,
      temperature: 0.1,              // Deterministic evaluation
    });
  }

  async evaluate(
    intent: string,
    indexPrompt: string | null,
    memberPrompt: string | null,
    sourceName?: string | null
  ): Promise<IntentIndexerOutput | null>
}
```

### Output Schema

```typescript
{
  indexScore: number,    // 0.0-1.0: Index appropriateness
  memberScore: number,   // 0.0-1.0: Member preference match
  reasoning: string      // Brief explanation for scores
}
```

### System Prompt

The agent uses the following evaluation rubric:

| Score Range | Interpretation |
|-------------|---------------|
| 0.9 - 1.0 | Highly appropriate, perfect match |
| 0.7 - 0.8 | Good match, relevant |
| 0.5 - 0.6 | Moderate, borderline |
| 0.3 - 0.4 | Low appropriateness, poor fit |
| 0.0 - 0.2 | Not appropriate |

### Key Design Decisions

1. **Low Temperature (0.1)**: Ensures deterministic, consistent evaluations
2. **Structured Output**: Zod schema guarantees valid response format
3. **Dual Scoring**: Separates index-level and member-level appropriateness
4. **Source Context**: Optional source name provides additional context for evaluation

---

## 3. Event-Driven Auto-Assignment

### Event System

Location: `protocol/src/lib/events.ts`

The auto-assignment system is **fully event-driven**, reacting to changes in intents, indexes, and member settings.

### Event Types

#### IntentEvents

| Event | Trigger | Action |
|-------|---------|--------|
| `onCreated` | New intent created | Queue evaluation for all eligible indexes |
| `onUpdated` | Intent payload modified | Re-evaluate for all eligible indexes |
| `onArchived` | Intent archived | Trigger context brokers (cleanup) |

#### IndexEvents

| Event | Trigger | Action |
|-------|---------|--------|
| `onPromptUpdated` | Index prompt changed | Re-evaluate all member intents in index |

#### MemberEvents

| Event | Trigger | Action |
|-------|---------|--------|
| `onSettingsUpdated` | Member prompt or autoAssign changed | Re-evaluate all user's intents for that index |

### Priority System

Events use prioritized queuing to ensure responsive user experience:

| Priority | Event Type | Rationale |
|----------|-----------|-----------|
| 8 (Highest) | Intent created/updated | Time-sensitive user action |
| 6 (Medium) | Member settings updated | User configuration change |
| 4 (Lowest) | Index prompt updated | Background maintenance |

### Eligibility Criteria

An intent is eligible for auto-assignment evaluation when:

1. User is a **member** of the index (`indexMembers` record exists)
2. Member has **`autoAssign = true`**
3. Index is **not deleted** (`deletedAt IS NULL`)
4. Intent is **not archived** (`archivedAt IS NULL`)

---

## 4. Scoring Algorithm

### Threshold

```typescript
const QUALIFICATION_THRESHOLD = 0.7;
```

### Decision Matrix

The scoring algorithm handles four scenarios:

| Index Prompt | Member Prompt | Evaluation Logic |
|-------------|---------------|-----------------|
| ✓ | ✓ | Both must score > 0.7; final = `(indexScore × 0.6) + (memberScore × 0.4)` |
| ✓ | ✗ | Only indexScore must be > 0.7 |
| ✗ | ✓ | Only memberScore must be > 0.7 |
| ✗ | ✗ | Auto-match (score = 1.0) |

### Assignment Logic

```typescript
if (finalScore > QUALIFICATION_THRESHOLD) {
  if (!currentlyAssigned) {
    // Add intent to index
    await db.insert(intentIndexes).values({ intentId, indexId });
  }
} else {
  if (currentlyAssigned) {
    // Remove intent from index
    await db.delete(intentIndexes).where(...);
  }
}
```

### Weighted Scoring Rationale

When both prompts exist, the index prompt receives 60% weight and member prompt 40% because:

1. **Community coherence** - Index-level appropriateness ensures community relevance
2. **Member autonomy** - Member preferences still influence final decision
3. **Quality control** - Prevents inappropriate intents even if member wants to share

---

## 5. Queue Processing

### Queue Configuration

Location: `protocol/src/queues/intent.queue.ts`

| Setting | Value |
|---------|-------|
| Queue Name | `intent-processing-queue` |
| Job Type | `index_intent` |
| Default Concurrency | 1 (sequential) |
| Retries | 3 with exponential backoff |
| Completed Cleanup | 24 hours |
| Failed Cleanup | 7 days |

### Job Data Structure

```typescript
{
  intentId: string,    // The intent to evaluate
  indexId: string,     // The target index
  userId: string       // For per-user queuing
}
```

### Processing Flow

1. **Job Added** → Event triggers (IntentEvents, IndexEvents, MemberEvents)
2. **Queue Processing** → BullMQ worker picks up job
3. **Service Call** → `IntentService.processIntentForIndex(intentId, indexId)`
4. **Agent Evaluation** → `IntentIndexer.evaluate(...)` called
5. **DB Operation** → Insert or delete `intentIndexes` record
6. **Job Complete** → Status updated, cleanup scheduled

### Synchronization

For user-initiated events (intent create/update), the system **waits for indexing jobs to complete** before triggering context brokers:

```typescript
const WAIT_TIMEOUT_MS = 60000; // 60 second timeout

await Promise.all(
  indexingJobs.map(job =>
    job.waitUntilFinished(queueEvents, WAIT_TIMEOUT_MS)
      .catch(error => null)  // Continue even if some fail
  )
);

// Brokers triggered after indexing complete
await triggerBrokersOnIntentCreated(event.intentId);
```

---

## 6. Service Layer Integration

### IntentService

Location: `protocol/src/services/intent.service.ts`

The `processIntentForIndex` method orchestrates the evaluation:

```typescript
static async processIntentForIndex(intentId: string, indexId: string): Promise<void> {
  // 1. Fetch intent details (payload, userId, sourceType, sourceId)
  const intent = await db.query.intents.findFirst({ where: eq(intents.id, intentId) });
  
  // 2. Fetch index and member context
  const indexMember = await db.query.indexMembers.findFirst({
    where: and(
      eq(indexMembers.indexId, indexId),
      eq(indexMembers.userId, intent.userId),
      eq(indexMembers.autoAssign, true)
    ),
    with: { index: true }
  });
  
  // 3. Check current assignment status
  const isCurrentlyAssigned = await db.query.intentIndexes.findFirst({
    where: and(
      eq(intentIndexes.intentId, intentId),
      eq(intentIndexes.indexId, indexId)
    )
  });
  
  // 4. Run LLM evaluation
  const indexer = new IntentIndexer();
  const result = await indexer.evaluate(
    intent.payload,
    indexMember.index.prompt,
    indexMember.prompt,
    getSourceName(intent.sourceType, intent.sourceId)
  );
  
  // 5. Apply scoring logic and persist decision
  const finalScore = computeFinalScore(result, indexMember);
  
  if (finalScore > QUALIFICATION_THRESHOLD && !isCurrentlyAssigned) {
    await db.insert(intentIndexes).values({ intentId, indexId });
  } else if (finalScore <= QUALIFICATION_THRESHOLD && isCurrentlyAssigned) {
    await db.delete(intentIndexes).where(...);
  }
}
```

### IndexService

Location: `protocol/src/services/index.service.ts`

Provides eligibility queries:

```typescript
async getEligibleIndexesForUser(userId: string): Promise<Index[]> {
  return db.query.indexes.findMany({
    where: and(
      exists(
        db.select().from(indexMembers)
          .where(and(
            eq(indexMembers.indexId, indexes.id),
            eq(indexMembers.userId, userId),
            eq(indexMembers.autoAssign, true)
          ))
      ),
      isNull(indexes.deletedAt)
    )
  });
}
```

---

## 7. Flow Diagrams

### Intent Creation → Auto-Assignment

```
┌─────────────────┐
│  User creates   │
│     intent      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ IntentService.  │
│ createIntent()  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ IntentEvents.   │
│   onCreated()   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Find eligible indexes          │
│  (user is member, autoAssign)   │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────┐
│  Queue jobs     │──────────────────┐
│  (priority: 8)  │                  │
└────────┬────────┘                  │
         │                           │
         ▼                           ▼
┌─────────────────┐         ┌─────────────────┐
│  index_intent   │         │  index_intent   │
│    job (A)      │         │    job (B)      │
└────────┬────────┘         └────────┬────────┘
         │                           │
         ▼                           ▼
┌─────────────────────────────────────────────┐
│      IntentService.processIntentForIndex()   │
└────────┬────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│ IntentIndexer.  │◄──── LLM Call
│   evaluate()    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Score > 0.7?                   │
│  ├─ Yes: Insert intentIndexes   │
│  └─ No:  Skip (or remove)       │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────┐
│ Context Brokers │
│   triggered     │
└─────────────────┘
```

### Index Prompt Update → Re-evaluation

```
┌─────────────────┐
│  Owner updates  │
│  index prompt   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ IndexEvents.    │
│ onPromptUpdated │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Get all member intents         │
│  (autoAssign = true)            │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────┐
│  Queue jobs     │
│  (priority: 4)  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Re-evaluate each intent        │
│  with new index prompt          │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Update intentIndexes           │
│  (add/remove based on score)    │
└─────────────────────────────────┘
```

### Member Settings Update → Re-evaluation

```
┌─────────────────┐
│  Member updates │
│  prompt/auto    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ MemberEvents.   │
│ onSettings      │
│ Updated         │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Get all user's active intents  │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────┐
│  Queue jobs     │
│  (priority: 6)  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Re-evaluate intents            │
│  with new member prompt         │
└─────────────────────────────────┘
```

---

## 8. API & Frontend Integration

### Key API Endpoints

| Endpoint | Purpose | Agentic Impact |
|----------|---------|---------------|
| `PUT /indexes/:id` | Update index | Triggers `IndexEvents.onPromptUpdated` if prompt changes |
| `PUT /indexes/:id/member-settings` | Update member settings | Triggers `MemberEvents.onSettingsUpdated` |
| `POST /intents` | Create intent | Triggers `IntentEvents.onCreated` → auto-assignment |
| `PUT /intents/:id` | Update intent | Triggers `IntentEvents.onUpdated` → re-evaluation |

### Frontend Components

| Component | Agentic Feature |
|-----------|-----------------|
| **MemberSettingsModal** | Toggle `autoAssign`, edit member `prompt`, view indexed intents with real-time updates |
| **Admin Settings (Index)** | Edit index `prompt` (triggers re-evaluation for all members) |
| **CreateIndexModal** | Set initial index `prompt` (defines community scope for LLM evaluation) |

### Real-Time Updates

The frontend polls member intents every second in MemberSettingsModal:

```typescript
useEffect(() => {
  const interval = setInterval(refreshMemberIntents, 1000);
  return () => clearInterval(interval);
}, []);
```

This provides users with immediate feedback as intents are auto-assigned.

---

## 9. Future Considerations

### Potential Graph Implementation

While Index Management currently uses a service-based approach, a future **Index Graph** could provide:

1. **Batch Evaluation** - Process multiple intent-index pairs in one graph invocation
2. **Conditional Routing** - Skip evaluation when no prompts exist (direct auto-match)
3. **Parallel Processing** - Evaluate against multiple indexes concurrently
4. **State Tracking** - Maintain evaluation history for audit/debugging

### Proposed Graph Structure

```typescript
// index.graph.state.ts
export const IndexGraphState = Annotation.Root({
  // Inputs
  intentId: Annotation<string>,
  indexIds: Annotation<string[]>,
  userId: Annotation<string>,
  
  // Intermediate
  evaluations: Annotation<IntentIndexerOutput[]>({
    reducer: (curr, next) => [...curr, ...next],
    default: () => [],
  }),
  
  // Output
  assignments: Annotation<{ indexId: string; assigned: boolean }[]>
});
```

### Other Enhancements

| Enhancement | Description |
|-------------|-------------|
| **Caching** | Cache evaluation results for identical intent-prompt pairs |
| **Confidence Decay** | Re-evaluate low-confidence assignments periodically |
| **Feedback Loop** | Use manual corrections to improve LLM evaluation |
| **Bulk Operations** | Process intent bulk uploads more efficiently |

---

## Summary

The Index Management agentic architecture provides:

1. **Intelligent Curation** - LLM-based evaluation ensures relevant intent-index matches
2. **Event-Driven Reactivity** - Automatic re-evaluation on any relevant change
3. **Dual-Scoring System** - Balances community coherence with member preferences
4. **Prioritized Processing** - User actions processed immediately; background tasks deferred
5. **Privacy Scoping** - Intent visibility limited to shared index membership

The current implementation uses a **service + event + queue** pattern that is effective for the current scale. As the system grows, a dedicated **Index Graph** could provide additional optimization and observability benefits.

---

## Related Files

| Category | File |
|----------|------|
| **Agent** | `agents/intent/indexer/intent.indexer.ts` |
| **Types** | `agents/intent/indexer/intent.indexer.types.ts` |
| **Events** | `lib/events.ts` |
| **Queue** | `queues/intent.queue.ts` |
| **Service** | `services/intent.service.ts` |
| **Service** | `services/index.service.ts` |
| **Routes** | `routes/indexes.ts` |
| **Schema** | `schemas/database.schema.ts` (tables: indexes, indexMembers, intentIndexes) |
| **Access Control** | `lib/index-access.ts` |

---

## Appendix: OpenRouter Configuration

The IntentIndexer agent uses the `intent-indexer` OpenRouter preset.

**Recommended Configuration:**
- Model: Latest instruction-following model (e.g., Claude, GPT-4)
- Temperature: 0.1 (configured in agent)
- Max Tokens: ~500 (short structured output)

Configure at: https://openrouter.ai/settings/presets
