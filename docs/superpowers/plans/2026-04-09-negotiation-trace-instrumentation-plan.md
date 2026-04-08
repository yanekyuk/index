# Negotiation Trace Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make negotiation steps visible in the structured debug export (Channel B) by pushing trace entries from the negotiate node and extracting graph timing in the tools layer.

**Architecture:** The negotiate node in the opportunity graph pushes summary + per-candidate trace entries to the existing `trace` state field (append reducer). The tools layer reads the negotiate timing from trace data and appends it to `_graphTimings`. No new state fields or types needed.

**Tech Stack:** TypeScript, LangGraph state annotations

---

### Task 1: Add trace entries to the negotiate node

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts:1627-1763`

The negotiate node currently returns `{ evaluatedOpportunities }`. We add `trace` entries so the existing append reducer captures them.

- [ ] **Step 1: Identify rejected candidates and build trace entries**

After `negotiateCandidates()` returns at line 1741, and after building `updatedOpportunities`, add trace construction before the return statement. Insert before line 1756 (`traceEmitter?.({ type: "graph_end" ...`):

```typescript
        // ─── Build trace entries for Channel B (debug export) ───
        const acceptedUserIds = new Set(acceptedResults.map(r => r.userId));
        const negotiationDurationMs = Date.now() - graphStart;

        const candidateTraceEntries = candidates.map(c => {
          const accepted = acceptedUserIds.has(c.userId);
          const result = accepted ? acceptedResults.find(r => r.userId === c.userId) : null;
          const name = c.candidateUser.profile?.name ?? c.userId;
          const outcome = accepted ? 'accepted' : 'rejected';
          const scoreStr = result?.negotiationScore != null ? ` (${result.negotiationScore})` : '';
          return {
            node: 'negotiate_candidate',
            detail: `${name}: ${outcome}${scoreStr}`,
            data: {
              userId: c.userId,
              name,
              outcome,
              ...(result?.negotiationScore != null && { score: result.negotiationScore }),
              turns: result?.turnCount ?? 0,
            },
          };
        });

        const acceptedCount = acceptedResults.length;
        const rejectedCount = candidates.length - acceptedCount;
        const negotiateTrace = [
          {
            node: 'negotiate',
            detail: `${candidates.length} candidate(s) → ${acceptedCount} accepted, ${rejectedCount} rejected`,
            data: {
              durationMs: negotiationDurationMs,
              candidateCount: candidates.length,
              acceptedCount,
              rejectedCount,
            },
          },
          ...candidateTraceEntries,
        ];
```

- [ ] **Step 2: Return trace in the state update**

Change the return at line 1757 from:
```typescript
        return { evaluatedOpportunities: updatedOpportunities };
```
to:
```typescript
        return { evaluatedOpportunities: updatedOpportunities, trace: negotiateTrace };
```

- [ ] **Step 3: Also return empty trace on error path**

At line 1761, the catch block returns `{ evaluatedOpportunities: [] }`. Update to also include a trace entry:
```typescript
        return {
          evaluatedOpportunities: [],
          trace: [{
            node: 'negotiate',
            detail: 'Negotiation failed',
            data: { durationMs: Date.now() - graphStart, error: true },
          }],
        };
```

- [ ] **Step 4: Also return empty trace on early bail**

At line 1628, the early return `if (!this.negotiationGraph) return {};` should remain as-is (no trace = negotiation was skipped, which is the correct semantics).

- [ ] **Step 5: Verify the build**

Run:
```bash
cd packages/protocol && bun run build
```
Expected: No errors. The `trace` field already exists in `OpportunityGraphState` with an append reducer, so returning `{ trace: [...] }` from the node is valid.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.graph.ts
git commit -m "feat(protocol): add negotiation trace entries to opportunity graph"
```

---

### Task 2: Extract negotiation timing into `_graphTimings`

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.tools.ts:609-617`

The tools layer builds `_discoverGraphTimings` and `allDebugSteps`. We extract the negotiate entry's `durationMs` from the debug steps and add a graph timing entry.

- [ ] **Step 1: Add negotiation graph timing extraction**

After line 617 (`...(result.debugSteps ?? []),`), and after `allDebugSteps` is built, add:

```typescript
      // Extract negotiation timing from trace (if negotiation ran)
      const negotiateStep = allDebugSteps.find(s => s.step === 'negotiate' && s.data?.durationMs != null);
      const _allGraphTimings = [
        ..._discoverGraphTimings,
        ...(negotiateStep ? [{ name: 'negotiation', durationMs: negotiateStep.data.durationMs as number, agents: [] }] : []),
      ];
```

- [ ] **Step 2: Use `_allGraphTimings` instead of `_discoverGraphTimings` in all return paths**

Search the discovery path return statements in the tool (lines ~622-740) for `_discoverGraphTimings` and replace with `_allGraphTimings`. There are multiple return paths in this function (createIntentSuggested, introducer flow, normal success, no-results). Each that references `_discoverGraphTimings` for the `_graphTimings` field needs updating.

Find all occurrences of `_discoverGraphTimings` after line 612 and replace with `_allGraphTimings`.

- [ ] **Step 3: Verify the build**

Run:
```bash
cd packages/protocol && bun run build
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.tools.ts
git commit -m "feat(protocol): include negotiation graph timing in debug export"
```

---

### Task 3: Verify end-to-end with existing tests

**Files:**
- Read: `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts`

- [ ] **Step 1: Run existing opportunity graph tests**

```bash
cd packages/protocol && bun test src/opportunity/tests/opportunity.graph.spec.ts
```
Expected: All existing tests pass. The negotiate node changes only affect the `trace` output, which existing tests may not assert on.

- [ ] **Step 2: Check if any test instantiates with a negotiation graph**

Look at the test file for `OpportunityGraphFactory` constructor calls. If none pass a `negotiationGraph`, then the negotiate node's `if (!this.negotiationGraph) return {}` early bail means our new code isn't exercised. That's fine -- the tests confirm we didn't break existing behavior.

- [ ] **Step 3: Run full protocol build**

```bash
cd packages/protocol && bun run build
```
Expected: Clean build, no errors.

- [ ] **Step 4: Commit (if any test adjustments were needed)**

```bash
git add -A
git commit -m "test(protocol): verify negotiation trace instrumentation"
```

---

### Task 4: Update the design spec

**Files:**
- Modify: `docs/superpowers/specs/2026-04-09-negotiation-trace-instrumentation-design.md`

- [ ] **Step 1: Update spec to reflect simplified approach**

The original spec mentioned adding a `negotiationTrace` field to `OpportunityGraphState`. Update to reflect that we use the existing `trace` append reducer instead -- no new state fields needed. Update the files changed table to remove `opportunity.state.ts`.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-09-negotiation-trace-instrumentation-design.md
git commit -m "docs: update negotiation trace spec with simplified approach"
```
