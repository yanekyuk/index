# Network-scoped personal agents — implementation plan

Date: 2026-05-07

## Phase 6 — Frontend & integration cleanup

### Task 6.1: audit `isExperiment` UI guards

> Audit conclusion (2026-05-07): all `isExperiment` references are legitimate UX/product rules (locked join policy, hidden invitation link, master-key UI). No removals needed; user-scoping logic already cleared in Phase 5.

Confirmed UX/product-rule references:

- `frontend/src/components/modals/CreateIndexModal.tsx` — pass-through of `isExperiment: true` on creation; locks `joinPolicy` to `invite_only` when experiment is selected.
- `frontend/src/app/networks/page.tsx` & `frontend/src/components/Sidebar.tsx` — pass `isExperiment` from create modal payload to `createIndex` API; UX flow only.
- `frontend/src/components/NetworkSettingsPanel.tsx` — hides invitation link UI for experiment networks; renders master-key panel instead. Product invariant.
- `backend/src/controllers/network.controller.ts` — blocks post-creation modification of `isExperiment` and `experimentMasterKeyHash`. Product invariant.
- `backend/src/services/network.service.ts` — locked join policy for experiment networks (cannot toggle to `anyone`). Product invariant.
- `backend/src/guards/experiment.guard.ts` — verifies master key against `experimentMasterKeyHash`. Product invariant.
- `backend/src/adapters/database.adapter.ts` — filters experiment networks out of public listings. Product invariant.

### Task 6.2: integration test for CSV-import flow

Service-level integration test exercising `experimentService.importMembers` end-to-end against the real DB. Substitutes the originally planned HTTP-level e2e because the worktree's dev server is environmental.

Coverage:
1. CSV row provisions a user.
2. The user gets a network-scoped personal agent + permissions + API key.
3. The invitation email is dispatched (verified via mocked transport).
4. Re-importing the same email is idempotent (no second key, no duplicate email).

Implemented in `backend/tests/network-scoped-import.test.ts`.
