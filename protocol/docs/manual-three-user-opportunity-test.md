# Manual Three-User Opportunity Test (Frontend)

This guide describes how to test the opportunity system **manually in the frontend** by logging in as each of the three seed users defined in `protocol/src/cli/db-seed.ts` (see `protocol/src/cli/test-data.ts` for credentials).

## Prerequisites

- **Database seeded** with the three test users and indexes (Commons, etc.)
- **Protocol server** running (`bun run dev` in `protocol/`)
- **Workers** running so HyDE and opportunity-discovery run after intents are created:
  - `bun run integration-worker` (if you use it for intents)
  - Intent HyDE and opportunity-discovery jobs are enqueued when intents are created/updated; run **either**:
    - `bun run integration-worker` (processes queues), or
    - In-process: create intents via the CLI/API and run the opportunity-three-user script to simulate the pipeline
- **Frontend** running (`bun run dev` in `frontend/`)
- **Auth** configured with the app origin (e.g. `http://localhost:3000`) in your auth provider / Better Auth config

## Seed users (from `test-data.ts`)

| Name        | Email                              |
|-------------|------------------------------------|
| Alex Chen   | seed-tester-1@index-network.test   |
| Jordan Lee  | seed-tester-2@index-network.test   |
| Sam Rivera  | seed-tester-3@index-network.test   |

Login: use your auth flow (e.g. magic link to the email above, or dev token/CLI flow if configured). The seed script does not set a password or OTP; if using Better Auth with magic link or email OTP, use the addresses above.

## One-time setup

1. **Seed the database** (from `protocol/`):
   ```bash
   bun run db:seed --confirm
   ```
   This creates the three users, indexes (including **Commons**), and index memberships (first user is owner, others members).

2. **Start backend and workers** (from `protocol/`):
   ```bash
   bun run dev
   ```
   In another terminal:
   ```bash
   bun run integration-worker
   ```
   (Or use whatever runs the `intent-hyde` and `opportunity-discovery` queues.)

3. **Start frontend** (from `frontend/`):
   ```bash
   bun run dev
   ```
   Open http://localhost:3000 (or your configured origin).

## Manual test flow

### 1. Log in as User A (Alex Chen)

- Email: `seed-tester-1@index-network.test`
- Use your auth flow (e.g. magic link or password if you set one for this email).
- Go to **Library** → ensure you’re on **My Intents** (or create an intent if needed).
- Create or use an intent in **Commons**:
  - Go to the index page for Commons (e.g. from **Networks** or **Library**), or create an intent that’s assigned to that index.
- Wait for background jobs (HyDE → opportunity-discovery) to run (usually within a minute, or check BullBoard at `http://localhost:3001/dev/queues`).

### 2. Check opportunities as User A

- Go to **Library** → **My Opportunities** tab.
- You should see opportunities where User A is an actor (e.g. as patient or introducer). Count and list are from `GET /opportunities` (role-based visibility: e.g. patient sees latent; agent may only see after status change).

### 3. Switch to User B (Jordan Lee)

- Sign out of the app.
- Sign in with email: `seed-tester-2@index-network.test` (use your auth flow, e.g. magic link).
- Go to **Library** → **My Opportunities**.
- Compare with User A: depending on the opportunity’s actors and status, User B may see **no** opportunities, **fewer**, or **the same** (e.g. if B is the other peer). This validates role-based visibility.

### 4. Log in as User C (Sam Rivera)

- Log out, then log in with email: `seed-tester-3@index-network.test` (use your auth flow, e.g. magic link).
- Go to **Library** → **My Opportunities**.
- Again compare counts and list with A and B to confirm different users see different sets per role/status.

## What you’re validating

- **Different users** (A, B, C) get **different opportunity lists** from `GET /opportunities` when logged in.
- **Library → My Opportunities** shows **live data** from the API (not mocks).
- **Role-based visibility**: e.g. latent opportunities visible to patient/introducer/peer as designed; agents may only see after status change (see Latent Opportunity Lifecycle).

## Troubleshooting

- **No opportunities for any user**: Ensure intent was created in an index that has HyDE docs and that `intent-hyde` and `opportunity-discovery` jobs ran (check queues and worker logs).
- **Auth origin**: Add the frontend origin (e.g. `http://localhost:3000`) in your auth config (e.g. Better Auth trustedOrigins).

## Reference

- Seed script: `protocol/src/cli/db-seed.ts`
- Test users: first 3 seeded personas (`seed-tester-1@index-network.test`, `seed-tester-2@index-network.test`, `seed-tester-3@index-network.test`) from `protocol/src/cli/test-data.ts` (`TESTER_PERSONAS`)
- Opportunity API: `GET /opportunities` (list for current user), `GET /opportunities/:id` (detail with presentation)
- Visibility rules: `protocol/src/lib/protocol/docs/Latent Opportunity Lifecycle.md`
