# Discovery Query–Aware Evaluator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Pass the user's discovery query into the opportunity evaluator so it only suggests opportunities where candidates clearly match the request (e.g. "visual artists" returns visual artists, not unrelated collaborators).

**Architecture:** Approach A — add optional `discoveryQuery` to `EvaluatorInput`, wire `state.searchQuery` from the opportunity graph into that field when building the input in the evaluation node (discovery path only; not used in introduction mode). When `discoveryQuery` is set, the entity-bundle prompt instructs the LLM to only suggest candidates who fit the request and to down-rank or exclude those who do not. Possible follow-ups (not in scope): B = post-filter by query–candidate similarity; C = stricter retrieval thresholds.

**Tech Stack:** TypeScript, LangChain/LangGraph, existing OpportunityEvaluator (OpenRouter), Drizzle/PostgreSQL.

**Context:** All paths below are relative to the **worktree** root: `.worktrees/feat-draft-opportunities-chat/`. Run commands from `protocol/` inside the worktree.

---

## Possible follow-ups (document only, do not implement)

- **B (Post-filter):** After evaluation, re-rank or filter by similarity between the user's query and each candidate's profile/summary (embed both, apply threshold or blend with score). Use if A is insufficient or you want a deterministic safeguard.
- **C (Stricter retrieval):** Raise HyDE/vector similarity threshold or add query-specific strategies so fewer off-topic candidates are retrieved. Use to reduce noise/cost earlier in the pipeline.

---

## Task 1: Add `discoveryQuery` to EvaluatorInput and evaluator prompt

**Files:**
- Modify: `protocol/src/lib/protocol/agents/opportunity.evaluator.ts` (interface ~161–174; `invokeEntityBundle` humanContent ~356–384)

**Step 1: Extend EvaluatorInput**

In `protocol/src/lib/protocol/agents/opportunity.evaluator.ts`, add to the `EvaluatorInput` interface (after `introductionHint`):

```typescript
  /** Optional discovery query (e.g. from chat). When set, only suggest opportunities where candidates clearly match this request. */
  discoveryQuery?: string;
```

**Step 2: Add discovery-query block to entity-bundle prompt in invokeEntityBundle**

In `invokeEntityBundle`, after building `introModePart` and before `entitiesBlock`, add:

```typescript
    const discoveryQueryPart = input.discoveryQuery?.trim()
      ? `\nDISCOVERY REQUEST: The user asked: "${input.discoveryQuery.trim()}"

Only suggest opportunities where the candidates clearly match this request. Down-rank or exclude candidates who do not fit (e.g. if the user asked for visual artists, do not suggest people who are only engineers or product designers unless they are also visual artists). Score relevance to the request as well as general match quality.
`
      : '';
```

Then change the line that builds `humanContent` from:

```typescript
const humanContent = `DISCOVERER: ${input.discovererId}${introModePart}\n\nENTITIES:\n${entitiesBlock}${existingPart}`;
```

to:

```typescript
const humanContent = `DISCOVERER: ${input.discovererId}${introModePart}${discoveryQueryPart}\n\nENTITIES:\n${entitiesBlock}${existingPart}`;
```

**Step 3: Run existing evaluator tests**

Run: `cd protocol && bun test src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts`

Expected: All existing tests pass (no behavior change when `discoveryQuery` is omitted).

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/agents/opportunity.evaluator.ts
git commit -m "feat(opportunity): add discoveryQuery to EvaluatorInput and entity-bundle prompt"
```

---

## Task 2: Wire searchQuery into EvaluatorInput in the opportunity graph

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts` (evaluationNode, ~624–628)

**Step 1: Pass state.searchQuery into EvaluatorInput (discovery path only)**

In the evaluation node, where `EvaluatorInput` is built (only in the discovery pipeline; the create_introduction path uses a different code path and must not set discoveryQuery), add `discoveryQuery` from state:

Find:

```typescript
          const input: EvaluatorInput = {
            discovererId: state.userId,
            entities,
            existingOpportunities: state.options.existingOpportunities,
          };
```

Replace with:

```typescript
          const input: EvaluatorInput = {
            discovererId: state.userId,
            entities,
            existingOpportunities: state.options.existingOpportunities,
            ...(state.searchQuery?.trim() ? { discoveryQuery: state.searchQuery.trim() } : {}),
          };
```

Note: Introduction mode uses `intro_evaluation` node and a different `EvaluatorInput` construction (with introductionMode, introducerName, introductionHint); that path does not use `state.searchQuery` and must not be given discoveryQuery.

**Step 2: Run opportunity graph and discovery tests**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts src/lib/protocol/support/tests/opportunity.discover.spec.ts`

Expected: All tests pass.

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/graphs/opportunity.graph.ts
git commit -m "feat(opportunity): pass searchQuery to evaluator as discoveryQuery in discovery path"
```

---

## Task 3: Optional — add unit test for discoveryQuery in evaluator

**Files:**
- Modify: `protocol/src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts`

**Step 1: Add test that discoveryQuery is included in human message when provided**

If the existing spec mocks the entity-bundle model, add a test that invokes `invokeEntityBundle` with `discoveryQuery: "visual artists to collaborate with"` and asserts that the prompt passed to the model includes that string (e.g. by using a mock that captures the HumanMessage content and asserting it contains the discovery request). If the test suite does not easily support that (e.g. no model mock), skip this task and rely on integration/manual testing.

**Step 2: Run tests**

Run: `cd protocol && bun test src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts`

Expected: All tests pass.

**Step 3: Commit (if implemented)**

```bash
git add protocol/src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts
git commit -m "test(opportunity): assert discoveryQuery is included in entity-bundle prompt when set"
```

---

## Verification (manual)

After all tasks, from the worktree:

1. Start protocol and frontend; open a chat.
2. Run a discovery query such as "Any visual artists I can collaborate with?" in a network that has both visual artists and non-artists.
3. Confirm that returned opportunities are predominantly or only people who match the request (e.g. visual artists), and that obviously off-topic candidates (e.g. only engineers with no art) are absent or down-ranked.

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-02-25-discovery-query-aware-evaluator.md` (in the worktree).

**Two execution options:**

1. **Subagent-driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel session (separate)** — Open a new session with executing-plans in the worktree and run batch execution with checkpoints.

Which approach do you want?
