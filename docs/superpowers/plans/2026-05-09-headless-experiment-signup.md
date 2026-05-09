# Headless Experiment-Network Signup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `POST /networks/:id/signup` to accept optional rich profile fields, return an MCP server config snippet instead of a connect command, and never send email — fixing the current orphan-agent-on-retry bug as a side effect.

**Architecture:** Extract a `ensureMembership` helper on `NetworkInvitationService` (shared no-email core), update `ExperimentService.signup` to call it with `rotateKey: true` and apply profile patches, update `NetworkController.signup` to validate the richer payload and return `{ user, apiKey, mcpServer }`. Owner-facing UI invite paths (`invite()`, `resendInvite()`, CSV import) are untouched except for a one-line fix in `resendInvite` to accommodate the changed return type of `provisionScopedAgent`.

**Tech Stack:** Bun, TypeScript, Drizzle ORM, PostgreSQL. Tests use `bun:test` with real DB (see `CLAUDE.md` testing section). No test runner flags needed; run with `bun test <path>`.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `backend/src/lib/mcp/mcp-config.ts` | `buildMcpServerConfig(apiKey)` helper |
| Create | `backend/tests/experiment-signup.test.ts` | Integration tests for the new endpoint behaviour |
| Modify | `backend/src/services/network-invitation.service.ts` | Add `ensureMembership`; change `provisionScopedAgent` return type; slim `invite()`; one-line fix in `resendInvite` |
| Modify | `backend/src/services/experiment.service.ts` | New `signup` signature; call `ensureMembership`; call `applyProfilePatch`; return `mcpServer`; drop `connectCommand` |
| Modify | `backend/src/controllers/network.controller.ts` | Extended body validation; new response shape for `signup` handler |
| Modify | `packages/edgeclaw/README.md` | Add Integration API section |
| Modify | `docs/specs/api-reference.md` | Update `POST /api/networks/:id/signup` entry |

---

## Task 1 — Create `buildMcpServerConfig` helper

**Files:**
- Create: `backend/src/lib/mcp/mcp-config.ts`

- [ ] **1.1 Write the failing test inline (it's a pure function, no DB needed)**

In a scratch run — just confirm the function doesn't exist yet:

```bash
cd backend
grep -r "buildMcpServerConfig" src/
```

Expected: no output.

- [ ] **1.2 Create the file**

```typescript
// backend/src/lib/mcp/mcp-config.ts

export interface McpServerConfig {
  name: string;
  url: string;
  headers: Record<string, string>;
}

/**
 * Builds the MCP server config snippet returned by the headless signup endpoint.
 * Callers (EdgeOS, InstaClaw) embed this in their runtime's MCP servers config.
 */
export const buildMcpServerConfig = (apiKey: string): McpServerConfig => ({
  name: 'index',
  url: `${(process.env.BASE_URL || 'https://protocol.index.network').replace(/\/+$/, '')}/mcp`,
  headers: { 'x-api-key': apiKey },
});
```

- [ ] **1.3 Verify it compiles**

```bash
cd backend
bun run lint
```

Expected: no errors on the new file.

- [ ] **1.4 Commit**

```bash
git add backend/src/lib/mcp/mcp-config.ts
git commit -m "feat(mcp): add buildMcpServerConfig helper"
```

---

## Task 2 — Write failing integration tests

**Files:**
- Create: `backend/tests/experiment-signup.test.ts`

These tests exercise `experimentService.signup` directly (service-layer integration tests). They will fail until Tasks 3–4 are implemented.

- [ ] **2.1 Create the test file**

```typescript
// backend/tests/experiment-signup.test.ts

import '../src/startup.env';

import { afterAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';

import { experimentService } from '../src/services/experiment.service';
import { networkInvitationService } from '../src/services/network-invitation.service';
import db from '../src/lib/drizzle/drizzle';
import {
  agentPermissions,
  agents,
  apikeys,
  networkMembers,
  networks,
  personalNetworks,
  userProfiles,
  userSocials,
  users,
} from '../src/schemas/database.schema';

const cleanup: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const f of [...cleanup].reverse()) await f();
});

async function setupExperimentNetwork() {
  const [network] = await db
    .insert(networks)
    .values({
      title: `EdgeClaw Test ${randomUUID().slice(0, 6)}`,
      isExperiment: true,
      isPersonal: false,
      experimentMasterKeyHash: 'test-hash-not-verified-at-service-layer',
    })
    .returning({ id: networks.id });

  cleanup.push(async () => {
    await db.delete(networkMembers).where(eq(networkMembers.networkId, network.id));
    await db.delete(networks).where(eq(networks.id, network.id));
  });

  return { networkId: network.id };
}

async function cleanupUser(userId: string) {
  await db.delete(apikeys).where(eq(apikeys.userId, userId));
  await db.delete(agentPermissions).where(eq(agentPermissions.userId, userId));
  await db.delete(agents).where(eq(agents.ownerId, userId));
  await db.delete(networkMembers).where(eq(networkMembers.userId, userId));
  await db.delete(userSocials).where(eq(userSocials.userId, userId));
  await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
  const pn = await db
    .select({ networkId: personalNetworks.networkId })
    .from(personalNetworks)
    .where(eq(personalNetworks.userId, userId));
  await db.delete(personalNetworks).where(eq(personalNetworks.userId, userId));
  for (const { networkId: pnId } of pn) {
    await db.delete(networks).where(eq(networks.id, pnId));
  }
  await db.delete(users).where(eq(users.id, userId));
}

describe('experimentService.signup', () => {
  it('creates a new user and returns apiKey + mcpServer with minimal payload', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `minimal-${randomUUID()}@example.com`;

    const result = await experimentService.signup(networkId, { email });

    cleanup.push(() => cleanupUser(result.user.id));

    expect(result.user.email).toBe(email);
    expect(result.apiKey).toBeTruthy();
    expect(result.mcpServer).toMatchObject({
      name: 'index',
      url: expect.stringContaining('/mcp'),
      headers: { 'x-api-key': result.apiKey },
    });
    expect(result.created).toBe(true);
  }, 15_000);

  it('stores name, bio, location, and socials from rich payload', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `rich-${randomUUID()}@example.com`;

    const result = await experimentService.signup(networkId, {
      email,
      name: 'Alice Test',
      bio: 'Independent researcher.',
      location: 'Healdsburg, CA',
      socials: [
        { label: 'telegram', value: '@alice_test' },
        { label: 'twitter',  value: 'alice_test' },
      ],
    });

    cleanup.push(() => cleanupUser(result.user.id));

    // user.name
    const [u] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, result.user.id));
    expect(u.name).toBe('Alice Test');

    // profile bio + location
    const [profile] = await db
      .select({ identity: userProfiles.identity })
      .from(userProfiles)
      .where(eq(userProfiles.userId, result.user.id));
    expect((profile.identity as { bio?: string }).bio).toBe('Independent researcher.');
    expect((profile.identity as { location?: string }).location).toBe('Healdsburg, CA');

    // socials
    const socials = await db
      .select({ label: userSocials.label, value: userSocials.value })
      .from(userSocials)
      .where(eq(userSocials.userId, result.user.id));
    expect(socials).toContainEqual({ label: 'telegram', value: '@alice_test' });
    expect(socials).toContainEqual({ label: 'twitter',  value: 'alice_test' });
  }, 15_000);

  it('re-signup rotates the key on the SAME agent — no orphan agent records', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `resig-${randomUUID()}@example.com`;

    const first = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(first.user.id));

    const second = await experimentService.signup(networkId, { email });

    // different key returned
    expect(second.apiKey).not.toBe(first.apiKey);

    // only one agent record for this user+network
    const scopedAgents = await db
      .select({ id: agents.id })
      .from(agents)
      .innerJoin(agentPermissions, eq(agentPermissions.agentId, agents.id))
      .where(
        and(
          eq(agentPermissions.userId, first.user.id),
          eq(agentPermissions.scope, 'network'),
          eq(agentPermissions.scopeId, networkId),
          isNull(agents.deletedAt),
        ),
      );
    expect(scopedAgents.length).toBe(1);

    // old key is gone (revoked)
    const oldKeyRow = await db
      .select({ id: apikeys.id })
      .from(apikeys)
      .where(and(eq(apikeys.userId, first.user.id), eq(apikeys.start, first.apiKey.slice(0, 4))));
    expect(oldKeyRow.length).toBe(0);
  }, 15_000);

  it('returns created=false for an existing user', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `existing-${randomUUID()}@example.com`;

    const first = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(first.user.id));

    const second = await experimentService.signup(networkId, { email });

    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
  }, 15_000);
});

describe('networkInvitationService.invite — regression after refactor', () => {
  it('still provisions a scoped agent and sets agentProvisioned=true for a new user', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `reg-${randomUUID()}@example.com`;

    const result = await networkInvitationService.invite({ networkId, email });
    cleanup.push(() => cleanupUser(result.user.id));

    expect(result.agentProvisioned).toBe(true);
    expect(result.apiKey).toBeTruthy();
    expect(result.created).toBe(true);

    // one scoped agent record
    const scopedAgents = await db
      .select({ id: agents.id })
      .from(agents)
      .innerJoin(agentPermissions, eq(agentPermissions.agentId, agents.id))
      .where(
        and(
          eq(agentPermissions.userId, result.user.id),
          eq(agentPermissions.scope, 'network'),
          eq(agentPermissions.scopeId, networkId),
          isNull(agents.deletedAt),
        ),
      );
    expect(scopedAgents.length).toBe(1);
  }, 15_000);

  it('returns agentProvisioned=false and apiKey=null when user already has a scoped agent', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `reg2-${randomUUID()}@example.com`;

    const first = await networkInvitationService.invite({ networkId, email });
    cleanup.push(() => cleanupUser(first.user.id));

    const second = await networkInvitationService.invite({ networkId, email });

    expect(second.agentProvisioned).toBe(false);
    expect(second.apiKey).toBeNull();
  }, 15_000);
});
```

- [ ] **2.2 Run the tests and confirm they fail** (expected — implementations not updated yet)

```bash
cd backend
bun test tests/experiment-signup.test.ts
```

Expected: tests in `experimentService.signup` fail because `signup` doesn't accept the rich payload yet and returns `connectCommand` not `mcpServer`. Regression tests in `networkInvitationService.invite` may pass since `invite()` is unchanged so far.

- [ ] **2.3 Commit the test file**

```bash
git add backend/tests/experiment-signup.test.ts
git commit -m "test(experiment): add failing tests for headless signup redesign"
```

---

## Task 3 — Refactor `NetworkInvitationService`

**Files:**
- Modify: `backend/src/services/network-invitation.service.ts`

Three changes:
1. `provisionScopedAgent` return type: `string` → `{ apiKey: string; agentId: string }`.
2. New public `ensureMembership` method.
3. `invite()` re-implemented using `ensureMembership`.
4. One-line fix in `resendInvite` for the changed `provisionScopedAgent` return.

- [ ] **3.1 Update `provisionScopedAgent` return type and one-line fix in `resendInvite`**

Replace the `provisionScopedAgent` implementation (currently returns `token.key`):

```typescript
// In NetworkInvitationService class — replace the existing provisionScopedAgent method

  async provisionScopedAgent(userId: string, networkId: string): Promise<{ apiKey: string; agentId: string }> {
    const agent = await agentDatabaseAdapter.createAgent({
      ownerId: userId,
      name: 'Personal Agent',
      type: 'personal',
    });
    await agentDatabaseAdapter.grantPermission({
      agentId: agent.id,
      userId,
      scope: 'network',
      scopeId: networkId,
      actions: [...SCOPED_INVITED_AGENT_ACTIONS],
    });
    const token = await agentTokenAdapter.create(userId, {
      name: 'Personal Agent API Key',
      agentId: agent.id,
    });
    return { apiKey: token.key, agentId: agent.id };
  }
```

In `resendInvite`, find this block and apply the one-line fix:

```typescript
// OLD (search for this exact block):
      } else {
        apiKey = await this.provisionScopedAgent(memberId, networkId);
        rotated = false;
      }

// NEW:
      } else {
        const provision = await this.provisionScopedAgent(memberId, networkId);
        apiKey = provision.apiKey;
        rotated = false;
      }
```

- [ ] **3.2 Add `EnsureMembershipResult` interface export and `ensureMembership` method**

Add the new interface to the exports section at the top of the file (after the existing exported interfaces):

```typescript
export interface EnsureMembershipResult {
  user: { id: string; email: string };
  /** Raw API key. Null when rotateKey=false and the user already had a scoped agent. */
  apiKey: string | null;
  created: boolean;
  alreadyMember: boolean;
}
```

Add `ensureMembership` as a public method on `NetworkInvitationService` (place it before `invite`):

```typescript
  /**
   * Idempotent membership-and-agent provisioning without any email side-effects.
   * Used by the headless signup path. `invite()` wraps this and adds email delivery.
   *
   * @param params.rotateKey - When true and a scoped agent already exists, revokes
   *   its tokens and mints a fresh one (returns new key). When false, returns
   *   apiKey=null for users who already have a scoped agent.
   */
  async ensureMembership(params: {
    networkId: string;
    email: string;
    name?: string;
    rotateKey?: boolean;
  }): Promise<EnsureMembershipResult> {
    const email = params.email.toLowerCase().trim();
    const rotateKey = params.rotateKey ?? false;

    const { user, created } = await this.findOrCreateUser(email, params.name);
    await ensurePersonalNetwork(user.id);
    const { alreadyMember } = await this.joinNetwork(user.id, params.networkId);

    const agentId = await this.findScopedAgentId(user.id, params.networkId);
    if (agentId) {
      if (rotateKey) {
        await agentTokenAdapter.revokeAllForAgent(agentId);
        const token = await agentTokenAdapter.create(user.id, {
          name: 'Personal Agent API Key',
          agentId,
        });
        return { user, apiKey: token.key, created, alreadyMember };
      }
      logger.info('[NetworkInvitation] Skipping provisioning; scoped agent already exists', {
        userId: user.id,
        networkId: params.networkId,
      });
      return { user, apiKey: null, created, alreadyMember };
    }

    // No existing agent — provision fresh
    const { apiKey } = await this.provisionScopedAgent(user.id, params.networkId);
    return { user, apiKey, created, alreadyMember };
  }
```

- [ ] **3.3 Slim `invite()` to delegate to `ensureMembership`**

Replace the existing `invite()` method body entirely:

```typescript
  async invite(params: InviteParams): Promise<InviteResult> {
    const email = params.email.toLowerCase().trim();

    const result = await this.ensureMembership({
      networkId: params.networkId,
      email,
      name: params.name,
      rotateKey: false,
    });

    if (result.apiKey) {
      const networkName = await this.lookupNetworkName(params.networkId);
      const connectCommand = buildConnectCommand(result.apiKey);
      await this.dispatchInvitationEmail({
        to: email,
        networkName,
        apiKey: result.apiKey,
        connectCommand,
      });
      logger.info('[NetworkInvitation] Provisioned scoped agent + invited', {
        userId: result.user.id,
        networkId: params.networkId,
      });
    }

    return {
      user: result.user,
      apiKey: result.apiKey,
      created: result.created,
      alreadyMember: result.alreadyMember,
      agentProvisioned: result.apiKey !== null,
    };
  }
```

The old private `hasScopedAgent` method is now dead code (replaced by `findScopedAgentId` inside `ensureMembership`). **Remove it.**

- [ ] **3.4 Run the regression tests to verify `invite()` still works**

```bash
cd backend
bun test tests/network-invitation-resend.test.ts tests/experiment-signup.test.ts
```

Expected: `network-invitation-resend.test.ts` fully passes. In `experiment-signup.test.ts`, the `networkInvitationService.invite — regression` describe block now passes. The `experimentService.signup` tests still fail (Task 4 not done).

- [ ] **3.5 Commit**

```bash
git add backend/src/services/network-invitation.service.ts
git commit -m "refactor(network-invitation): extract ensureMembership, fix orphan-agent on re-signup"
```

---

## Task 4 — Update `ExperimentService.signup`

**Files:**
- Modify: `backend/src/services/experiment.service.ts`

- [ ] **4.1 Add `McpServerConfig` import and update exported interfaces**

At the top of `experiment.service.ts`, add the import:

```typescript
import { buildMcpServerConfig } from '../lib/mcp/mcp-config';
```

Remove the existing `connectCommand` field from `ExperimentSignupResult` and add the new interfaces:

```typescript
export interface SignupPayload {
  email: string;
  name?: string;
  bio?: string;
  location?: string;
  socials?: { label: string; value: string }[];
}

export interface ExperimentSignupResult {
  user: { id: string; email: string };
  apiKey: string;
  mcpServer: {
    name: string;
    url: string;
    headers: Record<string, string>;
  };
  created: boolean;
}
```

- [ ] **4.2 Replace the `signup` method body**

Replace the full `signup` method (currently accepts `(networkId: string, email: string)`):

```typescript
  async signup(networkId: string, payload: SignupPayload): Promise<ExperimentSignupResult> {
    const normalizedEmail = payload.email.toLowerCase().trim();
    logger.verbose('[ExperimentService] Signup attempt', { networkId, email: normalizedEmail });

    const result = await networkInvitationService.ensureMembership({
      networkId,
      email: normalizedEmail,
      name: payload.name,
      rotateKey: true,
    });

    // rotateKey=true guarantees apiKey is non-null
    const apiKey = result.apiKey!;

    if (payload.name || payload.bio || payload.location || (payload.socials && payload.socials.length > 0)) {
      await this.applyProfilePatch(result.user.id, {
        email: normalizedEmail,
        name: payload.name,
        bio: payload.bio,
        location: payload.location,
        socials: payload.socials ?? [],
      });
    }

    logger.info('[ExperimentService] Signup complete', {
      userId: result.user.id,
      networkId,
      created: result.created,
    });

    return {
      user: result.user,
      apiKey,
      mcpServer: buildMcpServerConfig(apiKey),
      created: result.created,
    };
  }
```

Also remove the now-unused import of `buildConnectCommand` from `'../lib/openclaw/connect-command'` if it is no longer referenced anywhere in this file.

- [ ] **4.3 Run the `experimentService.signup` tests — expect them to pass now**

```bash
cd backend
bun test tests/experiment-signup.test.ts
```

Expected: all tests pass.

- [ ] **4.4 Verify `importMembers` still compiles** (it uses `applyProfilePatch` but not `signup`)

```bash
cd backend
bun run lint
```

Expected: no errors.

- [ ] **4.5 Commit**

```bash
git add backend/src/services/experiment.service.ts
git commit -m "feat(experiment): accept rich signup payload, return mcpServer, drop email"
```

---

## Task 5 — Update `NetworkController.signup`

**Files:**
- Modify: `backend/src/controllers/network.controller.ts`

- [ ] **5.1 Update the `signup` handler**

Replace the entire `signup` handler (the `@Post('/:id/signup')` method):

```typescript
  /**
   * Headless signup for experiment networks. Authenticated via master key (x-api-key header).
   * Accepts an optional rich profile payload; returns the user, API key, and MCP server config.
   * Never sends email — the integrator (InstaClaw / EdgeOS) is the delivery channel.
   */
  @Post('/:id/signup')
  async signup(req: Request, _user: unknown, params: Record<string, string>) {
    let network: ExperimentNetwork;
    try {
      network = await ExperimentMasterKeyGuard(req, params);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    const body = await req.json().catch(() => ({})) as {
      email?: string;
      name?: string;
      bio?: string;
      location?: string;
      socials?: unknown;
    };

    if (!body.email || typeof body.email !== 'string') {
      return new Response(JSON.stringify({ error: 'email is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!EMAIL_REGEX.test(body.email)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) || undefined : undefined;
    const bio = typeof body.bio === 'string' ? body.bio.trim().slice(0, 2000) || undefined : undefined;
    const location = typeof body.location === 'string' ? body.location.trim().slice(0, 200) || undefined : undefined;

    let socials: { label: string; value: string }[] | undefined;
    if (body.socials !== undefined) {
      if (!Array.isArray(body.socials)) {
        return new Response(JSON.stringify({ error: 'socials must be an array' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if ((body.socials as unknown[]).length > 32) {
        return new Response(JSON.stringify({ error: 'socials exceeds maximum of 32 entries' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const parsed: { label: string; value: string }[] = [];
      for (const entry of body.socials as unknown[]) {
        if (
          typeof entry !== 'object' ||
          entry === null ||
          typeof (entry as Record<string, unknown>).label !== 'string' ||
          typeof (entry as Record<string, unknown>).value !== 'string'
        ) {
          return new Response(JSON.stringify({ error: 'Each social entry must have label (string) and value (string)' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const { label, value } = entry as { label: string; value: string };
        parsed.push({
          label: label.trim().slice(0, 64),
          value: value.trim().slice(0, 256),
        });
      }
      socials = parsed;
    }

    try {
      const result = await experimentService.signup(network.id, {
        email: body.email,
        name,
        bio,
        location,
        socials,
      });
      return Response.json(
        { user: result.user, apiKey: result.apiKey, mcpServer: result.mcpServer },
        { status: result.created ? 201 : 200 },
      );
    } catch (err: unknown) {
      logger.error('Experiment signup failed', { networkId: network.id, error: errorMessage(err) });
      return new Response(JSON.stringify({ error: 'Signup failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
```

Also update the import of `experimentService` at the top — remove `type ImportRow` from the `experiment.service` import if `ImportRow` is no longer used in the controller (it still is, via `importMembers` handler). Keep it.

Update the import to include `SignupPayload` is not needed — the controller doesn't need that type; it validates inline and delegates to the service.

- [ ] **5.2 Run lint + typecheck**

```bash
cd backend
bun run lint
```

Expected: no errors.

- [ ] **5.3 Run all touched tests**

```bash
cd backend
bun test tests/experiment-signup.test.ts tests/network-invitation-resend.test.ts
```

Expected: all pass.

- [ ] **5.4 Commit**

```bash
git add backend/src/controllers/network.controller.ts
git commit -m "feat(network-controller): extend signup — rich payload, mcpServer response, no connectCommand"
```

---

## Task 6 — Full test run

- [ ] **6.1 Run both test files together**

```bash
cd backend
bun test tests/experiment-signup.test.ts tests/network-invitation-resend.test.ts
```

Expected: all tests pass. Note the exact count to confirm nothing is unexpectedly skipped.

- [ ] **6.2 Run lint across the whole backend**

```bash
cd backend
bun run lint
```

Expected: no errors.

- [ ] **6.3 Commit checkpoint (if not already clean)**

```bash
git status
```

If anything unstaged, investigate before continuing.

---

## Task 7 — Update `packages/edgeclaw/README.md`

**Files:**
- Modify: `packages/edgeclaw/README.md`

Keep the existing "Getting an agent connected" section (attendee-facing, unchanged). Add a new `## Integration API` section immediately after it, before `## Prerequisites`.

- [ ] **7.1 Add the Integration API section**

Insert the following block between the end of the "Getting an agent connected" section and the `## Prerequisites` heading:

```markdown
## Integration API

The integration API is for **InstaClaw** and **EdgeOS** — the two systems that provision agents on behalf of attendees. End users do not call this directly.

### Authentication

All requests use the experiment network's **master key** as a bearer token:

```
x-api-key: <masterKey>
```

The master key is issued once when the experiment network is created in the Index Network dashboard and is never re-shown.

### POST /api/networks/:id/signup

Provisions (or re-provisions) an attendee's Index Network account and returns an API key bound to a network-scoped agent. No email is sent — the caller is responsible for delivering the key to the attendee.

**Request**

```
POST https://protocol.index.network/api/networks/<NETWORK_ID>/signup
Content-Type: application/json
x-api-key: <masterKey>
```

**Body** (`email` is the only required field):

```json
{
  "email": "alice@example.com",
  "name": "Alice Example",
  "bio": "Independent researcher on coordination problems.",
  "location": "Healdsburg, CA",
  "socials": [
    { "label": "telegram", "value": "@alice" },
    { "label": "twitter",  "value": "alice_eg" }
  ]
}
```

| Field | Required | Max | Notes |
|---|---|---|---|
| `email` | yes | — | Lowercased + trimmed. |
| `name` | no | 200 chars | Overwrites stored name when present. |
| `bio` | no | 2000 chars | |
| `location` | no | 200 chars | |
| `socials` | no | 32 entries | Open vocabulary — any string labels (`telegram`, `twitter`, `github`, `farcaster`, …). Upserted by label. |

**Response**

```json
{
  "user":   { "id": "<uuid>", "email": "alice@example.com" },
  "apiKey": "ix_...",
  "mcpServer": {
    "name":    "index",
    "url":     "https://protocol.index.network/mcp",
    "headers": { "x-api-key": "ix_..." }
  }
}
```

HTTP `201` if the user was newly created; `200` if they already existed.

`mcpServer` is the JSON object to write into the runtime's MCP servers config (standard across Claude Code, OpenClaw, Hermes, and most other MCP-compatible runtimes).

**Idempotency**

Every call with the same email returns the same user but a **fresh API key** — the previous key is revoked. Store the key returned by the latest call. If the integrator retries before delivering the key to the attendee, the retried call's key supersedes the earlier one.

**Errors**

| Code | Reason |
|---|---|
| 400 | Missing or invalid email; oversized field; malformed `socials` array. |
| 401 | Missing `x-api-key` header. |
| 403 | Master key invalid; network not in experiment mode; network deleted. |

### What InstaClaw does after signup

1. Runs the EdgeClaw installer with the returned `apiKey`: `bun packages/edgeclaw/install/install.ts <apiKey>` (or equivalent in the hosted runtime).
2. In a follow-up step, captures the attendee's Telegram handle and binds it to their agent transport — this is entirely InstaClaw-owned and happens outside this endpoint.

### What EdgeOS does after signup

Displays the returned `mcpServer` object to the attendee as a copyable config snippet. The attendee pastes it into their agent's MCP servers config (or runs `bun packages/edgeclaw/install/install.ts <apiKey>` from a clone of this repo).
```

- [ ] **7.2 Verify README renders cleanly** (check no broken fences or stray backticks)

```bash
grep -n '^\`\`\`' packages/edgeclaw/README.md | head -30
```

Confirm every opening fence has a matching close (even count of triple-backtick lines).

- [ ] **7.3 Commit**

```bash
git add packages/edgeclaw/README.md
git commit -m "docs(edgeclaw): add Integration API section for InstaClaw and EdgeOS"
```

---

## Task 8 — Update `docs/specs/api-reference.md`

**Files:**
- Modify: `docs/specs/api-reference.md`

Replace lines 1745–1776 (the current `POST /api/networks/:id/signup` entry, which documents the old email + email-only + `connectCommand` contract).

- [ ] **8.1 Replace the signup entry**

Find and replace the block from `### POST /api/networks/:id/signup` through the closing `---` separator:

```markdown
### POST /api/networks/:id/signup

Headless experiment-network signup. Provisions or re-provisions a user account and returns an API key bound to a network-scoped personal agent. Never sends email.

**Auth**: `ExperimentMasterKeyGuard` — `x-api-key` header containing the network's master key (issued once at network creation, stored by the caller).

**Path params**:
- `id` — Network ID (must be an experiment network with a master key set).

**Request body** (`email` required; all other fields optional):
```json
{
  "email": "attendee@example.com",
  "name": "Alice Example",
  "bio": "Independent researcher.",
  "location": "Healdsburg, CA",
  "socials": [
    { "label": "telegram", "value": "@alice" }
  ]
}
```

Validation caps: `name` 200 chars, `bio` 2000 chars, `location` 200 chars, `socials` ≤ 32 entries, each `label` 64 chars, each `value` 256 chars. `socials` labels are open vocabulary.

**Response 201** (new user created):
```json
{
  "user":   { "id": "uuid", "email": "attendee@example.com" },
  "apiKey": "ix_...",
  "mcpServer": {
    "name": "index",
    "url": "https://protocol.index.network/mcp",
    "headers": { "x-api-key": "ix_..." }
  }
}
```

**Response 200** (existing user): Same shape. A fresh API key is always returned; the previous key for this user+network is revoked on each call.

**Idempotency**: Same email = same user. Key is rotated on every call — store the latest returned `apiKey`. No orphan agent records: repeated calls reuse the same scoped agent and rotate its token.

**Errors**:
- `400` — Missing/invalid email; oversized field; malformed `socials` array.
- `401` — Missing `x-api-key` header.
- `403` — Master key invalid; network not experiment type; network deleted.

---
```

- [ ] **8.2 Commit**

```bash
git add docs/specs/api-reference.md
git commit -m "docs(api-reference): update POST /networks/:id/signup — rich payload, mcpServer, no connectCommand"
```

---

## Self-Review

Spec section → task coverage:

| Spec requirement | Task |
|---|---|
| Accept optional name/bio/location/socials | Task 4 (`signup` body), Task 5 (controller validation) |
| Return `mcpServer` in response | Task 1 (helper), Task 4 (service), Task 5 (controller) |
| No email from `/signup` | Task 3 (`ensureMembership` has no email path), Task 4 (service bypasses `invite()`) |
| Fix orphan-agent on re-signup | Task 3 (`ensureMembership` reuses existing agentId) |
| Validation caps | Task 5 (controller) |
| `created` flag in response | Task 4 (service returns it), Task 5 (controller uses for 201 vs 200) |
| Regression: `invite()` still emails | Task 3 (preserves email in `invite()`), Task 2 (regression test) |
| `resendInvite` unchanged externally | Task 3 (only one-line internal fix) |
| README integration docs | Task 7 |
| API reference update | Task 8 |
| `connectCommand` removed from response | Task 4 (`ExperimentSignupResult` drops field), Task 5 (controller doesn't return it) |

No gaps found.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-05-09-headless-experiment-signup.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
