# Resend Network Invitation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-member "Resend invitation" button to the experimental network settings panel. Each click rotates the member's network-scoped API key (deletes old, mints new) and emails the new key to the member. Owner-only; owner can rotate their own key as well.

**Architecture:**
- Backend: new endpoint `POST /networks/:id/members/:memberId/resend-invite` → new service method `networkInvitationService.resendInvite(...)` → existing `agentDatabaseAdapter` + new helper `agentTokenAdapter.revokeAllForAgent(agentId)` → existing email transport via the (extended) `network-invitation.template`.
- Frontend: new icon button beside the trash icon in `NetworkSettingsPanel.tsx`, gated on `currentIndex.isExperiment`. Confirmation via Radix `AlertDialog` matching the existing delete-network pattern. New `resendInvite` method in `frontend/src/services/networks.ts`.

**Tech Stack:** Bun, TypeScript, Drizzle ORM (Postgres + pgvector), Better Auth (apikey table), React 19 + Vite, Radix UI, Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-05-09-resend-network-invitation-design.md` and Linear issue `IND-261`.

---

## File Structure

**Backend (modify):**
- `backend/src/lib/email/templates/network-invitation.template.ts` — add `isResend?: boolean` flag to params; when true, switch subject and prepend addendum line.
- `backend/src/adapters/agent-token.adapter.ts` — add `revokeAllForAgent(agentId)` method.
- `backend/src/services/network-invitation.service.ts` — add `resendInvite({ networkId, memberId })` method; thread `isResend` through `dispatchInvitationEmail`.
- `backend/src/controllers/network.controller.ts` — register new `POST /:id/members/:memberId/resend-invite` route.

**Backend (new tests):**
- `backend/src/lib/email/tests/network-invitation.template.test.ts` — pure template assertions.
- `backend/tests/agent-token-adapter.test.ts` — adapter integration test against real DB.
- `backend/tests/network-invitation-resend.test.ts` — service integration test (rotation + provisioning branches).
- `backend/tests/network-resend-invite.e2e.test.ts` — controller E2E (auth, ownership, 200/403/404).

**Frontend (modify):**
- `frontend/src/services/networks.ts` — add `resendInvite(networkId, memberId)` to the live service object and to the noop fallback at the bottom.
- `frontend/src/components/NetworkSettingsPanel.tsx` — add `RotateCw` icon button, AlertDialog, dispatch handler.

---

## Conventions to Follow

- **Test bootstrap:** every backend test starts with `import '../src/startup.env';` at the top, then `import { afterAll, beforeAll, describe, expect, it } from 'bun:test';`. See `backend/tests/experiment-signup.test.ts` for the canonical pattern.
- **Schema imports:** always import tables from `backend/src/schemas/database.schema.ts` (e.g. `apikeys`, `agentPermissions`, `agents`, `networkMembers`, `users`).
- **Drizzle JSON predicate:** `apikey.metadata` is stored as a JSON-encoded string (`JSON.stringify({ agentId })`). Use a `sql` template tag with the cast operator: `sql\`(\${apikeys.metadata})::jsonb->>'agentId' = \${agentId}\``. Import `sql` from `drizzle-orm`.
- **Controller method shape:** `async fn(req: Request, user: AuthenticatedUser, params: Record<string, string>): Promise<Response>` returning `Response.json(...)`. Decorators: `@Post('/...')` and `@UseGuards(AuthOrApiKeyGuard)`. Use the existing `assertExperimentOwner(networkId, userId)` private method and `assertAgentNetworkScope(req, networkId)` import for scoped-key clamping (mirror `importMembers`).
- **Layering:** controllers must not import adapters; the service handles all adapter calls. Services must not import other services.
- **Type-safe `unknown`:** no `any`. Narrow via `as` only for known external shapes.
- **Code quality gate after every task:** run `bun run lint` and `tsc --noEmit` from `backend/` (or `frontend/` for FE tasks). The repo's project memory mandates this before claiming completion.

---

## Task 1: Email template — `isResend` flag

**Files:**
- Modify: `backend/src/lib/email/templates/network-invitation.template.ts`
- Test (new): `backend/src/lib/email/tests/network-invitation.template.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/lib/email/tests/network-invitation.template.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import { networkInvitationTemplate } from '../templates/network-invitation.template';

describe('networkInvitationTemplate', () => {
  const baseParams = {
    networkName: 'Experiment X',
    apiKey: 'a-very-secret-key',
    connectCommand: 'openclaw connect --key=a-very-secret-key',
  };

  it('renders the original invitation when isResend is omitted', () => {
    const out = networkInvitationTemplate(baseParams);
    expect(out.subject).toBe('Your invitation to Experiment X');
    expect(out.text).toContain("You've been added to Experiment X");
    expect(out.text).not.toContain('previous key has been revoked');
    expect(out.html).not.toContain('previous key has been revoked');
  });

  it('renders the original invitation when isResend is false', () => {
    const out = networkInvitationTemplate({ ...baseParams, isResend: false });
    expect(out.subject).toBe('Your invitation to Experiment X');
    expect(out.text).not.toContain('previous key has been revoked');
  });

  it('renders the refreshed variant when isResend is true', () => {
    const out = networkInvitationTemplate({ ...baseParams, isResend: true });
    expect(out.subject).toBe('Your access key for Experiment X (refreshed)');
    expect(out.text.startsWith('Your previous key has been revoked. Use the key below going forward.')).toBe(true);
    expect(out.html).toContain('Your previous key has been revoked. Use the key below going forward.');
    // Body still contains the key and connect command
    expect(out.text).toContain(baseParams.apiKey);
    expect(out.text).toContain(baseParams.connectCommand);
  });

  it('strips control chars from refreshed subject just like the original', () => {
    const out = networkInvitationTemplate({
      ...baseParams,
      networkName: 'Bad\r\nNetwork',
      isResend: true,
    });
    expect(out.subject).toBe('Your access key for Bad Network (refreshed)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`:
```bash
bun test src/lib/email/tests/network-invitation.template.test.ts
```
Expected: failures — current template ignores `isResend` and produces the original subject/body unconditionally.

- [ ] **Step 3: Modify the template**

Edit `backend/src/lib/email/templates/network-invitation.template.ts` so that `NetworkInvitationParams` accepts an optional `isResend?: boolean` and the body/subject branch on it. Final file content:

```ts
import { escapeHtml } from '../../escapeHtml';

export interface NetworkInvitationParams {
  networkName: string;
  apiKey: string;
  connectCommand: string;
  /** When true, render the "key has been refreshed" variant. */
  isResend?: boolean;
}

export interface NetworkInvitationEmail {
  subject: string;
  html: string;
  text: string;
}

const REFRESH_NOTE = 'Your previous key has been revoked. Use the key below going forward.';

/**
 * Plain-text + HTML invitation that delivers the user's raw API key. Possession
 * of this email is the user's verification — the key is bound to a single
 * network via the agent's `agent_permissions.scope='network'` row.
 *
 * When `isResend` is true, the subject and body are switched to the "refreshed
 * key" variant. This is sent by `networkInvitationService.resendInvite`.
 */
export const networkInvitationTemplate = (
  p: NetworkInvitationParams,
): NetworkInvitationEmail => {
  const safeNetwork = escapeHtml(p.networkName);
  const safeKey = escapeHtml(p.apiKey);
  const safeCmd = escapeHtml(p.connectCommand);
  const subjectName = p.networkName.replace(/[\r\n\t\f\v\0]+/g, ' ').trim().slice(0, 200);

  const subject = p.isResend
    ? `Your access key for ${subjectName} (refreshed)`
    : `Your invitation to ${subjectName}`;

  const refreshLeadHtml = p.isResend
    ? `<p>${escapeHtml(REFRESH_NOTE)}</p>\n  `
    : '';
  const refreshLeadText = p.isResend ? `${REFRESH_NOTE}\n\n` : '';
  const introLine = p.isResend
    ? `<p>You're using <strong>${safeNetwork}</strong> on Index Network.</p>`
    : `<p>You've been added to <strong>${safeNetwork}</strong> on Index Network.</p>`;
  const introTextLine = p.isResend
    ? `You're using ${p.networkName} on Index Network.`
    : `You've been added to ${p.networkName} on Index Network.`;

  return {
    subject,
    html: `<div style="font-family: Arial, sans-serif;">
  ${refreshLeadHtml}${introLine}
  <p>Your personal agent's API key:</p>
  <pre style="font-family: monospace; background: #f6f6f6; padding: 12px; border-radius: 6px;">${safeKey}</pre>
  <p>To connect a self-hosted OpenClaw agent, run:</p>
  <pre style="font-family: monospace; background: #f6f6f6; padding: 12px; border-radius: 6px;">${safeCmd}</pre>
  <p>This key is bound to ${safeNetwork} only. Treat it like a password.</p>
  <div style="margin-top: 20px; text-align: center;">
    <img src="https://index.network/logo.png" alt="Index" style="height: 24px; opacity: 0.5;" />
  </div>
</div>`,
    text: `${refreshLeadText}${introTextLine}

Your personal agent's API key:
${p.apiKey}

To connect a self-hosted OpenClaw agent, run:
${p.connectCommand}

This key is bound to ${p.networkName} only. Treat it like a password.`,
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/lib/email/tests/network-invitation.template.test.ts
```
Expected: 4/4 pass.

- [ ] **Step 5: Lint + typecheck**

```bash
bun run lint
bun run build  # invokes `tsc` via the build script
```
Expected: zero errors. (The `build` script is `tsc` — no emit needed for verification but it surfaces type errors.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/email/templates/network-invitation.template.ts backend/src/lib/email/tests/network-invitation.template.test.ts
git commit -m "feat(email): add isResend variant to network invitation template"
```

---

## Task 2: AgentTokenAdapter — `revokeAllForAgent`

**Files:**
- Modify: `backend/src/adapters/agent-token.adapter.ts`
- Test (new): `backend/tests/agent-token-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/agent-token-adapter.test.ts`:

```ts
import '../src/startup.env';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';

import { agentTokenAdapter } from '../src/adapters/agent-token.adapter';
import db from '../src/lib/drizzle/drizzle';
import { agents, apikeys, users } from '../src/schemas/database.schema';

describe('agentTokenAdapter.revokeAllForAgent', () => {
  let userId = '';
  let agentId = '';
  let otherAgentId = '';

  beforeAll(async () => {
    const email = `test-revoke-${randomUUID()}@example.com`;
    const [u] = await db.insert(users).values({ email, name: 'Revoke Test', emailVerified: true, isGhost: false }).returning({ id: users.id });
    userId = u.id;
    const [a] = await db.insert(agents).values({ ownerId: userId, name: 'Agent A', type: 'personal' }).returning({ id: agents.id });
    agentId = a.id;
    const [b] = await db.insert(agents).values({ ownerId: userId, name: 'Agent B', type: 'personal' }).returning({ id: agents.id });
    otherAgentId = b.id;
  });

  afterAll(async () => {
    await db.delete(apikeys).where(eq(apikeys.userId, userId));
    await db.delete(agents).where(eq(agents.ownerId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it('deletes only api keys whose metadata.agentId matches', async () => {
    await agentTokenAdapter.create(userId, { name: 'k1', agentId });
    await agentTokenAdapter.create(userId, { name: 'k2', agentId });
    await agentTokenAdapter.create(userId, { name: 'other', agentId: otherAgentId });

    const removed = await agentTokenAdapter.revokeAllForAgent(agentId);
    expect(removed).toBe(2);

    const remaining = await db
      .select({ id: apikeys.id, metadata: apikeys.metadata })
      .from(apikeys)
      .where(eq(apikeys.userId, userId));
    expect(remaining.length).toBe(1);
    const meta = JSON.parse(remaining[0].metadata as unknown as string) as { agentId: string };
    expect(meta.agentId).toBe(otherAgentId);
  });

  it('returns 0 when no tokens exist for the agent', async () => {
    const removed = await agentTokenAdapter.revokeAllForAgent(agentId);
    expect(removed).toBe(0);
  });

  it('uses jsonb cast and is not vulnerable to SQL injection through agentId', async () => {
    await agentTokenAdapter.create(userId, { name: 'k', agentId });
    const malicious = `${agentId}' OR '1'='1`;
    const removed = await agentTokenAdapter.revokeAllForAgent(malicious);
    expect(removed).toBe(0);
    // Sanity: the legitimate row is still present.
    const stillThere = await db
      .select({ id: apikeys.id })
      .from(apikeys)
      .where(sql`(${apikeys.metadata})::jsonb->>'agentId' = ${agentId}`);
    expect(stillThere.length).toBe(1);
    // Cleanup so subsequent tests start fresh.
    await agentTokenAdapter.revokeAllForAgent(agentId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/agent-token-adapter.test.ts
```
Expected: TypeScript/runtime failure — `revokeAllForAgent` does not exist on the adapter.

- [ ] **Step 3: Implement `revokeAllForAgent`**

Edit `backend/src/adapters/agent-token.adapter.ts`. The file uses `import * as schema from '../schemas/database.schema'` (so all table references go through `schema.apikeys`). Add `sql` to the existing `drizzle-orm` import, extend the `AgentTokenStore` interface, and implement the method.

Update the existing imports at the top:

```ts
import { and, eq, sql } from 'drizzle-orm';
```

Extend the `AgentTokenStore` interface:

```ts
export interface AgentTokenStore {
  create(userId: string, params: { name: string; agentId: string }): Promise<CreateAgentTokenResult>;
  list(userId: string): Promise<AgentTokenRecord[]>;
  revoke(userId: string, tokenId: string): Promise<void>;
  /** Hard-deletes every api key whose metadata.agentId matches. Returns row count. */
  revokeAllForAgent(agentId: string): Promise<number>;
}
```

Add the method to `AgentTokenAdapter` (after the existing `revoke` method):

```ts
  /**
   * Hard-deletes every api key whose `metadata.agentId` matches the given
   * agent id. The `metadata` column stores a JSON-encoded string, so the
   * predicate must cast to `jsonb` before extracting the field.
   *
   * @param agentId - the agent whose tokens should be revoked
   * @returns the number of rows deleted
   */
  async revokeAllForAgent(agentId: string): Promise<number> {
    const result = await db
      .delete(schema.apikeys)
      .where(sql`(${schema.apikeys.metadata})::jsonb->>'agentId' = ${agentId}`)
      .returning({ id: schema.apikeys.id });
    return result.length;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/agent-token-adapter.test.ts
```
Expected: 3/3 pass.

- [ ] **Step 5: Lint + typecheck**

```bash
bun run lint
bun run build
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/adapters/agent-token.adapter.ts backend/tests/agent-token-adapter.test.ts
git commit -m "feat(agent-token): add revokeAllForAgent helper for key rotation"
```

---

## Task 3: NetworkInvitationService — `resendInvite`

**Files:**
- Modify: `backend/src/services/network-invitation.service.ts`
- Test (new): `backend/tests/network-invitation-resend.test.ts`

This task drives three behaviors (rotation, provisioning, missing-member) one at a time, TDD-style.

### 3a. Rotation branch (existing scoped agent)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/network-invitation-resend.test.ts`:

```ts
import '../src/startup.env';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { networkInvitationService } from '../src/services/network-invitation.service';
import db from '../src/lib/drizzle/drizzle';
import {
  agentPermissions,
  agents,
  apikeys,
  networkMembers,
  networks,
  users,
} from '../src/schemas/database.schema';

const cleanup: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const f of cleanup.reverse()) await f();
});

async function setupNetworkAndOwner() {
  const ownerEmail = `owner-${randomUUID()}@example.com`;
  const [owner] = await db
    .insert(users)
    .values({ email: ownerEmail, name: 'Owner', emailVerified: true, isGhost: false })
    .returning({ id: users.id });
  const [network] = await db
    .insert(networks)
    .values({ title: `Net ${randomUUID().slice(0, 6)}`, isExperiment: true, isPersonal: false })
    .returning({ id: networks.id });
  await db
    .insert(networkMembers)
    .values({ networkId: network.id, userId: owner.id, permissions: ['owner'], autoAssign: true });
  cleanup.push(async () => {
    await db.delete(apikeys).where(eq(apikeys.userId, owner.id));
    await db.delete(agentPermissions).where(eq(agentPermissions.userId, owner.id));
    await db.delete(agents).where(eq(agents.ownerId, owner.id));
    await db.delete(networkMembers).where(eq(networkMembers.networkId, network.id));
    await db.delete(networks).where(eq(networks.id, network.id));
    await db.delete(users).where(eq(users.id, owner.id));
  });
  return { ownerId: owner.id, networkId: network.id };
}

describe('networkInvitationService.resendInvite', () => {
  it('rotates the api key when a scoped agent already exists', async () => {
    const { ownerId, networkId } = await setupNetworkAndOwner();
    // First invite via the normal path provisions an agent + key.
    const initial = await networkInvitationService.invite({
      networkId,
      email: `member-${randomUUID()}@example.com`,
    });
    expect(initial.agentProvisioned).toBe(true);
    const memberId = initial.user.id;
    const [originalKey] = await db
      .select({ id: apikeys.id, start: apikeys.start })
      .from(apikeys)
      .where(eq(apikeys.userId, memberId));
    expect(originalKey).toBeDefined();

    const result = await networkInvitationService.resendInvite({
      networkId,
      memberId,
    });

    expect(result.rotated).toBe(true);
    expect(result.email).toBeTruthy();
    const after = await db
      .select({ id: apikeys.id, start: apikeys.start })
      .from(apikeys)
      .where(eq(apikeys.userId, memberId));
    expect(after.length).toBe(1);
    expect(after[0].id).not.toBe(originalKey.id);
    expect(after[0].start).not.toBe(originalKey.start);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/network-invitation-resend.test.ts
```
Expected: TypeScript/runtime error — `resendInvite` does not exist on the service.

- [ ] **Step 3: Add the method (rotation-only first)**

Edit `backend/src/services/network-invitation.service.ts`. Add a new public method `resendInvite` to the `NetworkInvitationService` class. Also extend the email dispatcher to thread `isResend`. Concretely:

1. Update `dispatchInvitationEmail` so its `params` accepts `isResend?: boolean`, and forward to the template. The body that comes after the `networkInvitationTemplate` call is unchanged from the existing implementation — keep the existing `try/catch` around `executeSendEmail` exactly as it is. Final method:

```ts
private async dispatchInvitationEmail(params: {
  to: string;
  networkName: string;
  apiKey: string;
  connectCommand: string;
  isResend?: boolean;
}): Promise<void> {
  const rendered = networkInvitationTemplate({
    networkName: params.networkName,
    apiKey: params.apiKey,
    connectCommand: params.connectCommand,
    isResend: params.isResend,
  });

  try {
    const result = (await executeSendEmail({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })) as { skipped?: boolean; reason?: string };
    if (result.skipped) {
      logger.info('[NetworkInvitation] Email send skipped', {
        to: params.to,
        reason: result.reason,
      });
    }
  } catch (err) {
    logger.error('[NetworkInvitation] Failed to send invitation email', { to: params.to, error: err });
    // Fail-soft: provisioning succeeded; organizer can re-issue the invitation.
  }
}
```

2. Add a private helper `findScopedAgentId(userId, networkId)` mirroring the predicate already used in `hasScopedAgent`:

```ts
private async findScopedAgentId(userId: string, networkId: string): Promise<string | null> {
  const [row] = await db
    .select({ agentId: schema.agentPermissions.agentId })
    .from(schema.agentPermissions)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.agentPermissions.agentId))
    .where(and(
      eq(schema.agentPermissions.userId, userId),
      eq(schema.agentPermissions.scope, 'network'),
      eq(schema.agentPermissions.scopeId, networkId),
      isNull(schema.agents.deletedAt),
    ))
    .limit(1);
  return row?.agentId ?? null;
}
```

3. Add the public `resendInvite` method. Define the param/result interfaces near the top (after `InviteResult`):

```ts
export interface ResendInviteParams {
  networkId: string;
  memberId: string;
}

export interface ResendInviteResult {
  rotated: boolean;
  email: string;
}
```

4. Implement the method (first cut handles rotation only — the provisioning and not-a-member branches come in 3b/3c):

```ts
/**
 * Resend the invitation email for an existing member of a network. Rotates
 * the member's network-scoped api key — the previous key is hard-deleted
 * and a fresh one is minted, then emailed.
 *
 * @param params - networkId and memberId
 * @returns rotated flag (true when an existing key was deleted) + the
 *          recipient email.
 * @throws Error('Member not found') when the user is not a member of this
 *         network or the user record is missing/soft-deleted.
 */
async resendInvite(params: ResendInviteParams): Promise<ResendInviteResult> {
  const { networkId, memberId } = params;

  // Look up the member and their email.
  const [member] = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(and(eq(schema.users.id, memberId), isNull(schema.users.deletedAt)))
    .limit(1);
  if (!member) throw new Error('Member not found');

  // Confirm membership.
  const [membership] = await db
    .select({ userId: schema.networkMembers.userId })
    .from(schema.networkMembers)
    .where(and(
      eq(schema.networkMembers.networkId, networkId),
      eq(schema.networkMembers.userId, memberId),
    ))
    .limit(1);
  if (!membership) throw new Error('Member not found');

  const agentId = await this.findScopedAgentId(memberId, networkId);
  let apiKey: string;
  let rotated: boolean;
  if (agentId) {
    await agentTokenAdapter.revokeAllForAgent(agentId);
    const token = await agentTokenAdapter.create(memberId, {
      name: 'Personal Agent API Key',
      agentId,
    });
    apiKey = token.key;
    rotated = true;
  } else {
    apiKey = await this.provisionScopedAgent(memberId, networkId);
    rotated = false;
  }

  const networkName = await this.lookupNetworkName(networkId);
  const connectCommand = buildConnectCommand(apiKey);

  await this.dispatchInvitationEmail({
    to: member.email,
    networkName,
    apiKey,
    connectCommand,
    isResend: true,
  });

  logger.info('[NetworkInvitation] Resent invite', {
    userId: memberId,
    networkId,
    rotated,
  });

  return { rotated, email: member.email };
}
```

Add the import for `agentTokenAdapter` if it isn't already at the top of the file (it is — verify before adding).

- [ ] **Step 4: Run the rotation test to verify it passes**

```bash
bun test tests/network-invitation-resend.test.ts
```
Expected: rotation test passes.

### 3b. Provisioning branch (no scoped agent)

- [ ] **Step 5: Write the failing test (provisioning branch)**

Append to the same test file inside the same `describe` block:

```ts
it('provisions a fresh agent and key when the member has none', async () => {
  const { networkId } = await setupNetworkAndOwner();
  const memberEmail = `bare-${randomUUID()}@example.com`;
  // Insert a user + membership directly so no scoped agent exists.
  const [member] = await db
    .insert(users)
    .values({ email: memberEmail, name: 'Bare', emailVerified: true, isGhost: false })
    .returning({ id: users.id });
  await db
    .insert(networkMembers)
    .values({ networkId, userId: member.id, permissions: ['member'], autoAssign: true });
  cleanup.push(async () => {
    await db.delete(apikeys).where(eq(apikeys.userId, member.id));
    await db.delete(agentPermissions).where(eq(agentPermissions.userId, member.id));
    await db.delete(agents).where(eq(agents.ownerId, member.id));
    await db.delete(networkMembers).where(and(
      eq(networkMembers.networkId, networkId),
      eq(networkMembers.userId, member.id),
    ));
    await db.delete(users).where(eq(users.id, member.id));
  });

  const result = await networkInvitationService.resendInvite({
    networkId,
    memberId: member.id,
  });

  expect(result.rotated).toBe(false);
  expect(result.email).toBe(memberEmail);
  const keys = await db
    .select({ id: apikeys.id })
    .from(apikeys)
    .where(eq(apikeys.userId, member.id));
  expect(keys.length).toBe(1);
});
```

- [ ] **Step 6: Run test (should pass — code already handles this branch)**

```bash
bun test tests/network-invitation-resend.test.ts
```
Expected: both tests pass. The provisioning branch was implemented in 3a already; this test just locks in the contract.

If it fails, the `provisionScopedAgent` call returned without minting a token — investigate before proceeding.

### 3c. Member-not-found branch

- [ ] **Step 7: Write the failing test**

Append:

```ts
it('throws when memberId is not a member of the network', async () => {
  const { networkId } = await setupNetworkAndOwner();
  const fakeId = randomUUID();
  await expect(
    networkInvitationService.resendInvite({ networkId, memberId: fakeId }),
  ).rejects.toThrow('Member not found');
});
```

- [ ] **Step 8: Run test to verify it passes**

```bash
bun test tests/network-invitation-resend.test.ts
```
Expected: 3/3 pass. The check is already in place from 3a.

- [ ] **Step 9: Lint + typecheck**

```bash
bun run lint
bun run build
```
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add backend/src/services/network-invitation.service.ts backend/tests/network-invitation-resend.test.ts
git commit -m "feat(invitation): resend with key rotation"
```

---

## Task 4: Controller — `POST /:id/members/:memberId/resend-invite`

**Files:**
- Modify: `backend/src/controllers/network.controller.ts`
- Test (new): `backend/tests/network-resend-invite.e2e.test.ts`

- [ ] **Step 1: Write the failing E2E test (owner happy path)**

Create `backend/tests/network-resend-invite.e2e.test.ts`. Reuse the `createTestSession` and `api(...)` helpers from `experiment-signup.test.ts` — copy them inline at the top of this new file (do not import across test files). Then:

```ts
import '../src/startup.env';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import db from '../src/lib/drizzle/drizzle';
import { agentPermissions, agents, apikeys, networkMembers, networks, users } from '../src/schemas/database.schema';

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

let authJwt = '';
let ownerUserId = '';
let networkId = '';
let memberUserId = '';

async function api(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
  const { method = 'GET', body, headers = {} } = opts;
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authJwt ? { Authorization: `Bearer ${authJwt}` } : {}),
      ...headers,
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return fetch(`${BASE_URL}${path}`, init);
}

beforeAll(async () => {
  // Sign up an owner via Better Auth (mirrors experiment-signup.test.ts).
  const email = `owner-${randomUUID()}@example.com`;
  const password = `Test${randomUUID().replace(/-/g, '')}!`;
  const signup = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    body: JSON.stringify({ email, password, name: 'Owner' }),
  });
  if (!signup.ok) throw new Error(`signup failed: ${signup.status} ${await signup.text()}`);
  const data = await signup.json() as { user?: { id: string } };
  ownerUserId = data.user?.id ?? '';
  const cookie = signup.headers.getSetCookie().map(c => c.split(';')[0].trim()).join('; ');
  const tokenRes = await fetch(`${BASE_URL}/api/auth/token`, { headers: { Cookie: cookie, Origin: BASE_URL } });
  const tokenJson = await tokenRes.json() as { token?: string };
  authJwt = tokenJson.token ?? '';

  // Create an experiment network owned by the test user.
  const createRes = await api('/networks', { method: 'POST', body: { title: `Net ${randomUUID().slice(0, 6)}`, isExperiment: true } });
  if (!createRes.ok) throw new Error(`create network: ${createRes.status} ${await createRes.text()}`);
  const created = await createRes.json() as { network?: { id: string } };
  networkId = created.network?.id ?? '';

  // Invite a member via the existing endpoint to set up a scoped agent.
  const memberEmail = `member-${randomUUID()}@example.com`;
  const inviteRes = await api(`/networks/${networkId}/members/invite`, { method: 'POST', body: { email: memberEmail } });
  if (!inviteRes.ok) throw new Error(`invite: ${inviteRes.status} ${await inviteRes.text()}`);
  const inviteJson = await inviteRes.json() as { user?: { id: string } };
  memberUserId = inviteJson.user?.id ?? '';
});

afterAll(async () => {
  await db.delete(apikeys).where(eq(apikeys.userId, memberUserId));
  await db.delete(agentPermissions).where(eq(agentPermissions.userId, memberUserId));
  await db.delete(agents).where(eq(agents.ownerId, memberUserId));
  await db.delete(networkMembers).where(eq(networkMembers.networkId, networkId));
  await db.delete(networks).where(eq(networks.id, networkId));
  await db.delete(users).where(eq(users.id, memberUserId));
  await db.delete(users).where(eq(users.id, ownerUserId));
});

describe('POST /networks/:id/members/:memberId/resend-invite', () => {
  it('rotates the key for a member (200, rotated=true)', async () => {
    const before = await db.select({ id: apikeys.id }).from(apikeys).where(eq(apikeys.userId, memberUserId));
    const beforeId = before[0]?.id;
    expect(beforeId).toBeDefined();

    const res = await api(`/networks/${networkId}/members/${memberUserId}/resend-invite`, { method: 'POST' });
    expect(res.status).toBe(200);
    const json = await res.json() as { rotated: boolean; email: string };
    expect(json.rotated).toBe(true);
    expect(json.email).toBeTruthy();

    const after = await db.select({ id: apikeys.id }).from(apikeys).where(eq(apikeys.userId, memberUserId));
    expect(after.length).toBe(1);
    expect(after[0].id).not.toBe(beforeId);
  });

  it('rotates the owner key when memberId is the caller (self-resend)', async () => {
    const res = await api(`/networks/${networkId}/members/${ownerUserId}/resend-invite`, { method: 'POST' });
    expect(res.status).toBe(200);
    const json = await res.json() as { rotated: boolean; email: string };
    expect(typeof json.rotated).toBe('boolean');
    expect(json.email).toBeTruthy();
  });

  it('returns 404 when memberId is not a member of the network', async () => {
    const fakeId = randomUUID();
    const res = await api(`/networks/${networkId}/members/${fakeId}/resend-invite`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('returns 403 when caller is not the network owner', async () => {
    // Sign up a second user, then try to hit the endpoint on the first network.
    const email = `intruder-${randomUUID()}@example.com`;
    const password = `Test${randomUUID().replace(/-/g, '')}!`;
    const signup = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
      body: JSON.stringify({ email, password, name: 'Intruder' }),
    });
    const cookie = signup.headers.getSetCookie().map(c => c.split(';')[0].trim()).join('; ');
    const tokenRes = await fetch(`${BASE_URL}/api/auth/token`, { headers: { Cookie: cookie, Origin: BASE_URL } });
    const tokenJson = await tokenRes.json() as { token?: string };
    const intruderJwt = tokenJson.token ?? '';
    const data = await signup.json() as { user?: { id: string } };
    const intruderId = data.user?.id ?? '';

    const res = await fetch(`${BASE_URL}/networks/${networkId}/members/${memberUserId}/resend-invite`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${intruderJwt}`, 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(403);

    // Cleanup the intruder user.
    await db.delete(users).where(eq(users.id, intruderId));
  });
});
```

Note: this test requires the dev server to be running on port 3001. If your local protocol server is not running, start it in a separate terminal with `cd backend && bun run dev` before running this test.

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/network-resend-invite.e2e.test.ts
```
Expected: 404 on the new route across all four cases (route doesn't exist yet).

- [ ] **Step 3: Add the controller endpoint**

Edit `backend/src/controllers/network.controller.ts`. Add a new method directly below `inviteMember`. Reuse `assertExperimentOwner` (already a private method on this controller) and `assertAgentNetworkScope` (already imported and used by `importMembers`).

```ts
/**
 * Rotate a member's network-scoped api key and email it to them. Owner-only,
 * experiment networks only. Self-target is allowed.
 */
@Post('/:id/members/:memberId/resend-invite')
@UseGuards(AuthOrApiKeyGuard)
async resendInviteToMember(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
  try {
    await assertAgentNetworkScope(req, params.id);
    await this.assertExperimentOwner(params.id, user.id);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  try {
    const result = await networkInvitationService.resendInvite({
      networkId: params.id,
      memberId: params.memberId,
    });
    return Response.json(result, { status: 200 });
  } catch (err: unknown) {
    const msg = errorMessage(err);
    if (msg === 'Member not found') {
      return Response.json({ error: 'Member not found' }, { status: 404 });
    }
    logger.error('Resend invite failed', { networkId: params.id, memberId: params.memberId, error: msg });
    return Response.json({ error: 'Resend failed' }, { status: 500 });
  }
}
```

If `errorMessage` is not in scope, follow the import already used by `inviteMember` in the same file.

- [ ] **Step 4: Run E2E test to verify all four cases pass**

Make sure the dev server is running in another terminal: `cd backend && bun run dev`.

```bash
bun test tests/network-resend-invite.e2e.test.ts
```
Expected: 4/4 pass.

- [ ] **Step 5: Lint + typecheck**

```bash
bun run lint
bun run build
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/network.controller.ts backend/tests/network-resend-invite.e2e.test.ts
git commit -m "feat(network-controller): add resend-invite endpoint with key rotation"
```

---

## Task 5: Frontend service — `resendInvite`

**Files:**
- Modify: `frontend/src/services/networks.ts`

- [ ] **Step 1: Add the live method**

Open `frontend/src/services/networks.ts` and locate the live service object. Right after `inviteMember` (around line 347), add:

```ts
resendInvite: async (
  networkId: string,
  memberId: string,
): Promise<{ rotated: boolean; email: string }> => {
  return api.post(`/networks/${networkId}/members/${memberId}/resend-invite`, {});
},
```

- [ ] **Step 2: Add the noop fallback stub**

In the noop fallback block at the bottom of the file (around line 379), mirror the existing `removeMember` stub with a matching `resendInvite`:

```ts
resendInvite: () => { throw new Error('Use useNetworkService() hook instead of indexesService directly'); },
```

- [ ] **Step 3: Typecheck the frontend**

```bash
cd frontend
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/networks.ts
git commit -m "feat(frontend): add resendInvite to networks service"
```

---

## Task 6: Frontend UI — resend button + dialog

**Files:**
- Modify: `frontend/src/components/NetworkSettingsPanel.tsx`

This task is verified by running the dev server and clicking through the flow in a browser, since the project does not currently have component-level tests for this panel.

- [ ] **Step 1: Add the icon import**

In the existing lucide-react import (currently at line 4 of the file), append `RotateCw`:

```ts
import { Copy, Globe, Lock, Trash2, Plus, Check, ChevronRight, ChevronDown, ChevronLeft, Camera, Upload, Download, X, RotateCw } from 'lucide-react';
```

- [ ] **Step 2: Add component state**

Locate the `useState` block that holds `showDeleteConfirmation` (currently lines 58–59) and add two new state hooks beside it:

```ts
const [resendTarget, setResendTarget] = useState<Member | null>(null);
const [isResendInFlight, setIsResendInFlight] = useState(false);
```

`Member` is the existing local type used for the members array — confirm by searching the file for `Member` type imports/aliases. Use whichever type name the file already uses.

- [ ] **Step 3: Add the resend handler**

Below the existing `handleRemoveMember` function (around line 306), add:

```ts
const handleConfirmResend = async () => {
  if (!resendTarget) return;
  setIsResendInFlight(true);
  try {
    const result = await indexesService.resendInvite(index.id, resendTarget.id);
    success(`Invitation resent to ${result.email}${result.rotated ? ' (key rotated)' : ''}`);
    setResendTarget(null);
  } catch (err) {
    console.error('Resend invite failed', err);
    error('Failed to resend invitation');
  } finally {
    setIsResendInFlight(false);
  }
};
```

(`success` and `error` are toast helpers already imported by this file. Verify by searching for `success(` in the file; if the imported names differ, use the existing names.)

- [ ] **Step 4: Add the resend button to each member row**

Locate the member row block at lines 787–801. Currently the row renders an "Owner" badge for owners and a Member/Contact badge + trash icon (in a hover-revealed `<button>`) for non-owners. Modify so that:

- An icon `<button>` containing `<RotateCw className="h-3.5 w-3.5" />` is rendered for *every* member row when `currentIndex.isExperiment` is true. It uses the same hover-reveal pattern as the trash button (`className="hidden group-hover:block p-1 text-gray-300 hover:text-blue-500 transition-colors flex-shrink-0"`).
- The resend button calls `setResendTarget(member)` on click.
- The button is placed immediately *before* (i.e. to the left of) the trash button, and is rendered for owners as well (the existing trash button stays scoped to non-owners).

Resulting block:

```tsx
{member.permissions.includes('owner') && (
  <span className="text-xs px-1.5 py-0.5 rounded-sm font-medium bg-gray-900 text-white flex-shrink-0">
    Owner
  </span>
)}
{!member.permissions.includes('owner') && (
  <span className="group-hover:hidden text-xs px-1.5 py-0.5 rounded-sm font-medium flex-shrink-0 bg-gray-200 text-gray-700">
    {member.permissions.includes('member') ? 'Member' : 'Contact'}
  </span>
)}
{currentIndex.isExperiment && (
  <button
    onClick={() => setResendTarget(member)}
    title="Resend invitation"
    className="hidden group-hover:block p-1 text-gray-300 hover:text-blue-500 transition-colors flex-shrink-0"
  >
    <RotateCw className="h-3.5 w-3.5" />
  </button>
)}
{!member.permissions.includes('owner') && (
  <button onClick={() => handleRemoveMember(member.id)} className="hidden group-hover:block p-1 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0">
    <Trash2 className="h-3.5 w-3.5" />
  </button>
)}
```

- [ ] **Step 5: Resolve current user id**

The current user id is exposed via `useAuthContext` from `@/contexts/AuthContext` (used elsewhere in the codebase, e.g. `frontend/src/contexts/ConversationContext.tsx`). Add the import near the top of the file:

```ts
import { useAuthContext } from '@/contexts/AuthContext';
```

And inside the component (near the existing hook calls around line 42), destructure:

```ts
const { user: currentUser } = useAuthContext();
```

- [ ] **Step 6: Add the AlertDialog**

Below the existing delete-network `AlertDialog.Root` (line 920 closes it), add the resend dialog as a sibling (still inside the component's return):

```tsx
<AlertDialog.Root open={resendTarget !== null} onOpenChange={(open) => { if (!open) setResendTarget(null); }}>
  <AlertDialog.Portal>
    <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
    <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
      <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-4">
        Resend invitation to {resendTarget?.id === currentUser?.id ? 'yourself' : (resendTarget?.name || 'this member')}?
      </AlertDialog.Title>
      <AlertDialog.Description className="text-sm text-gray-600 mb-4">
        This rotates {resendTarget?.id === currentUser?.id ? 'your' : 'their'} access key. The previous key will stop working immediately.
      </AlertDialog.Description>
      <div className="flex justify-end gap-2">
        <AlertDialog.Cancel asChild>
          <Button variant="outline" disabled={isResendInFlight}>Cancel</Button>
        </AlertDialog.Cancel>
        <Button onClick={handleConfirmResend} disabled={isResendInFlight}>
          {isResendInFlight ? 'Sending...' : 'Resend'}
        </Button>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
```

If at the time of writing the `Member` type does not include the optional `name`, fall back to `resendTarget?.id` for the title text (verify against the type defined at the top of the file).

- [ ] **Step 7: Manual UI verification**

```bash
cd frontend && bun run dev
```

In a browser:
1. Sign in as the owner of an experiment network.
2. Open the network's settings panel and hover a member row → confirm the resend icon appears beside the trash icon.
3. Click resend → confirm the dialog opens with the member's name in the title.
4. Click `Resend` → confirm the dialog closes, a toast appears, and (in another tab) the dev server logs an outbound email send (or a "skipped" log if `RESEND_API_KEY` is not configured locally).
5. Hover an owner row → confirm the resend icon appears (no trash icon for owners).
6. Click resend on the owner row → confirm the dialog says "Resend invitation to yourself?" and "This rotates your access key…".

If any step fails, do not commit — debug and fix.

- [ ] **Step 8: Frontend typecheck**

```bash
cd frontend
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/NetworkSettingsPanel.tsx
git commit -m "feat(network-settings): add resend invitation button with confirm dialog"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run all touched backend tests together**

```bash
cd backend
bun test src/lib/email/tests/network-invitation.template.test.ts tests/agent-token-adapter.test.ts tests/network-invitation-resend.test.ts tests/network-resend-invite.e2e.test.ts
```
Expected: all green.

- [ ] **Step 2: Backend lint + build**

```bash
cd backend
bun run lint
bun run build
```
Expected: clean.

- [ ] **Step 3: Frontend typecheck + lint**

```bash
cd frontend
npx tsc --noEmit
bun run lint
```
Expected: clean.

- [ ] **Step 4: Final manual smoke**

Already done in Task 6 step 7. Confirm the diff against `dev` covers exactly the files listed at the top of this plan (plus the new tests). No incidental edits.

- [ ] **Step 5: Update API reference**

Edit `docs/specs/api-reference.md` and add an entry for the new endpoint, modeled on the existing `### POST /api/networks/:id/members/invite` block (around line 1831). The new section title is `### POST /api/networks/:id/members/:memberId/resend-invite`. Document:

- Owner-only, experiment networks only.
- Path params: `id` (network), `memberId` (target user id).
- Body: empty.
- Response 200 `{ rotated: boolean, email: string }`. Briefly explain `rotated`.
- 403 (non-owner / non-experiment), 404 (member not found), 500 (internal).

Commit:

```bash
git add docs/specs/api-reference.md
git commit -m "docs(api): document POST resend-invite endpoint"
```

- [ ] **Step 6: Push the branch and prepare PR**

```bash
git push -u origin feat/resend-network-invitation
```

Open the PR via `gh pr create` (target `dev`) with body:
- New Features: per-member resend invitation button on experimental network settings, with API key rotation
- Tests: template + adapter + service + controller E2E
- Linear: IND-261

Do not merge yet — request a Copilot review (`gh pr edit <PR-NUMBER> --add-reviewer @copilot`) and follow the review-handling workflow in CLAUDE.md.

---

## Notes for the engineer

- The test files import directly from `../src/...`. Do not add a barrel index.
- The service tests assume a working DATABASE_URL pointing at a dev Postgres. This is the same assumption every other backend integration test makes; see `backend/tests/experiment-signup.test.ts` for the canonical setup pattern.
- The E2E test requires the dev server running on port 3001. If you want to skip it locally, mark the test with `it.skipIf(!process.env.E2E_BACKEND_RUNNING)` — but make sure CI runs it.
- After merge, delete this plan and its companion spec per the "Finishing a Branch" section in CLAUDE.md.
