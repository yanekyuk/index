# db-seed: Profile Embedding, Drop Privy Test Users, Verbose Logging

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure db-seed creates user profiles with embeddings populated, remove Privy-specific test accounts (phone/OTP), and add verbose progress logging so seed runs are not silent for long periods.

**Architecture:** After upserting synthetic tester profiles (identity, narrative, attributes) without embeddings, invoke the existing profile graph with `operationMode: 'write'` for each seeded user so the graph embeds and saves each profile (and generates HyDE). Real “testable” accounts are simplified to email-only (no phone/OTP). Progress logs are added at each major phase and per-item where loops run.

**Tech Stack:** Bun, Drizzle, existing ProfileGraphFactory + ProfileDatabaseAdapter + EmbedderAdapter + ScraperAdapter (same as `generate-profiles.ts`), protocol logger or console for CLI.

---

## Task 1: Add verbose progress logging to db-seed

**Files:**
- Modify: `protocol/src/cli/db-seed.ts`

**Step 1: Log at start of seed**

After `Seeding indexes and users...` (and persona count when applicable), add a log before the index loop, e.g.:

```ts
if (!silent) console.log('Creating indexes...');
```

**Step 2: Log inside index loop**

Inside the `for (const idx of SEED_INDEXES)` loop, after each try/catch, log progress (e.g. "  Index X/Y: {title} — created | already exists").

**Step 3: Log before/after real and persona users**

Before `ensureUsersAndMemberships(realAccounts, ...)` log "Creating real test users...". Before `ensureUsersAndMemberships(personaAccounts)` log "Creating synthetic persona users (1..N)...". Optionally log per user in the loop if not too noisy (e.g. every 5th or only at end: "  Real users: 3 ready", "  Persona users: 10 ready").

**Step 4: Log profile upserts**

Before the profile upsert loop log "Upserting tester profiles...". Inside the loop log each "  Profile 1/N: {name}" (or every 5th). After loop log "  Profiles upserted: N".

**Step 5: Log intent processing**

Before the intent-processing loop log "Processing intents via intent graph...". Inside the loop, for each persona log "  Persona X/M: {name} — intents 1..K" (or "  Processing intents for {name} (1/K)..."). On failure keep existing warn; on success optionally log "  Done: {name}".

**Step 6: Commit**

```bash
git add protocol/src/cli/db-seed.ts
git commit -m "chore(seed): add verbose progress logging to db-seed"
```

---

## Task 2: Embed seeded user profiles after upsert

**Files:**
- Modify: `protocol/src/cli/db-seed.ts`

**Step 1: Add dependencies and adapter imports**

At top of `db-seed.ts`, add:

```ts
import { ProfileGraphFactory } from '../lib/protocol/graphs/profile.graph';
import { ProfileDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
```

**Step 2: Instantiate profile graph factory**

Inside `seedDatabase()`, after the profile upsert loop and before the intent-processing loop, create the factory once (same pattern as `generate-profiles.ts`):

```ts
const profileFactory = new ProfileGraphFactory(
  new ProfileDatabaseAdapter(),
  new EmbedderAdapter(),
  new ScraperAdapter(),
);
```

**Step 3: Invoke profile graph for each seeded profile**

After upserting profiles, add a new loop over the same (personaUsers + personasToSeed) indices. For each user, invoke the graph with `operationMode: 'write'` (so it does not use Parallels auto_generate; it will see existing profile and only embed + HyDE):

```ts
if (!silent) console.log('Embedding profiles (and generating HyDE)...');
let embedded = 0;
let embedFailures = 0;
for (let i = 0; i < personaUsers.length && i < personasToSeed.length; i++) {
  const userId = personaUsers[i].id;
  const name = personasToSeed[i].name;
  if (!silent) console.log(`  Embedding ${i + 1}/${personaUsers.length}: ${name}`);
  try {
    const graph = profileFactory.createGraph();
    const result = await graph.invoke({ userId, operationMode: 'write' });
    if (result.error) {
      embedFailures++;
      if (!silent) console.warn(`    Failed: ${result.error}`);
    } else {
      embedded++;
    }
  } catch (err) {
    embedFailures++;
    if (!silent) console.warn(`    Error: ${(err instanceof Error ? err.message : String(err)).slice(0, 80)}`);
  }
}
if (!silent) console.log(`  Profiles embedded: ${embedded}${embedFailures > 0 ? ` (${embedFailures} failed)` : ''}`);
```

**Step 4: Update summary output**

In the final `if (!silent)` block, add a line for embedded count (e.g. "  N profiles embedded (profile + HyDE)") so the summary reflects the new step.

**Step 5: Run seed manually to verify**

Run:

```bash
cd protocol && bun run db:seed -- --confirm
```

Expected: Logs show "Embedding profiles...", per-user "Embedding 1/N: ...", and summary includes embedded count. In DB, `user_profiles.embedding` should be non-null for seeded personas.

**Step 6: Commit**

```bash
git add protocol/src/cli/db-seed.ts
git commit -m "feat(seed): embed seeded user profiles via profile graph"
```

---

## Task 3: Remove TESTABLE_TEST_ACCOUNTS (done)

**Files:**
- Modified: `protocol/src/cli/test-data.ts` — removed `TESTABLE_TEST_ACCOUNTS` export.
- Modified: `protocol/src/cli/db-seed.ts` — removed real-accounts flow and login credentials output; first persona is index owner.
- Modified: `protocol/src/cli/opportunity-three-user-test.ts` — uses first 3 `TESTER_PERSONAS` emails instead.
- Modified: `protocol/docs/manual-three-user-opportunity-test.md` — reference updated; OTP troubleshooting line removed.

---

## Task 4: Optional — add a test or script to assert embeddings (doc only)

**Verification (manual):** After running `bun run db:seed -- --confirm`, verify seeded profiles have embeddings:

```sql
SELECT u.email, (p.embedding IS NOT NULL) AS has_embedding
FROM user_profiles p
JOIN users u ON u.id = p.user_id
WHERE u.email LIKE 'seed-tester-%';
```

All rows should show `has_embedding: true`. Optional automated test could run seed with `--personas=1` and assert the one profile row has non-null `embedding`.

---

## Quick reference

| Task | Summary |
|------|--------|
| 1 | Add verbose logs: indexes, users, profiles, embedding, intents |
| 2 | After upsert, invoke profile graph (operationMode: 'write') per persona to embed + HyDE |
| 3 | Remove TESTABLE_TEST_ACCOUNTS; use personas only (done) |
| 4 | Optional: test or doc to verify embeddings after seed |

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-02-21-db-seed-profiles-embedding.md`.

Two execution options:

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** — Open a new session with executing-plans, batch execution with checkpoints.

Which approach?

If Subagent-Driven is chosen: **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development.  
If Parallel Session is chosen: **REQUIRED SUB-SKILL:** New session uses superpowers:executing-plans.
