# Opportunity Discovery Relevance Fix

**Issue**: IND-153 — Opportunity discovery returns irrelevant contacts for investor intent
**Date**: 2026-03-14

## Problem

When a user expresses an intent like "Raising", the opportunity discovery pipeline surfaces contacts who are not investors (e.g., other founders also seeking investors) while ignoring actual investors. The root cause is that the LensInferrer — which generates search perspectives for HyDE document creation — operates without knowledge of who the discoverer is.

## Root Cause

The HyDE graph state has a `profileContext` field designed to carry the discoverer's profile and intents. The LensInferrer prompt explicitly supports it:

> "When user context is provided, tailor perspectives to their domain (e.g. a DePIN founder searching for 'investors' needs crypto-native infra investors specifically)."

But the opportunity graph's Discovery node and the intent queue's `handleGenerateHyde` both invoke the HyDE graph **without passing `profileContext`**. The LensInferrer only sees the raw query text (e.g., "Raising capital for Index Network...") with no information about who is searching.

This means:
- Lenses are generic rather than role-aware ("investor" vs. "crypto-native infra VC who backs founder-led protocols")
- HyDE documents are less targeted, producing weaker vector matches
- Same-domain but wrong-role candidates (founders seeking investors) score similarly to actual investors

## Fix

### Part 1: Wire discoverer context into HyDE graph (primary)

Build a `discovererContext` string from the user's profile and index-scoped active intents, and pass it as `profileContext` to every HyDE graph invocation.

**Context format**:
```
Profile: [name], [bio]
Skills: [skills]
Interests: [interests]

Active intents:
- [intent payload 1]
- [intent payload 2]
```

**Chat discovery path** (`opportunity.graph.ts`, Discovery node):
- `state.sourceProfile` and `state.indexedIntents` are already loaded by the Prep node
- Build `discovererContext` from these, pass to `self.hydeGenerator.invoke({ ..., profileContext })`
- Applies to both `runQueryHydeDiscovery()` (line ~618) and the intent path (line ~700)

**Background discovery path** (`intent.queue.ts`, `handleGenerateHyde`):
- Fetch profile via `db.getProfile(userId)` and active intents via `db.getActiveIntents(userId)`
- Build the same `discovererContext` string
- Pass to `hydeGraph.invoke({ ..., profileContext })`

**Type change** (`opportunity.graph.ts`):
- Add `profileContext?: string` to `HydeGeneratorInvokeInput`

**No changes needed** to LensInferrer, HyDE generator, or HyDE graph internals — they already support `profileContext`.

### Part 2: Evaluator prompt hardening (secondary, defense-in-depth)

Add same-side match detection rules to the evaluator prompts in `opportunity.evaluator.ts`.

**`entityBundleSystemPrompt`** — add rule 7:
```
7. SAME-SIDE MATCHING: Before scoring, check whether the DISCOVERER and CANDIDATE
   are both SEEKING the same thing (e.g., both looking for investors, both seeking
   co-founders, both seeking mentorship). If both parties are seekers of the same
   resource, this is NOT an opportunity — score <30. An opportunity requires one
   side to OFFER what the other SEEKS.
```

**`discoveryQueryPart`** — add rule 5:
```
5. SAME-SIDE CHECK: If the candidate's intents show they are ALSO SEEKING what the
   discoverer is seeking (e.g., both looking for investors), this is a same-side
   match. Score <30 regardless of keyword overlap. The candidate must BE or OFFER
   what the discoverer is looking for, not also be looking for it.
```

## Files Changed

| File | Change |
|------|--------|
| `protocol/src/lib/protocol/graphs/opportunity.graph.ts` | Build discoverer context, pass `profileContext` to HyDE invocations; update `HydeGeneratorInvokeInput` type |
| `protocol/src/queues/intent.queue.ts` | Fetch profile + intents, pass `profileContext` to HyDE graph |
| `protocol/src/lib/protocol/agents/opportunity.evaluator.ts` | Add same-side matching rules to evaluator prompts |

## Files Not Changed

- `lens.inferrer.ts` — already supports `profileContext`
- `hyde.generator.ts` — already receives lens + corpus context
- `hyde.graph.ts` / `hyde.state.ts` — already has `profileContext` field
- `embedder.adapter.ts` — search logic is correct; searching raw `userProfiles.embedding` is the right target when lenses are well-formed

## Testing

- Existing evaluator tests in `protocol/src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts`
- Existing opportunity graph tests in `protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`
- Add test case: discoverer context is passed to HyDE graph in both chat and background paths
- Add test case: evaluator rejects same-side matches (two seekers) with score <30
