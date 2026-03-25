# My Network Discovery Scoping (IND-136)

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** When a user searches "in my network" or selects "My Network" from the dropdown, scope discovery to only their contacts (personal index members), searching across all joined indexes but filtering candidates to contacts only.

**Architecture:** Add an `allowedUserIds` filter to the embedder search interface. The opportunity tool detects personal-index scoping (via `indexId` or a new `networkOnly` param) and resolves contact user IDs, then passes them through the graph to the embedder. The frontend renames the personal index entry in the scope dropdown to "My Network".

**Tech Stack:** TypeScript, Drizzle ORM (pgvector), LangGraph, React

---

## Key Insight

Contacts are stored as `index_members` with `'contact'` permission on the user's personal index. But contacts' intents/profiles live in OTHER indexes the contacts have joined. So scoping discovery to just the personal index would miss most data. Instead, we search across ALL the user's joined indexes but filter candidates to only contact user IDs.

## Data Flow

```
User says "find AI engineers in my network"
  → LLM calls create_opportunities(searchQuery="AI engineers", networkOnly=true)
    → Tool resolves contact userIds from personal index
    → Tool sets indexScope = ALL user's indexes (not just personal)
    → runDiscoverFromQuery passes allowedUserIds to graph
      → Graph discovery node passes allowedUserIds to embedder
        → Embedder adds WHERE userId IN (allowedUserIds) to SQL
          → Only contacts returned as candidates
```

---

### Task 1: Add `allowedUserIds` to Embedder Interface and Adapter

**Files:**
- Modify: `protocol/src/lib/protocol/interfaces/embedder.interface.ts`
- Modify: `protocol/src/adapters/embedder.adapter.ts`

**Step 1: Update `HydeSearchOptions` interface**

In `protocol/src/lib/protocol/interfaces/embedder.interface.ts`, add `allowedUserIds` to `HydeSearchOptions`:

```typescript
export interface HydeSearchOptions {
  indexScope: string[];
  excludeUserId?: string;
  /** When set, only return candidates whose userId is in this list. Used for "My Network" scoping. */
  allowedUserIds?: string[];
  limitPerStrategy?: number;
  limit?: number;
  minScore?: number;
  profileMinScore?: number;
}
```

**Step 2: Thread `allowedUserIds` through embedder adapter**

In `protocol/src/adapters/embedder.adapter.ts`:

a. In `searchWithHydeEmbeddings`, extract `allowedUserIds` from options and pass it in the `filter` object:

```typescript
const { indexScope, excludeUserId, allowedUserIds, limitPerStrategy = 40, limit = 80, ... } = options;
const filter = { indexScope, excludeUserId, allowedUserIds };
```

b. In `searchWithProfileEmbedding`, same pattern — extract and pass through.

c. In private methods `searchProfilesForHyde`, `searchIntentsForHyde`, `searchProfilesByProfileEmbedding`, `searchIntentsByProfileEmbedding`:
- Update `filter` type: `{ indexScope: string[]; excludeUserId?: string; allowedUserIds?: string[] }`
- Add SQL condition when `allowedUserIds` is set:
  ```typescript
  ...(filter.allowedUserIds?.length ? [inArray(userProfiles.userId, filter.allowedUserIds)] : []),
  ```
  (For intent searches, use `inArray(intents.userId, filter.allowedUserIds)`)

**Step 3: Run tsc to verify**

Run: `cd protocol && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/interfaces/embedder.interface.ts protocol/src/adapters/embedder.adapter.ts
git commit -m "feat(IND-136): add allowedUserIds filter to embedder search"
```

---

### Task 2: Add `allowedUserIds` to Opportunity Graph State and Discovery Node

**Files:**
- Modify: `protocol/src/lib/protocol/states/opportunity.state.ts`
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts`

**Step 1: Add `allowedUserIds` to `OpportunityGraphState`**

In `protocol/src/lib/protocol/states/opportunity.state.ts`, add a new annotation after `targetUserId`:

```typescript
/** Optional: restrict discovery candidates to these user IDs only (e.g. contacts for "My Network"). */
allowedUserIds: Annotation<Id<'users'>[] | undefined>({
  reducer: (curr, next) => next ?? curr,
  default: () => undefined,
}),
```

**Step 2: Thread `allowedUserIds` into embedder calls in discovery node**

In `protocol/src/lib/protocol/graphs/opportunity.graph.ts`, in the `discoveryNode`:

Every call to `this.embedder.searchWithHydeEmbeddings(...)` and `this.embedder.searchWithProfileEmbedding(...)` needs to pass `allowedUserIds` from state. Find all embedder calls in the discovery node and add the field:

```typescript
// Example: in searchWithHydeEmbeddings call
const results = await this.embedder.searchWithHydeEmbeddings(lensEmbeddings, {
  indexScope: [targetIndex.indexId],
  excludeUserId: discoveryUserId,
  allowedUserIds: state.allowedUserIds,  // ← ADD THIS
  limitPerStrategy,
  limit: perIndexLimit,
  minScore,
});
```

Do the same for every `searchWithProfileEmbedding` call.

**Step 3: Add trace entry for network-only mode**

In the discovery node, add a trace entry when `allowedUserIds` is set:

```typescript
if (state.allowedUserIds?.length) {
  traceEntries.push({
    node: "discovery_filter",
    detail: `Network-only: filtering to ${state.allowedUserIds.length} contact(s)`,
  });
}
```

**Step 4: Run tsc to verify**

Run: `cd protocol && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/states/opportunity.state.ts protocol/src/lib/protocol/graphs/opportunity.graph.ts
git commit -m "feat(IND-136): thread allowedUserIds through opportunity graph discovery"
```

---

### Task 3: Add `networkOnly` Param to create_opportunities Tool

**Files:**
- Modify: `protocol/src/lib/protocol/tools/opportunity.tools.ts`
- Modify: `protocol/src/lib/protocol/support/opportunity.discover.ts`

**Step 1: Add `networkOnly` to tool schema**

In `protocol/src/lib/protocol/tools/opportunity.tools.ts`, in `createOpportunities` tool's `querySchema`, add:

```typescript
networkOnly: z
  .boolean()
  .optional()
  .describe(
    "When true, restrict discovery to the user's contacts (\"My Network\"). " +
    "Use when the user says \"in my network\", \"from my contacts\", \"people I know\", etc."
  ),
```

**Step 2: Resolve contact userIds and adjust scope when networkOnly or personal index**

In the discovery mode section of `createOpportunities` handler (after `indexScope` is computed, around line 537), add logic to detect network-only mode and resolve contacts:

```typescript
// ── Network-only mode: detect personal index or explicit networkOnly flag ──
let allowedUserIds: string[] | undefined;

const isNetworkOnly = query.networkOnly === true;
// Also detect if the scoped index is the user's personal index
let isPersonalIndexScope = false;
if (effectiveIndexId) {
  const indexRecord = await database.getIndex(effectiveIndexId);
  if (indexRecord?.isPersonal) {
    isPersonalIndexScope = true;
  }
}

if (isNetworkOnly || isPersonalIndexScope) {
  // Get contact user IDs from the user's personal index
  const contacts = await database.getContactMembers(context.userId);
  allowedUserIds = contacts.map(c => c.userId);

  if (allowedUserIds.length === 0) {
    return success({
      found: false,
      count: 0,
      message: "You don't have any contacts in your network yet. Import contacts or connect with people to build your network.",
      summary: "No contacts in network",
    });
  }

  // When personal index was selected, expand scope to ALL user's indexes
  // so we search contacts' data wherever it lives (not just the personal index)
  if (isPersonalIndexScope) {
    const indexResult = await graphs.index.invoke({
      userId: context.userId,
      operationMode: "read" as const,
      showAll: true,
    });
    indexScope = (indexResult.readResult?.memberOf || []).map(
      (m: { indexId: string }) => m.indexId,
    );
  }
}
```

**Step 3: Pass `allowedUserIds` to `runDiscoverFromQuery`**

Update the `runDiscoverFromQuery` call to include `allowedUserIds`:

```typescript
const result = await runDiscoverFromQuery({
  opportunityGraph: graphs.opportunity,
  database,
  userId: context.userId,
  query: searchQuery,
  indexScope,
  limit: 20,
  minimalForChat: true,
  triggerIntentId,
  targetUserId: query.targetUserId?.trim() || undefined,
  onBehalfOfUserId: query.introTargetUserId?.trim() || undefined,
  cache,
  allowedUserIds,  // ← ADD THIS
  ...(context.sessionId ? { chatSessionId: context.sessionId } : {}),
});
```

**Step 4: Update `DiscoverInput` and `runDiscoverFromQuery` to pass `allowedUserIds` through**

In `protocol/src/lib/protocol/support/opportunity.discover.ts`:

a. Add `allowedUserIds` to `DiscoverInput` interface:
```typescript
export interface DiscoverInput {
  // ... existing fields ...
  /** When set, restrict candidates to these user IDs (e.g. contacts for "My Network"). */
  allowedUserIds?: string[];
}
```

b. In `runDiscoverFromQuery`, extract and pass to graph invoke:
```typescript
const { ..., allowedUserIds } = input;
// ...
const result = await opportunityGraph.invoke({
  userId,
  searchQuery: queryOrEmpty || undefined,
  indexId: indexScope.length === 1 ? indexScope[0] : undefined,
  triggerIntentId,
  targetUserId,
  onBehalfOfUserId,
  allowedUserIds,  // ← ADD THIS
  options,
});
```

**Step 5: Update tool description to mention network scoping**

Update the `create_opportunities` tool description to guide the LLM:

Add to the description string:
```
"5. **Network-only**: pass networkOnly=true to search only the user's contacts. " +
"Use when the user says 'in my network', 'from my contacts', 'people I know', etc.\n\n" +
```

**Step 6: Run tsc to verify**

Run: `cd protocol && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add protocol/src/lib/protocol/tools/opportunity.tools.ts protocol/src/lib/protocol/support/opportunity.discover.ts
git commit -m "feat(IND-136): add networkOnly param to create_opportunities tool"
```

---

### Task 4: Update `continueDiscovery` to Preserve `allowedUserIds`

**Files:**
- Modify: `protocol/src/lib/protocol/support/opportunity.discover.ts`

**Step 1: Add `allowedUserIds` to `CachedDiscoverySession`**

In `opportunity.discover.ts`, update the `CachedDiscoverySession` interface:

```typescript
interface CachedDiscoverySession {
  candidates: CandidateMatch[];
  userId: string;
  onBehalfOfUserId?: string;
  query: string;
  indexScope: string[];
  options: OpportunityGraphOptions;
  allowedUserIds?: string[];  // ← ADD THIS
}
```

**Step 2: Store `allowedUserIds` in cache**

In `runDiscoverFromQuery`, when caching remaining candidates:

```typescript
await input.cache.set(cacheKey, {
  candidates: remainingCandidates,
  userId,
  onBehalfOfUserId,
  query: queryOrEmpty,
  indexScope,
  options,
  allowedUserIds: input.allowedUserIds,  // ← ADD THIS
} satisfies CachedDiscoverySession, { ttl: 1800 });
```

**Step 3: Pass `allowedUserIds` from cache in `continueDiscovery`**

In `continueDiscovery`, pass `allowedUserIds` from cached session to graph:

```typescript
const result = await opportunityGraph.invoke({
  userId,
  searchQuery: cached.query || undefined,
  candidates: cached.candidates,
  operationMode: 'continue_discovery' as const,
  onBehalfOfUserId: cached.onBehalfOfUserId,
  allowedUserIds: cached.allowedUserIds,  // ← ADD THIS
  options: { ... },
});
```

**Step 4: Run tsc to verify**

Run: `cd protocol && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/support/opportunity.discover.ts
git commit -m "feat(IND-136): preserve allowedUserIds in discovery pagination cache"
```

---

### Task 5: Frontend — Rename Personal Index to "My Network" in Dropdown

**Files:**
- Modify: `frontend/src/components/ChatContent.tsx`

**Step 1: Change the personal index label in the dropdown**

In `frontend/src/components/ChatContent.tsx`, find the personal index button in the scope dropdown (around line 1084). Change:

```tsx
<Users className="w-4 h-4" /> {personalIndex.title}
```

to:

```tsx
<Users className="w-4 h-4" /> My Network
```

**Step 2: Update the selected state display**

In the scope dropdown trigger button (around line 1038-1041), when the personal index is selected, update the display text. Change:

```tsx
<span>
  {selectedIndex?.title || "Everywhere"}
</span>
```

to:

```tsx
<span>
  {selectedIndex?.isPersonal ? "My Network" : (selectedIndex?.title || "Everywhere")}
</span>
```

**Step 3: Verify frontend builds**

Run: `cd frontend && bun run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add frontend/src/components/ChatContent.tsx
git commit -m "feat(IND-136): rename personal index to 'My Network' in scope dropdown"
```

---

### Task 6: Add `getIndex` to OpportunityGraphDatabase interface (if needed)

**Files:**
- Check: `protocol/src/lib/protocol/interfaces/database.interface.ts`
- Check: `protocol/src/lib/protocol/tools/opportunity.tools.ts`

The tool handler calls `database.getIndex(effectiveIndexId)` in Task 3. Verify this method exists on the `ToolDeps.database` type. If not, check what interface the `database` object in tool deps uses and ensure `getIndex` is available.

Also verify `database.getContactMembers(userId)` is available on the tool deps database type. If it's only on `ChatDatabaseAdapter`, you may need to add it to the relevant interface or use the service directly.

**Step 1: Verify types compile**

Run: `cd protocol && npx tsc --noEmit`

If there are type errors for `getIndex` or `getContactMembers`, trace the `ToolDeps.database` type and add the missing methods to its interface.

**Step 2: Commit any interface additions**

```bash
git add protocol/src/lib/protocol/interfaces/database.interface.ts
git commit -m "feat(IND-136): add getContactMembers to tool database interface"
```

---

### Task 7: Write Integration Test

**Files:**
- Create: `protocol/tests/network-discovery.test.ts`

**Step 1: Write a test that verifies `allowedUserIds` filtering**

Test the embedder adapter's search methods with `allowedUserIds` set. Verify that:
1. Without `allowedUserIds`, candidates from any user are returned
2. With `allowedUserIds`, only those users' results are returned

Also test the tool's network-only detection logic:
1. When `networkOnly: true` is passed, contacts are resolved
2. When a personal index is passed as `indexId`, network-only mode activates

**Step 2: Run test**

Run: `cd protocol && bun test tests/network-discovery.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add protocol/tests/network-discovery.test.ts
git commit -m "test(IND-136): add network-only discovery integration tests"
```

---

## Read-Path Checklist

The `allowedUserIds` field is added to:
- `HydeSearchOptions` interface (embedder) — consumed by embedder adapter, no serialization
- `OpportunityGraphState` (graph state) — consumed by discovery node, no external serialization
- `CachedDiscoverySession` (Redis cache) — serialized to JSON, read back in `continueDiscovery`
- `DiscoverInput` (function param) — not serialized

**Consumers checked:**
- `continueDiscovery` reads from `CachedDiscoverySession` — updated in Task 4
- No explicit field mapping that would drop the field (uses spread/satisfies)

## Notes

- The `networkOnly` param is the primary mechanism for LLM-driven detection ("in my network" language)
- Personal index detection via `isPersonal` flag is the automatic mechanism when user selects "My Network" from the UI dropdown
- Both paths converge to the same logic: resolve contacts → set `allowedUserIds` → expand scope to all indexes
- When `allowedUserIds` is empty (no contacts), we return an early message instead of searching with no filter
