# Opportunity-Actor Finder DRY — Pilot Cluster

**Date:** 2026-05-15
**Status:** Approved, proceeding to implementation
**Scope:** Pilot cluster (5) of a larger interface/adapter DRY effort. Other clusters wait until this pattern is validated.

## Problem

`packages/protocol/src/shared/interfaces/database.interface.ts` exposes four methods that all answer "which opportunities tie these users together?" with slightly different filters:

| Method | Returns | Production callers |
|---|---|---|
| `opportunityExistsBetweenActors(actorIds, networkId)` | `boolean` | `opportunity.graph.ts:2113` (create-gate) |
| `getOpportunityBetweenActors(actorIds, networkId)` | `{ id, status } \| null` | **none — only test mocks reference it** |
| `findOverlappingOpportunities(actorUserIds, { excludeStatuses? })` | `Opportunity[]` | `opportunity.enricher.ts`, `opportunity.graph.ts` (dedup) |
| `getAcceptedOpportunitiesBetweenActors(userId, counterpart)` | `Opportunity[]` | `opportunity.graph.ts:2326`, `opportunity.service.ts:857` |

The two `Opportunity[]`-returning methods differ only in (a) actor-matching semantics (exact non-introducer set vs ordered pair) and (b) status filter. That's a textbook DRY candidate. `getOpportunityBetweenActors` is unused in production. `opportunityExistsBetweenActors` is semantically distinct (boolean exists check, lighter SQL, hot path) and stays.

## Design

### Unified method

Add to `Database` (interface line 448), `UserDatabase` (line 1371), `SystemDatabase` (line 1569):

```ts
findOpportunitiesByActors(
  actorIds: string[],
  options?: {
    includeIntroducers?: boolean;          // default false. true matches actors regardless of role (was actorPairCondition behavior)
    statuses?: OpportunityStatus[];        // include filter
    excludeStatuses?: OpportunityStatus[]; // exclude filter
  }
): Promise<Opportunity[]>
```

The two surviving readers have a real SQL difference. `findOverlappingOpportunities` filters out introducer-role actors per id (`EXISTS … role IS DISTINCT FROM 'introducer'`). `getAcceptedOpportunitiesBetweenActors` uses `actorPairCondition` which is JSONB `@>` containment over any role. The `includeIntroducers` option surfaces that explicitly:

- `findOverlappingOpportunities(uids, { excludeStatuses })` → `findOpportunitiesByActors(uids, { excludeStatuses })` — `includeIntroducers` defaults to false, preserving the existing introducer-filter.
- `getAcceptedOpportunitiesBetweenActors(A, B)` → `findOpportunitiesByActors([A, B], { includeIntroducers: true, statuses: ['accepted'] })` — explicit at the call site.

Both readers are already index-agnostic and already order by `updatedAt desc`, so no other options are needed.

`UserDatabase` curries the auth user's id into position 0 (consistent with how the existing scoped variant of `getAcceptedOpportunitiesBetweenActors` takes only `counterpartUserId`). `SystemDatabase` keeps the full signature with the scope guard the existing implementation already runs.

### Methods removed

- `getOpportunityBetweenActors` — dead in production, only test stubs reference it.
- `findOverlappingOpportunities` — superseded.
- `getAcceptedOpportunitiesBetweenActors` — superseded.

### Methods kept untouched

- `opportunityExistsBetweenActors(actorIds, networkId): Promise<boolean>` — hot path, lighter SQL (`count(*) > 0` / `limit 1`), semantically distinct from "give me the rows." Wrapping it as `(await findOpportunitiesByActors(...)).length > 0` would needlessly materialize rows and obscure intent at the call site.

## Migration sequence

Each numbered step is a separate commit on the feature branch.

1. **Add `findOpportunitiesByActors`** to all three interfaces and the backend adapter (including the `opportunityAdapter` delegate, the `UserDatabase` curried wrapper at adapter line ~5665, and the `SystemDatabase` wrapper at adapter line ~5888). Implementations live alongside the old methods.
2. **Migrate `opportunity.enricher.ts:234`** → `findOpportunitiesByActors(actorUserIds, { excludeStatuses })`.
3. **Migrate `opportunity.graph.ts:2427` and `:2554`** (dedup paths) → same shape as enricher.
4. **Migrate `opportunity.graph.ts:2326`** (sibling-accept) → `findOpportunitiesByActors([userId, counterpartUserId], { includeIntroducers: true, statuses: ['accepted'] })`.
5. **Migrate `opportunity.service.ts:857`** → same shape as step 4.
6. **Update test mocks** across `packages/protocol/src/**/*.spec.ts` and `packages/protocol/src/chat/tests/chat.graph.mocks.ts`, `packages/protocol/src/shared/agent/tests/tool.factory.spec.ts`. Replace mock stubs of the three removed methods with stubs of `findOpportunitiesByActors`.
7. **Delete** the three superseded methods from all three interfaces, the adapter, the scoped wrappers, and any `Omit<>` lists in the interface (lines ~1766, ~1829, ~2021).
8. **Lint + typecheck + tests**: `bun run lint` and `tsc --noEmit` in both packages; targeted test suites listed below.

## Test strategy

The existing test inventory already pins the behavior we're preserving. No SQL-level characterization snapshots needed.

**Per call site (existing tests already cover):**
- `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts:897+` — dedup describe block, 6+ tests exercising `findOverlappingOpportunities` decisions.
- `packages/protocol/src/opportunity/tests/opportunity.enricher.spec.ts` — ~40 tests asserting dedup outcomes driven by `findOverlappingOpportunities`.
- `backend/src/services/tests/opportunity.service.getChatContext.spec.ts:192` — `getAcceptedOpportunitiesBetweenActors` usage.
- `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts:1304` — `opportunityExistsBetweenActors` gate (untouched by this refactor; should stay green).

**Per adapter (existing):**
- `backend/src/adapters/tests/database.adapter.spec.ts`
- `backend/src/adapters/tests/system-database.spec.ts:242, :302`
- `backend/src/adapters/tests/user-database.spec.ts:522`

**Per interface contract (existing):**
- `backend/src/adapters/tests/adapter-interface-alignment.spec.ts`

**New tests added with step 1:**
- Unit tests for `findOpportunitiesByActors` covering the `{ exactMatch, statuses, excludeStatuses }` matrix against the existing in-memory adapter test pattern.
- Adapter-level tests for the scoped wrappers (`UserDatabase`, `SystemDatabase`) verifying the auth-user / network-scope clamping.

Validation gate before merge to `dev`:
- `bun test` for the targeted suites above
- `bun run lint` (both packages)
- `bun run build` (`packages/protocol`)
- `tsc --noEmit` (both packages)

## Versioning + branch

- **Worktree:** `.worktrees/refactor-opportunity-actor-finders` off `dev`.
- **Branch:** `refactor/opportunity-actor-finders` (no Linear ID, per project convention).
- **`@indexnetwork/protocol`:** major version bump — exported `Database`, `UserDatabase`, `SystemDatabase` interfaces are breaking. Subtree push to `indexnetwork/protocol` on push to `dev` publishes an rc prerelease; promotion to `main` publishes the stable major.
- **`backend/`:** version bump per branch policy (no external API change).
- **PR target:** `upstream/dev`.

## Out of scope

- Other 5 candidate DRY clusters (network members, network intents, intents-in-index, opportunities-for-user/network, hyde documents). Evaluated after this pilot lands.
- A generic options-bag / query-builder pattern. The options stay tight and named.
- Renaming `opportunityExistsBetweenActors` for symmetry. Bikeshedding.
- Touching the protocol's `ChatGraphCompositeDatabase` or other composite types beyond the surface required by the migration.

## Risk register

- **Type drift between `Database` and the scoped variants** — mitigated by `adapter-interface-alignment.spec.ts`, which fails on any method present in one but not all.
- **Mock-stub churn across ~15 test files** — mechanical; covered by step 6. The grep-able old names make it easy to verify completeness.
- **External `@indexnetwork/protocol` consumers** — none known outside this monorepo's `backend/`. Major bump signals the break in semver.
