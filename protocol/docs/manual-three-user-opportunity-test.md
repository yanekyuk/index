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

| Name              | Email              | Phone           | OTP (for login) |
|-------------------|--------------------|-----------------|------------------|
| Seren Sandikci    | test-1761@example.com | +1 555 555 5724 | 888893           |
| Seref Yarar       | test-9716@example.com | +1 555 555 2920 | 670543           |
| Yanki Ekin Yüksel | test-6285@example.com | +1 555 555 1625 | 607027           |

Use **email + OTP** (or your auth flow) to log in on the frontend.

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

### 1. Log in as User A (Seren Sandikci)

- Email: `test-1761@example.com`
- When prompted, use OTP: **888893**
- Go to **Library** → ensure you’re on **My Intents** (or create an intent if needed).
- Create or use an intent in **Commons**:
  - Go to the index page for Commons (e.g. from **Networks** or **Library**), or create an intent that’s assigned to that index.
- Wait for background jobs (HyDE → opportunity-discovery) to run (usually within a minute, or check BullBoard at `http://localhost:3001/dev/queues`).

### 2. Check opportunities as User A

- Go to **Library** → **My Opportunities** tab.
- You should see opportunities where User A is an actor (e.g. as patient or introducer). Count and list are from `GET /opportunities` (role-based visibility: e.g. patient sees latent; agent may only see after status change).

### 3. Log out and log in as User B (Seref Yarar)

- Log out in the app.
- Log in with email: `test-9716@example.com`, OTP: **670543**.
- Go to **Library** → **My Opportunities**.
- Compare with User A: depending on the opportunity’s actors and status, User B may see **no** opportunities, **fewer**, or **the same** (e.g. if B is the other peer). This validates role-based visibility.

### 4. Log in as User C (Yanki Ekin Yüksel)

- Log out, then log in with email: `test-6285@example.com`, OTP: **607027**.
- Go to **Library** → **My Opportunities**.
- Again compare counts and list with A and B to confirm different users see different sets per role/status.

## What you’re validating

- **Different users** (A, B, C) get **different opportunity lists** from `GET /opportunities` when logged in.
- **Library → My Opportunities** shows **live data** from the API (not mocks).
- **Role-based visibility**: e.g. latent opportunities visible to patient/introducer/peer as designed; agents may only see after status change (see Latent Opportunity Lifecycle).

## Troubleshooting

- **No opportunities for any user**: Ensure intent was created in an index that has HyDE docs and that `intent-hyde` and `opportunity-discovery` jobs ran (check queues and worker logs).
- **Auth origin**: Add the frontend origin (e.g. `http://localhost:3000`) in your auth config (e.g. Better Auth trustedOrigins).
- **OTP not accepted**: Use the OTP from the table, or check your auth provider docs for test authentication.

## Reference

- Seed script: `protocol/src/cli/db-seed.ts`
- Test accounts: `protocol/src/cli/test-data.ts` (`TESTABLE_TEST_ACCOUNTS`)
- Opportunity API: `GET /opportunities` (list for current user), `GET /opportunities/:id` (detail with presentation)
- Visibility rules: `protocol/src/lib/protocol/docs/Latent Opportunity Lifecycle.md`
