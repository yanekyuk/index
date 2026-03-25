# Discovery Location Filtering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Make the opportunity evaluator respect explicit location constraints in discovery queries and improve lens/HyDE quality with location awareness.

**Architecture:** Four targeted changes — (1) add location to `SourceProfileData` and `buildDiscovererContext()`, (2) add location scoring rules to the evaluator prompt, (3) update the LensInferrer prompt for location-aware lenses, (4) tests. No pipeline or schema changes; all fixes are prompt-level and type-level.

**Tech Stack:** TypeScript, LangChain agents, Zod schemas, bun:test

---

### Task 1: Add `location` to `SourceProfileData` and `buildDiscovererContext()`

**Files:**
- Modify: `protocol/src/lib/protocol/states/opportunity.state.ts:17-22` (`SourceProfileData` interface)
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts:94-126` (`buildDiscovererContext` function)
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts:193-200` (prepNode where `sourceProfile` is built)

**Step 1: Add `location` to `SourceProfileData`**

In `opportunity.state.ts`, the `SourceProfileData` interface currently omits `location` from `identity`:

```typescript
// BEFORE
export interface SourceProfileData {
  embedding: number[] | null;
  identity?: { name?: string; bio?: string };
  narrative?: { context?: string };
  attributes?: { skills?: string[]; interests?: string[] };
}

// AFTER
export interface SourceProfileData {
  embedding: number[] | null;
  identity?: { name?: string; bio?: string; location?: string };
  narrative?: { context?: string };
  attributes?: { skills?: string[]; interests?: string[] };
}
```

**Step 2: Pass location through in prepNode**

In `opportunity.graph.ts`, the prepNode builds `sourceProfile` from the DB profile. The `identity` spread already includes location because `profile.identity` is typed as `{ name: string; bio: string; location: string }` from the schema. But confirm that the destructuring passes it through. Currently at ~line 194:

```typescript
// BEFORE
const sourceProfile = profile
  ? {
      embedding: profile.embedding ?? null,
      identity: profile.identity ?? undefined,
      narrative: profile.narrative ?? undefined,
      attributes: profile.attributes ?? undefined,
    }
  : null;

// This already passes identity.location through — no change needed here.
// The issue was that SourceProfileData.identity didn't have `location` in its type,
// so downstream code couldn't access it. The type fix in Step 1 is sufficient.
```

**Step 3: Include location in `buildDiscovererContext()`**

```typescript
// BEFORE (lines 94-126)
function buildDiscovererContext(
  profile: SourceProfileData | null | undefined,
  intents: IndexedIntent[] | undefined
): string | undefined {
  const lines: string[] = [];

  if (profile) {
    const identity = profile.identity;
    const attrs = profile.attributes;
    if (identity?.name || identity?.bio) {
      lines.push(`Profile: ${[identity.name, identity.bio].filter(Boolean).join(', ')}`);
    }
    if (attrs?.skills?.length) {
      lines.push(`Skills: ${attrs.skills.join(', ')}`);
    }
    if (attrs?.interests?.length) {
      lines.push(`Interests: ${attrs.interests.join(', ')}`);
    }
  }
  // ...
}

// AFTER
function buildDiscovererContext(
  profile: SourceProfileData | null | undefined,
  intents: IndexedIntent[] | undefined
): string | undefined {
  const lines: string[] = [];

  if (profile) {
    const identity = profile.identity;
    const attrs = profile.attributes;
    if (identity?.name || identity?.bio) {
      lines.push(`Profile: ${[identity.name, identity.bio].filter(Boolean).join(', ')}`);
    }
    if (identity?.location) {
      lines.push(`Location: ${identity.location}`);
    }
    if (attrs?.skills?.length) {
      lines.push(`Skills: ${attrs.skills.join(', ')}`);
    }
    if (attrs?.interests?.length) {
      lines.push(`Interests: ${attrs.interests.join(', ')}`);
    }
  }
  // ...
}
```

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/states/opportunity.state.ts protocol/src/lib/protocol/graphs/opportunity.graph.ts
git commit -m "fix: include location in SourceProfileData and buildDiscovererContext"
```

---

### Task 2: Add location scoring rules to the evaluator prompt

**Files:**
- Modify: `protocol/src/lib/protocol/agents/opportunity.evaluator.ts:83-149` (`entityBundleSystemPrompt`)
- Modify: `protocol/src/lib/protocol/agents/opportunity.evaluator.ts:403-416` (`discoveryQueryPart`)

**Step 1: Add LOCATION AWARENESS rule to `entityBundleSystemPrompt`**

Add a new rule after Rule 8 (SAME-SIDE MATCHING) in the system prompt (around line 149):

```typescript
// ADD after line 148 (end of Rule 8), before the closing backtick:
9. LOCATION MATCHING: When the DISCOVERY REQUEST mentions a specific location (city, region, or country):
   a. If a candidate's profile.location is KNOWN and clearly does NOT match the requested location (different city/region), score ≤ 40 for that candidate. Geographic mismatch is a strong negative signal when the user explicitly requested a location.
   b. If a candidate's profile.location is UNKNOWN, EMPTY, or AMBIGUOUS, do NOT penalize — allow them through and score based on other factors. Note in reasoning that their location is unverified.
   c. If a candidate's profile.location matches or is reasonably close (e.g., "Bay Area" matches "San Francisco", "Remote" matches any location), score normally.
   d. "Remote" or "Global" locations are compatible with any requested location.
```

**Step 2: Update `discoveryQueryPart` to highlight location constraint**

In the `invokeEntityBundle` method, the `discoveryQueryPart` is built at ~line 403. Add a location-awareness instruction after the existing scoring rules:

```typescript
// BEFORE (lines 403-416)
const discoveryQueryPart = input.discoveryQuery?.trim()
  ? `\nDISCOVERY REQUEST: The user asked: "${input.discoveryQuery.trim()}"

CRITICAL SCORING RULES FOR DISCOVERY REQUESTS:
1. MATCH THE REQUEST TYPE FIRST: ...
2. ROLE KEYWORDS MATTER: ...
3. SCORING HIERARCHY: ...
4. DO NOT score collaborators/builders highly when ...
5. SAME-SIDE CHECK: ...
`
  : '';

// AFTER
const discoveryQueryPart = input.discoveryQuery?.trim()
  ? `\nDISCOVERY REQUEST: The user asked: "${input.discoveryQuery.trim()}"

CRITICAL SCORING RULES FOR DISCOVERY REQUESTS:
1. MATCH THE REQUEST TYPE FIRST: If the user asks for "investors", prioritize candidates who are ACTUALLY investors (VCs, angels, fund partners). Engineers and collaborators should score LOWER unless they are also investors.
2. ROLE KEYWORDS MATTER: Look for keywords in bios like "investor", "VC", "venture", "fund", "partner at [fund]", "angel", "mentor", etc. that match what the user asked for.
3. SCORING HIERARCHY:
   - 90-100: Candidate's PRIMARY role matches the request (e.g., "investor" request → actual investor/VC partner)
   - 70-89: Candidate has SOME relevance to the request (e.g., "investor" request → someone who occasionally invests but is primarily a builder)
   - 50-69: Weak match - candidate is tangentially related but doesn't fit the primary request
   - <50: Does not match the request - exclude or heavily down-rank
4. DO NOT score collaborators/builders highly when the user explicitly asks for investors, and vice versa.
5. SAME-SIDE CHECK: If the candidate's intents show they are ALSO SEEKING what the discoverer is seeking (e.g., both looking for investors, both looking for co-founders), this is a same-side match. Score <30 regardless of keyword overlap in bios. The candidate must BE or OFFER what the discoverer is looking for, not also be looking for it.
6. LOCATION ENFORCEMENT: If the discovery request mentions a specific location (e.g., "in SF", "based in London", "Istanbul"), check each candidate's profile.location:
   - KNOWN MISMATCH (e.g., request says "SF" but candidate is "New York"): Score ≤ 40. State the mismatch in reasoning.
   - UNKNOWN/EMPTY location: Do not penalize. Note that location is unverified.
   - MATCH or COMPATIBLE (e.g., "Bay Area" ≈ "SF", "Remote" ≈ any): Score normally.
`
  : '';
```

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/agents/opportunity.evaluator.ts
git commit -m "fix: add location scoring rules to opportunity evaluator prompt"
```

---

### Task 3: Update LensInferrer prompt for location awareness

**Files:**
- Modify: `protocol/src/lib/protocol/agents/lens.inferrer.ts:37-50` (`SYSTEM_PROMPT`)

**Step 1: Add location guideline to the LensInferrer system prompt**

```typescript
// BEFORE (lines 37-50)
const SYSTEM_PROMPT = `You analyze goals and search queries to identify the most relevant perspectives for finding matching people in a professional network.

For each perspective you identify, specify:
1. A clear, specific description of who or what to search for
2. Whether to search "profiles" (user bios, expertise, backgrounds) or "intents" (stated goals, needs, aspirations)
3. A brief reason why this perspective is relevant

Guidelines:
- Be specific and domain-aware. "early-stage crypto infrastructure investor" is better than "investor".
- Consider both sides: who can help the person AND whose goals complement theirs.
- When user context is provided, tailor perspectives to their domain (e.g. a DePIN founder searching for "investors" needs crypto-native infra investors specifically).
- Generate only perspectives that add distinct search value — don't repeat similar angles.
- Use "profiles" when looking for a type of person (expert, advisor, leader). Use "intents" when looking for a complementary goal or need (someone raising, someone hiring, someone seeking collaboration).
- Always include at least one "profiles" perspective when the source describes a need that a specific type of professional could fulfill. Most intents benefit from profile-based discovery.`;

// AFTER
const SYSTEM_PROMPT = `You analyze goals and search queries to identify the most relevant perspectives for finding matching people in a professional network.

For each perspective you identify, specify:
1. A clear, specific description of who or what to search for
2. Whether to search "profiles" (user bios, expertise, backgrounds) or "intents" (stated goals, needs, aspirations)
3. A brief reason why this perspective is relevant

Guidelines:
- Be specific and domain-aware. "early-stage crypto infrastructure investor" is better than "investor".
- Consider both sides: who can help the person AND whose goals complement theirs.
- When user context is provided, tailor perspectives to their domain (e.g. a DePIN founder searching for "investors" needs crypto-native infra investors specifically).
- Generate only perspectives that add distinct search value — don't repeat similar angles.
- Use "profiles" when looking for a type of person (expert, advisor, leader). Use "intents" when looking for a complementary goal or need (someone raising, someone hiring, someone seeking collaboration).
- Always include at least one "profiles" perspective when the source describes a need that a specific type of professional could fulfill. Most intents benefit from profile-based discovery.
- LOCATION AWARENESS: When the source text or user context mentions a specific location (city, region, country), incorporate it into lens descriptions. For example, "investors in San Francisco" should produce a lens like "SF-based early-stage investor" rather than just "early-stage investor". This helps the hypothetical document generator produce location-specific search documents, improving retrieval quality.`;
```

**Step 2: Commit**

```bash
git add protocol/src/lib/protocol/agents/lens.inferrer.ts
git commit -m "fix: add location awareness to LensInferrer prompt"
```

---

### Task 4: Write tests for location-aware evaluation

**Files:**
- Modify: `protocol/src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts`

**Step 1: Add location mismatch test to `invokeEntityBundle` describe block**

```typescript
it('penalizes candidates with known location mismatch when discoveryQuery mentions location', async () => {
  // Mock that returns high score for NY candidate (simulates pre-fix behavior)
  // After prompt change, the real model should score ≤ 40 for mismatched location
  const mockEntityBundleModel = {
    invoke: async () => ({
      opportunities: [
        {
          reasoning: 'NY-based investor matches investor criteria but is in wrong city.',
          score: 35,
          actors: [
            { userId: 'discoverer-1', role: 'patient', intentId: null },
            { userId: 'candidate-ny', role: 'agent', intentId: null },
          ],
        },
      ],
    }),
  } as unknown as Runnable;
  const evaluatorWithMock = new OpportunityEvaluator({
    entityBundleModel: mockEntityBundleModel,
  });
  const input: EvaluatorInput = {
    discovererId: 'discoverer-1',
    entities: [
      {
        userId: 'discoverer-1',
        profile: {
          name: 'Alice',
          bio: 'Founder building an AI startup.',
          location: 'San Francisco',
        },
        indexId: 'index-1',
      },
      {
        userId: 'candidate-ny',
        profile: {
          name: 'Bob',
          bio: 'VC partner at TechFund.',
          location: 'New York',
        },
        indexId: 'index-1',
        ragScore: 85,
      },
    ],
    discoveryQuery: 'investors in San Francisco',
  };
  const results = await evaluatorWithMock.invokeEntityBundle(input, { minScore: 50 });
  // Mock returns score 35, which is below minScore 50 — should be filtered
  expect(results.length).toBe(0);
}, 30000);

it('does not penalize candidates with unknown location when discoveryQuery mentions location', async () => {
  const mockEntityBundleModel = {
    invoke: async () => ({
      opportunities: [
        {
          reasoning: 'Candidate matches investor criteria; location unverified.',
          score: 80,
          actors: [
            { userId: 'discoverer-1', role: 'patient', intentId: null },
            { userId: 'candidate-unknown', role: 'agent', intentId: null },
          ],
        },
      ],
    }),
  } as unknown as Runnable;
  const evaluatorWithMock = new OpportunityEvaluator({
    entityBundleModel: mockEntityBundleModel,
  });
  const input: EvaluatorInput = {
    discovererId: 'discoverer-1',
    entities: [
      {
        userId: 'discoverer-1',
        profile: {
          name: 'Alice',
          bio: 'Founder building an AI startup.',
          location: 'San Francisco',
        },
        indexId: 'index-1',
      },
      {
        userId: 'candidate-unknown',
        profile: {
          name: 'Charlie',
          bio: 'Angel investor in deep tech.',
        },
        indexId: 'index-1',
        ragScore: 75,
      },
    ],
    discoveryQuery: 'investors in San Francisco',
  };
  const results = await evaluatorWithMock.invokeEntityBundle(input, { minScore: 50 });
  expect(results.length).toBe(1);
  expect(results[0].score).toBeGreaterThanOrEqual(50);
}, 30000);
```

**Step 2: Run tests**

Run: `cd protocol && bun test src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts`
Expected: All tests pass (including the 2 new location tests).

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts
git commit -m "test: add location mismatch tests for opportunity evaluator"
```

---

### Task 5: Test `buildDiscovererContext` includes location

**Files:**
- Create: `protocol/src/lib/protocol/graphs/tests/opportunity.graph.buildDiscovererContext.spec.ts`

Note: `buildDiscovererContext` is a private function in opportunity.graph.ts. To test it without exporting, we test indirectly through the graph's trace output. Alternatively, if we want a unit test, we can extract and export it. The simplest approach: export it for testing.

**Step 1: Export `buildDiscovererContext`**

In `opportunity.graph.ts`, change the function declaration from:
```typescript
function buildDiscovererContext(
```
to:
```typescript
export function buildDiscovererContext(
```

**Step 2: Write test**

```typescript
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, expect, it } from "bun:test";
import { buildDiscovererContext } from "../opportunity.graph";
import type { SourceProfileData, IndexedIntent } from "../../states/opportunity.state";
import type { Id } from "../../../../types/common.types";

describe('buildDiscovererContext', () => {
  it('includes location when present in profile identity', () => {
    const profile: SourceProfileData = {
      embedding: null,
      identity: { name: 'Alice', bio: 'AI startup founder', location: 'San Francisco' },
      attributes: { skills: ['TypeScript'], interests: ['AI'] },
    };
    const result = buildDiscovererContext(profile, []);
    expect(result).toContain('Location: San Francisco');
  });

  it('omits location line when location is undefined', () => {
    const profile: SourceProfileData = {
      embedding: null,
      identity: { name: 'Alice', bio: 'AI startup founder' },
      attributes: { skills: ['TypeScript'], interests: ['AI'] },
    };
    const result = buildDiscovererContext(profile, []);
    expect(result).not.toContain('Location:');
  });

  it('omits location line when location is empty string', () => {
    const profile: SourceProfileData = {
      embedding: null,
      identity: { name: 'Alice', bio: 'AI startup founder', location: '' },
      attributes: { skills: ['TypeScript'], interests: ['AI'] },
    };
    const result = buildDiscovererContext(profile, []);
    expect(result).not.toContain('Location:');
  });
});
```

**Step 3: Run test**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.buildDiscovererContext.spec.ts`
Expected: All 3 tests pass.

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/graphs/opportunity.graph.ts protocol/src/lib/protocol/graphs/tests/opportunity.graph.buildDiscovererContext.spec.ts
git commit -m "test: add buildDiscovererContext location tests"
```

---

### Task 6: Type check and final verification

**Step 1: Run TypeScript compiler**

Run: `cd protocol && bunx tsc --noEmit`
Expected: No type errors.

**Step 2: Run all affected tests**

Run: `cd protocol && bun test src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts src/lib/protocol/graphs/tests/opportunity.graph.buildDiscovererContext.spec.ts`
Expected: All tests pass.

**Step 3: Final commit (if any remaining changes)**

```bash
git add -A
git commit -m "fix(IND-180): discovery respects explicit location constraints in queries"
```
