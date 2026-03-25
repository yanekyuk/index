# Opportunity Discovery Relevance Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix opportunity discovery so the LensInferrer receives the discoverer's profile and intents, producing targeted lenses that find genuinely complementary contacts instead of same-domain but wrong-role matches.

**Architecture:** Wire `profileContext` (already supported by the HyDE graph state and LensInferrer) through both chat and background discovery paths. Add same-side match detection to the evaluator prompt as defense-in-depth.

**Tech Stack:** TypeScript, LangGraph, Bun test

---

### Task 1: Add `profileContext` to `HydeGeneratorInvokeInput` type

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts:69-73`

**Step 1: Update the type**

```typescript
/** Input shape for the HyDE graph invoke call (query-based embedding). */
export interface HydeGeneratorInvokeInput {
  sourceType: 'query';
  sourceText: string;
  forceRegenerate?: boolean;
  /** Discoverer's profile + intents context for LensInferrer. */
  profileContext?: string;
}
```

**Step 2: Commit**

```bash
cd protocol
git add src/lib/protocol/graphs/opportunity.graph.ts
git commit -m "fix(opportunity): add profileContext to HydeGeneratorInvokeInput"
```

---

### Task 2: Add helper to build discoverer context string

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts` (add helper before `createGraph`)

**Step 1: Write the helper function**

Add this function after the imports, before the `OpportunityGraphFactory` class (around line 65):

```typescript
/**
 * Build a discoverer context string from profile and intents for LensInferrer.
 * Gives the LensInferrer awareness of WHO is searching, not just WHAT they searched for.
 */
function buildDiscovererContext(
  profile: { identity?: { name?: string; bio?: string }; narrative?: { context?: string }; attributes?: { interests?: string[]; skills?: string[] } } | null | undefined,
  intents: Array<{ payload: string; summary?: string }>,
): string | undefined {
  const parts: string[] = [];

  if (profile) {
    const { identity, attributes } = profile;
    if (identity?.name || identity?.bio) {
      parts.push(`Profile: ${[identity.name, identity.bio].filter(Boolean).join(', ')}`);
    }
    if (attributes?.skills?.length) {
      parts.push(`Skills: ${attributes.skills.join(', ')}`);
    }
    if (attributes?.interests?.length) {
      parts.push(`Interests: ${attributes.interests.join(', ')}`);
    }
  }

  if (intents.length > 0) {
    parts.push('');
    parts.push('Active intents:');
    for (const intent of intents.slice(0, 5)) {
      parts.push(`- ${intent.payload}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : undefined;
}
```

**Step 2: Commit**

```bash
cd protocol
git add src/lib/protocol/graphs/opportunity.graph.ts
git commit -m "fix(opportunity): add buildDiscovererContext helper"
```

---

### Task 3: Pass profileContext in chat discovery path

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts:614-622` (`runQueryHydeDiscovery`)

**Step 1: Build context and pass to HyDE invoke**

In `runQueryHydeDiscovery()` (line ~614), before the `self.hydeGenerator.invoke` call, build the context and pass it:

```typescript
async function runQueryHydeDiscovery(): Promise<CandidateMatch[]> {
  const searchText = state.searchQuery?.trim() ?? '';
  if (!searchText) return [];
  logger.verbose('[Graph:Discovery] runQueryHydeDiscovery start', { searchText: searchText.slice(0, 80) });
  const discovererContext = buildDiscovererContext(state.sourceProfile, state.indexedIntents);
  const hydeResult = await self.hydeGenerator.invoke({
    sourceType: 'query',
    sourceText: searchText,
    forceRegenerate: false,
    profileContext: discovererContext,
  });
```

**Step 2: Commit**

```bash
cd protocol
git add src/lib/protocol/graphs/opportunity.graph.ts
git commit -m "fix(opportunity): pass discoverer context in chat HyDE path"
```

---

### Task 4: Pass profileContext in intent discovery path

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts:700-704` (intent path HyDE invoke)

**Step 1: Build context and pass to HyDE invoke**

In the intent path (line ~700), same pattern:

```typescript
const discovererContext = buildDiscovererContext(state.sourceProfile, state.indexedIntents);
const hydeResult = await this.hydeGenerator.invoke({
  sourceType: 'query',
  sourceText: searchText,
  forceRegenerate: false,
  profileContext: discovererContext,
});
```

**Step 2: Commit**

```bash
cd protocol
git add src/lib/protocol/graphs/opportunity.graph.ts
git commit -m "fix(opportunity): pass discoverer context in intent HyDE path"
```

---

### Task 5: Pass profileContext in background intent queue

**Files:**
- Modify: `protocol/src/queues/intent.queue.ts:265-284` (`handleGenerateHyde`)

**Step 1: Fetch profile and intents, build context, pass to HyDE graph**

The intent queue needs to fetch the user's profile and intents since they aren't available in graph state here. Add this before the HyDE graph invocation (around line 265):

```typescript
// Fetch discoverer context for LensInferrer
let profileContext: string | undefined;
try {
  const [profile, activeIntents] = await Promise.all([
    db.getProfile(userId),
    db.getActiveIntents(userId),
  ]);
  const parts: string[] = [];
  if (profile) {
    const { identity, attributes } = profile;
    if (identity?.name || identity?.bio) {
      parts.push(`Profile: ${[identity.name, identity.bio].filter(Boolean).join(', ')}`);
    }
    if (attributes?.skills?.length) {
      parts.push(`Skills: ${attributes.skills.join(', ')}`);
    }
    if (attributes?.interests?.length) {
      parts.push(`Interests: ${attributes.interests.join(', ')}`);
    }
  }
  if (activeIntents.length > 0) {
    parts.push('');
    parts.push('Active intents:');
    for (const i of activeIntents.slice(0, 5)) {
      parts.push(`- ${i.payload}`);
    }
  }
  if (parts.length > 0) profileContext = parts.join('\n');
} catch (err) {
  this.logger.warn('[IntentHyde] Failed to fetch discoverer context for LensInferrer', { userId, error: err });
}
```

Then update both HyDE invocation sites to pass it:

```typescript
// deps path (line ~266)
await this.deps.invokeHyde({
  sourceText: intent.payload,
  sourceType: 'intent',
  sourceId: intentId,
  forceRegenerate: true,
  profileContext,
});

// fallback path (line ~278)
await hydeGraph.invoke({
  sourceText: intent.payload,
  sourceType: 'intent',
  sourceId: intentId,
  forceRegenerate: true,
  profileContext,
});
```

**Step 2: Check that the `invokeHyde` dep type allows `profileContext`**

The `deps.invokeHyde` type is inferred from the constructor. Verify its type signature includes `profileContext`. If not, update the type in the intent queue's dependency type to include `profileContext?: string`.

**Step 3: Commit**

```bash
cd protocol
git add src/queues/intent.queue.ts
git commit -m "fix(opportunity): pass discoverer context in background HyDE path"
```

---

### Task 6: Write test — discoverer context is passed to HyDE graph

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`

**Step 1: Write the failing test**

Add a new test in the existing `describe` block that verifies the HyDE generator receives `profileContext`:

```typescript
test('passes discoverer profileContext to HyDE generator', async () => {
  let capturedInput: Record<string, unknown> | null = null;
  const { compiledGraph, mockHydeGenerator } = createMockGraph({
    getProfile: {
      identity: { name: 'Alice', bio: 'Founder of a DeFi protocol' },
      attributes: { skills: ['Solidity', 'Rust'], interests: ['DeFi', 'ZK'] },
      narrative: { context: 'Building decentralized finance tools' },
      embedding: dummyEmbedding,
    } as Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>,
  });

  // Spy on the HyDE generator to capture the input
  const originalInvoke = mockHydeGenerator.invoke;
  mockHydeGenerator.invoke = async (input: Record<string, unknown>) => {
    capturedInput = input;
    return originalInvoke(input);
  };

  await compiledGraph.invoke({
    userId: 'user-source' as Id<'users'>,
    searchQuery: 'find me investors',
  });

  expect(capturedInput).not.toBeNull();
  expect(capturedInput!.profileContext).toBeDefined();
  expect(capturedInput!.profileContext).toContain('Alice');
  expect(capturedInput!.profileContext).toContain('Founder of a DeFi protocol');
  expect(capturedInput!.profileContext).toContain('Active intents');
}, 30000);
```

**Step 2: Run test to verify it passes**

```bash
cd protocol
bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts -v
```

Expected: PASS (test verifies the wiring from Tasks 2-4)

**Step 3: Commit**

```bash
cd protocol
git add src/lib/protocol/graphs/tests/opportunity.graph.spec.ts
git commit -m "test(opportunity): verify discoverer context passed to HyDE graph"
```

---

### Task 7: Add same-side matching rule to evaluator base prompt

**Files:**
- Modify: `protocol/src/lib/protocol/agents/opportunity.evaluator.ts:82-123` (`entityBundleSystemPrompt`)

**Step 1: Add rule 7 after existing rule 6**

In the `entityBundleSystemPrompt` (line ~123, before the closing backtick), add:

```
7. SAME-SIDE MATCHING: Before scoring, check whether the DISCOVERER and CANDIDATE are both SEEKING the same thing. Look at both parties' intents for directionality:
   - SEEKING signals: "looking for", "seeking", "want to find", "need", "raising", "hiring"
   - OFFERING signals: "can offer", "expert in", "investing in", "mentoring", "available for"
   If both parties have SEEKING intents targeting the same resource (e.g., both seeking investors, both seeking co-founders, both seeking mentorship), this is NOT an opportunity — score <30. An opportunity requires one side to OFFER what the other SEEKS.
```

**Step 2: Commit**

```bash
cd protocol
git add src/lib/protocol/agents/opportunity.evaluator.ts
git commit -m "fix(evaluator): add same-side match detection to base prompt"
```

---

### Task 8: Add same-side check to discoveryQuery scoring rules

**Files:**
- Modify: `protocol/src/lib/protocol/agents/opportunity.evaluator.ts:377-389` (`discoveryQueryPart`)

**Step 1: Add rule 5 after existing rule 4**

In the `discoveryQueryPart` template string, after rule 4 (`DO NOT score collaborators/builders highly...`), add:

```
5. SAME-SIDE CHECK: If the candidate's intents show they are ALSO SEEKING what the discoverer is seeking (e.g., both looking for investors, both looking for co-founders), this is a same-side match. Score <30 regardless of keyword overlap in bios. The candidate must BE or OFFER what the discoverer is looking for, not also be looking for it.
```

**Step 2: Commit**

```bash
cd protocol
git add src/lib/protocol/agents/opportunity.evaluator.ts
git commit -m "fix(evaluator): add same-side check to discovery query rules"
```

---

### Task 9: Write test — evaluator rejects same-side matches

**Files:**
- Modify: `protocol/src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts`

**Step 1: Write the test**

Add a new test in the `invokeEntityBundle` describe block. This test uses a mock LLM to verify the prompt contains the same-side rule (unit test), not a live LLM call:

```typescript
it('includes same-side matching rule in entity bundle prompt', async () => {
  let capturedMessages: unknown[] = [];
  const mockEntityBundleModel = {
    invoke: async (messages: unknown[]) => {
      capturedMessages = messages;
      return { opportunities: [] };
    },
  } as unknown as Runnable;

  const evaluator = new OpportunityEvaluator({ entityBundleModel: mockEntityBundleModel });

  const input: EvaluatorInput = {
    discovererId: 'user-1',
    entities: [
      {
        userId: 'user-1',
        profile: { name: 'Alice', bio: 'Founder raising capital' },
        intents: [{ intentId: 'i1', payload: 'Looking for investors' }],
        indexId: 'idx-1',
      },
      {
        userId: 'user-2',
        profile: { name: 'Bob', bio: 'Founder raising capital' },
        intents: [{ intentId: 'i2', payload: 'Seeking investors for my startup' }],
        indexId: 'idx-1',
      },
    ],
    discoveryQuery: 'find me investors',
  };

  await evaluator.invokeEntityBundle(input, { minScore: 30 });

  // Verify the system prompt contains same-side matching rule
  const systemMsg = capturedMessages[0] as { content: string };
  expect(systemMsg.content).toContain('SAME-SIDE MATCHING');

  // Verify the human message contains same-side check in discovery query rules
  const humanMsg = capturedMessages[1] as { content: string };
  expect(humanMsg.content).toContain('SAME-SIDE CHECK');
}, 10000);
```

**Step 2: Run test**

```bash
cd protocol
bun test src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts -v
```

Expected: PASS

**Step 3: Commit**

```bash
cd protocol
git add src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts
git commit -m "test(evaluator): verify same-side matching rules in prompts"
```

---

### Task 10: Run all affected tests and verify

**Files:**
- Test: `protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`
- Test: `protocol/src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts`

**Step 1: Run opportunity graph tests**

```bash
cd protocol
bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts -v
```

Expected: All tests PASS

**Step 2: Run evaluator tests**

```bash
cd protocol
bun test src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts -v
```

Expected: All tests PASS

**Step 3: Run intent queue tests**

```bash
cd protocol
bun test src/queues/tests/intent.queue.spec.ts -v
```

Expected: All tests PASS (or existing skips unchanged)
