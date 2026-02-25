# Discovery Coverage (Option C) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure profile HyDE (and thus discovery) has coverage for index members so that the first `create_opportunities` call in chat (e.g. "visual artists and game developers") finds people. Discovery uses vector search over `hyde_documents` joined with `index_members`; if a user has no profile HyDE, they never appear in profile-strategy results.

**Architecture:** Trigger profile HyDE generation when a user becomes an index member (event + profile queue job). Optionally ensure profile sync runs write mode where appropriate. Add a bounded backfill CLI for existing members without profile HyDE. No new data model: users have profiles; discovery scope is “users who are index members” via existing joins.

**Tech Stack:** Bun, BullMQ, Drizzle ORM, PostgreSQL/pgvector, Profile graph, HyDE graph, protocol queues and adapters.

**Worktree:** Do all work in the existing worktree at `.worktrees/feat-draft-opportunities-chat`. Run `bun run worktree:setup feat-draft-opportunities-chat` from repo root if not already set up. Paths below are relative to the worktree root (same as repo). This plan lives at `docs/plans/2026-02-24-discovery-coverage-option-c.md` (in the worktree).

---

## What actually changes (profile embedding vs profile HyDE)

You already have **profile embeddings** in `user_profiles.embedding` — populated when profiles are created/updated. This plan does **not** change those.

Discovery in chat has two paths:

1. **Query-based path** (when the user types e.g. "visual artists and game developers"): the query is turned into HyDE, then we search **`hyde_documents`** (profile strategy) and **`intents`** (intent strategy). Profile candidates come from **`hyde_documents`** with `sourceType = 'profile'`, `sourceId = userId`, joined with `index_members`. So we need **rows in `hyde_documents`** for each index member (profile HyDE). If those rows are missing, the first `create_opportunities` returns 0 profile candidates even though `user_profiles.embedding` is populated.

2. **Profile-as-source path**: uses the viewer's profile embedding and searches `user_profiles.embedding` and intents — that path already uses the profile embeddings you have.

**The only behavioral change:** when a user is added to an index, we enqueue a job that ensures they have **profile HyDE rows in `hyde_documents`** (profile graph write mode generates/upserts them). That makes them discoverable in the query-based path. Optional backfill does the same for existing members missing profile HyDE.

---

## Task 1: Add index membership event hook

**Context:** All file paths and commands assume you are in the worktree root (`.worktrees/feat-draft-opportunities-chat`).

**Files:**

- Create: `protocol/src/events/index_membership.event.ts`
- Modify: `protocol/src/adapters/database.adapter.ts` (in `addMemberToIndex`, after successful insert)

**Step 1: Create event module**

Create `protocol/src/events/index_membership.event.ts`:

```typescript
/**
 * Hook called when a user is added to an index.
 * Set by main.ts to enqueue profile HyDE job so discovery can find the member.
 */
export const IndexMembershipEvents = {
  onMemberAdded: (_userId: string, _indexId: string): void => {},
};
```

**Step 2: Invoke hook in database adapter**

In `protocol/src/adapters/database.adapter.ts`, add import (with other imports):

```typescript
import { IndexMembershipEvents } from '../events/index_membership.event';
```

In `addMemberToIndex` (around 1821–1830), the insert uses `.onConflictDoNothing().returning()`. When `result.length > 0` a new member was inserted. Before `return { success: true, alreadyMember: result.length === 0 };`, add:

```typescript
if (result.length > 0) {
  IndexMembershipEvents.onMemberAdded(userId, indexId);
}
return { success: true, alreadyMember: result.length === 0 };
```

**Step 3: Commit**

```bash
git add protocol/src/events/index_membership.event.ts protocol/src/adapters/database.adapter.ts
git commit -m "feat(discovery): add index membership event hook for coverage"
```

---

## Task 2: Create profile queue and ensure_profile_hyde job

**Files:**

- Create: `protocol/src/queues/profile.queue.ts`
- Test: `protocol/src/queues/tests/profile.queue.spec.ts`

**Step 1: Write the failing test**

In `protocol/src/queues/tests/profile.queue.spec.ts` add a test that enqueues `ensure_profile_hyde` with `{ userId: 'u1' }` and asserts the job is added (mock queue or assert job name/payload). Follow the pattern in `protocol/src/queues/tests/intent.queue.spec.ts`: use `QueueFactory` mock, test `addEnsureProfileHydeJob` and `processJob('ensure_profile_hyde', { userId })` with injected deps so no real DB/Redis.

Example shape:

```typescript
import { describe, expect, it, mock } from 'bun:test';
import { ProfileQueue, QUEUE_NAME } from '../profile.queue';

describe('ProfileQueue', () => {
  it('adds ensure_profile_hyde job with userId', async () => {
    const queue = new ProfileQueue();
    const job = await queue.addEnsureProfileHydeJob({ userId: 'u1' });
    expect(job).toBeDefined();
    expect(job.name).toBe('ensure_profile_hyde');
    expect(job.data).toEqual({ userId: 'u1' });
  });

  it('processJob ensure_profile_hyde invokes profile graph write', async () => {
    const invokeProfileWrite = mock(async () => ({}));
    const queue = new ProfileQueue({ invokeProfileWrite });
    await queue.processJob('ensure_profile_hyde', { userId: 'u1' });
    expect(invokeProfileWrite).toHaveBeenCalledWith('u1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/queues/tests/profile.queue.spec.ts`

Expected: FAIL (ProfileQueue not defined / addEnsureProfileHydeJob missing).

**Step 3: Implement profile queue**

Create `protocol/src/queues/profile.queue.ts`:

- Queue name: `profile-hyde-queue`.
- Job type: `ensure_profile_hyde` with payload `{ userId: string }`.
- Handler: load profile for user; invoke profile graph with `{ userId, operationMode: 'write' }` (ProfileGraphFactory + ProfileDatabaseAdapter, EmbedderAdapter, ScraperAdapter). If no profile exists, the graph will generate it; if it exists, it will fill in missing embed/HyDE. Use same pattern as intent queue: `processJob(name, data)`, `addJob`, `addEnsureProfileHydeJob(data)`, `startWorker()`. Optional deps for tests: `invokeProfileWrite?: (userId: string) => Promise<void>`.
- Default handler: instantiate ProfileGraphFactory with adapters, call `factory.createGraph().invoke({ userId, operationMode: 'write' })`. Catch errors and log; do not throw (job will retry per BullMQ options).
- BullMQ options: same as intent queue (attempts: 3, exponential backoff, removeOnComplete 24h, removeOnFail 7d).

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/queues/tests/profile.queue.spec.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add protocol/src/queues/profile.queue.ts protocol/src/queues/tests/profile.queue.spec.ts
git commit -m "feat(discovery): add profile queue with ensure_profile_hyde job"
```

---

## Task 3: Wire membership event to profile queue in main

**Files:**

- Modify: `protocol/src/main.ts`

**Step 1: Import profile queue and event**

In `protocol/src/main.ts`, add imports for `profileQueue` and `IndexMembershipEvents`.

**Step 2: Set onMemberAdded to enqueue job**

After other queue/worker setup (e.g. after `intentQueue.startWorker()`), set:

```typescript
IndexMembershipEvents.onMemberAdded = (userId: string) => {
  profileQueue.addEnsureProfileHydeJob({ userId }).catch((err) => {
    log.job.from('IndexMembership').error('Failed to enqueue ensure_profile_hyde', { userId, error: err });
  });
};
```

**Step 3: Start profile queue worker**

Call `profileQueue.startWorker()` alongside the other queue workers.

**Step 4: Commit**

```bash
git add protocol/src/main.ts
git commit -m "feat(discovery): wire index membership event to profile HyDE queue"
```

---

## Task 4: Ensure ProfileService.syncProfile uses write mode when appropriate (optional)

**Files:**

- Modify: `protocol/src/services/profile.service.ts`
- Modify: `protocol/src/controllers/profile.controller.ts` (if you want explicit “sync for discovery” path)

**Context:** Profile graph state defaults `operationMode` to `'write'`, so `syncProfile(userId)` already runs the full write path (profile + embed + HyDE) when no mode is passed. This task is optional: only add if you want an explicit “sync for discovery” API or if you discover auth callback uses `operationMode: 'query'` and you want to fix that.

**Step 1: Confirm current behavior**

In `protocol/src/services/profile.service.ts`, `syncProfile` calls `this.factory.createGraph().invoke({ userId })`. With no `operationMode`, the graph default is `'write'`. Verify in `protocol/src/lib/protocol/states/profile.state.ts` that default is `'write'`.

**Step 2: (Optional) Add explicit write for profile sync API**

If the profile controller should guarantee write mode, pass it explicitly:

```typescript
const result = await this.factory.createGraph().invoke({ userId, operationMode: 'write' });
```

**Step 3: Commit (if changed)**

```bash
git add protocol/src/services/profile.service.ts
git commit -m "chore(profile): ensure syncProfile uses write mode for discovery coverage"
```

---

## Task 5: Backfill CLI for index members missing profile HyDE (optional)

**Files:**

- Create: `protocol/src/cli/backfill-profile-hyde.ts`
- Modify: `protocol/package.json` (add script `maintenance:backfill-profile-hyde`)

**Step 1: Implement CLI**

- Query: users who are in `index_members` and have a row in `user_profiles` but lack a profile HyDE document (e.g. no row in `hyde_documents` with `sourceType = 'profile'` and `sourceId = userId` for that user). Join `index_members` with `user_profiles` and left join `hyde_documents` on `sourceId = user_profiles.userId` and `sourceType = 'profile'`, then filter where HyDE row is null.
- Limit: e.g. 500 users per run (configurable via `--limit`).
- For each user: enqueue `profileQueue.addEnsureProfileHydeJob({ userId })`. Do not await the job completion; just enqueue.
- Log count enqueued.

**Step 2: Add npm script**

In `protocol/package.json`, under scripts, add:

```json
"maintenance:backfill-profile-hyde": "bun ./src/cli/backfill-profile-hyde.ts"
```

**Step 3: Commit**

```bash
git add protocol/src/cli/backfill-profile-hyde.ts protocol/package.json
git commit -m "feat(discovery): add backfill CLI for profile HyDE of index members"
```

---

## Task 6: Manual smoke test and docs

**Step 1: Smoke test**

1. Start protocol server (and Redis) in a worktree with the changes.
2. Create or use an index and add a user who has a profile but no profile HyDE (or use seed data).
3. Trigger membership add (e.g. join index via chat tool or API).
4. Confirm a job is enqueued (Bull Board at `http://localhost:3001/dev/queues/` — check `profile-hyde-queue`).
5. After job completes, run discovery in chat with a query that should match that user; confirm they appear in create_opportunities results.

**Step 2: Update docs (optional)**

If you have a doc that describes discovery or opportunity flow, add a short note that index members get profile HyDE enqueued on join so discovery can find them. Reference this plan.

**Step 3: Commit (if docs changed)**

```bash
git add <docs>
git commit -m "docs: discovery coverage via profile HyDE on membership"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-02-24-discovery-coverage-option-c.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Parallel Session (separate)** — Open a new session with executing-plans and run task-by-task with checkpoints.

Which approach do you want?

- If **Subagent-Driven** is chosen: use @superpowers:subagent-driven-development in this session (fresh subagent per task + code review).
- If **Parallel Session** is chosen: use a new session in the worktree with @superpowers:executing-plans.

