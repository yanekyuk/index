# EdgeClaw network-integration row + master-key rotation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-14-edgeclaw-network-integration-design.md`
**Linear:** [IND-302](https://linear.app/indexnetwork/issue/IND-302/edgeclaw-row-on-network-integrations-tab-with-master-key-rotation)

**Goal:** Surface EdgeClaw as a row in the network integrations tab on experiment networks and add a `POST /networks/:id/rotate-master-key` endpoint that lets owners recover a lost master key.

**Architecture:** Backend extracts the existing inline master-key generator into a shared helper, then adds a service method + controller route guarded by `assertExperimentOwner`. Rotation emails every owner via the existing Resend transport. Frontend adds an EdgeClaw row to `NetworkSettingsPanel`'s integrations tab (only when `currentIndex.isExperiment`), with a typed-confirm `AlertDialog` mirroring the existing delete-network dialog and the existing one-time `MasterKeyDialog` for the plaintext reveal.

**Tech Stack:** Bun, Express-style decorator routing (`@Post`), Drizzle ORM, Resend (existing transport), React 19, Radix UI `AlertDialog`/`Dialog`, Tailwind 4, `bun:test`.

---

## File structure

**Backend — new:**
- `backend/src/lib/experiment/master-key.ts` — shared `generateMasterKey()` + `hashMasterKey()` (the helper that owns the alphabet, length, and SHA-256 base64url hashing).
- `backend/src/lib/email/templates/network-master-key-rotated.template.ts` — subject + HTML + plain-text body for the rotation email.
- `backend/src/services/tests/network.service.master-key-rotation.spec.ts` — focused service-level integration spec for `rotateExperimentMasterKey`. Kept separate from the existing `network.service.spec.ts` to avoid touching unrelated fixtures.

**Backend — modified:**
- `backend/src/services/network.service.ts` — replace the inline key-gen in `createExperimentNetwork`; add `rotateExperimentMasterKey(networkId, userId)`; add a private `dispatchRotationEmail` helper alongside the existing email-dispatch patterns used by `network-invitation.service`.
- `backend/src/guards/experiment.guard.ts` — replace the local `hashKey()` with a re-export from the shared helper so the constant-time comparison still works.
- `backend/src/controllers/network.controller.ts` — add `@Post('/:id/rotate-master-key')` handler reusing the existing `assertExperimentOwner` helper.
- `backend/src/controllers/tests/network.controller.spec.ts` — add a `describe('POST /:id/rotate-master-key')` block alongside the existing experiment-network specs.
- `backend/package.json` — bump version from `0.21.7` → `0.22.0`.

**Frontend — new:**
- (none required; the icon `frontend/public/integrations/edgeclaw.png` is a future asset — the existing `<img onError>` handler hides missing icons gracefully.)

**Frontend — modified:**
- `frontend/src/services/networks.ts` — add `rotateMasterKey(networkId)` to `createIndexesService`.
- `frontend/src/components/NetworkSettingsPanel.tsx` — add EdgeClaw block at the bottom of the `integrations` tab branch, plus the rotation `AlertDialog` and `MasterKeyDialog` wiring.
- `frontend/package.json` — bump version from `0.7.4` → `0.8.0`.

**Docs — modified:**
- `docs/specs/api-reference.md` — add the new endpoint section.
- `packages/edgeclaw/README.md` — append the rotation paragraph under "Integration API".

---

## Task 1: Extract shared master-key helper

Pure refactor — must not change observable behavior. Verified by re-running existing controller and invitation-service specs.

**Files:**
- Create: `backend/src/lib/experiment/master-key.ts`
- Modify: `backend/src/services/network.service.ts` (lines ~56–98, the `createExperimentNetwork` method)
- Modify: `backend/src/guards/experiment.guard.ts` (lines 6–10, the local `hashKey`)

- [ ] **Step 1: Create the shared helper.**

Create `backend/src/lib/experiment/master-key.ts` with this exact content:

```ts
/**
 * Shared helpers for the experiment-network master key. Owns the alphabet,
 * length, and hashing scheme so that key generation and key verification
 * cannot drift out of sync.
 *
 * The plaintext key is shown to the operator exactly once (at creation or
 * after rotation). The database stores only the SHA-256/base64url hash.
 */

const KEY_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const KEY_LENGTH = 64;

export async function hashMasterKey(plaintext: string): Promise<string> {
  const encoded = new TextEncoder().encode(plaintext);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Buffer.from(digest).toString('base64url');
}

export async function generateMasterKey(): Promise<{ key: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_LENGTH));
  let key = '';
  for (let i = 0; i < KEY_LENGTH; i++) {
    key += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  }
  const hash = await hashMasterKey(key);
  return { key, hash };
}
```

- [ ] **Step 2: Refactor `experiment.guard.ts` to use the shared hash.**

Replace the local `hashKey` function (lines 6–10) by importing the shared helper. Edit `backend/src/guards/experiment.guard.ts`:

Replace:
```ts
async function hashKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return Buffer.from(hash).toString('base64url');
}
```

with:
```ts
import { hashMasterKey } from '../lib/experiment/master-key';
```
(at the top of the imports block) and update the single call site (line ~58) from:
```ts
const hashedKey = await hashKey(apiKey);
```
to:
```ts
const hashedKey = await hashMasterKey(apiKey);
```

- [ ] **Step 3: Refactor `createExperimentNetwork` to use the shared generator.**

Edit `backend/src/services/network.service.ts`. At the top of the file, add this import next to the other library imports:

```ts
import { generateMasterKey } from '../lib/experiment/master-key';
```

Replace lines ~58–70 of `createExperimentNetwork`:
```ts
const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const bytes = crypto.getRandomValues(new Uint8Array(64));
let masterKey = '';
for (let i = 0; i < 64; i++) {
  masterKey += chars[bytes[i] % chars.length];
}

// Hash the key
const encoded = new TextEncoder().encode(masterKey);
const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
const masterKeyHash = Buffer.from(hashBuffer).toString('base64url');
```

with:
```ts
const { key: masterKey, hash: masterKeyHash } = await generateMasterKey();
```

Leave the surrounding code (the `db.update(schema.networks).set({...})` block and the `addMemberToNetwork` call) untouched. The variable names `masterKey` and `masterKeyHash` are preserved so downstream code does not change.

- [ ] **Step 4: Run the existing tests that exercise this code path.**

Run: `cd backend && bun test src/controllers/tests/network.controller.spec.ts src/services/tests/network-invitation.service.spec.ts`
Expected: all tests pass. These tests already create experiment networks and use the master key indirectly; if the refactor is faithful, they pass unchanged.

- [ ] **Step 5: Run tsc.**

Run: `cd backend && bun run tsc --noEmit`
Expected: no errors. (Per `feedback_tsc_before_completion`.)

- [ ] **Step 6: Commit.**

```bash
git add backend/src/lib/experiment/master-key.ts backend/src/services/network.service.ts backend/src/guards/experiment.guard.ts
git commit -m "refactor(backend): extract master-key generator + hasher into lib/experiment

Pure refactor — moves the alphabet, 64-char length, and SHA-256/base64url
hashing into backend/src/lib/experiment/master-key.ts. Used by
createExperimentNetwork today; the upcoming rotation endpoint will share it."
```

---

## Task 2: Email template for rotation

Test-first. The template is a pure function — easy to assert on.

**Files:**
- Create: `backend/src/lib/email/templates/network-master-key-rotated.template.ts`
- Create: `backend/src/lib/email/templates/tests/network-master-key-rotated.template.spec.ts`

- [ ] **Step 1: Write the failing template spec.**

Create `backend/src/lib/email/templates/tests/network-master-key-rotated.template.spec.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { networkMasterKeyRotatedTemplate } from '../network-master-key-rotated.template';

describe('networkMasterKeyRotatedTemplate', () => {
  const baseParams = {
    networkName: 'Edge Esmeralda 2026',
    actorDisplay: 'Yanki Yuksel',
    newKey: 'ix-master-key-plaintext-example',
    integrationsUrl: 'https://index.network/networks/abc-123/integrations',
  };

  test('subject includes the network name', () => {
    const out = networkMasterKeyRotatedTemplate(baseParams);
    expect(out.subject).toBe('Master key rotated for Edge Esmeralda 2026');
  });

  test('html body contains the new key and the actor', () => {
    const out = networkMasterKeyRotatedTemplate(baseParams);
    expect(out.html).toContain('ix-master-key-plaintext-example');
    expect(out.html).toContain('Yanki Yuksel');
    expect(out.html).toContain('Edge Esmeralda 2026');
    expect(out.html).toContain('https://index.network/networks/abc-123/integrations');
  });

  test('text body contains the new key and the actor', () => {
    const out = networkMasterKeyRotatedTemplate(baseParams);
    expect(out.text).toContain('ix-master-key-plaintext-example');
    expect(out.text).toContain('Yanki Yuksel');
    expect(out.text).toContain('Edge Esmeralda 2026');
  });

  test('escapes html in network name', () => {
    const out = networkMasterKeyRotatedTemplate({
      ...baseParams,
      networkName: '<script>alert(1)</script>',
    });
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  test('strips control chars from the subject network name', () => {
    const out = networkMasterKeyRotatedTemplate({
      ...baseParams,
      networkName: 'Evil\r\nBcc: attacker@example.com',
    });
    expect(out.subject).not.toContain('\r');
    expect(out.subject).not.toContain('\n');
  });
});
```

- [ ] **Step 2: Run the test to see it fail.**

Run: `cd backend && bun test src/lib/email/templates/tests/network-master-key-rotated.template.spec.ts`
Expected: FAIL — module `../network-master-key-rotated.template` not found.

- [ ] **Step 3: Implement the template.**

Create `backend/src/lib/email/templates/network-master-key-rotated.template.ts`:

```ts
import { escapeHtml } from '../../escapeHtml';

export interface NetworkMasterKeyRotatedParams {
  networkName: string;
  actorDisplay: string;
  newKey: string;
  integrationsUrl: string;
}

export interface NetworkMasterKeyRotatedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * One-time delivery of a rotated master key to every owner of an experiment
 * network. The plaintext key is shown inline; the recipient must store it in
 * a secret manager — Index Network does not retain a recoverable copy.
 */
export const networkMasterKeyRotatedTemplate = (
  p: NetworkMasterKeyRotatedParams,
): NetworkMasterKeyRotatedEmail => {
  const safeNetwork = escapeHtml(p.networkName);
  const safeActor = escapeHtml(p.actorDisplay);
  const safeKey = escapeHtml(p.newKey);
  const safeUrl = escapeHtml(p.integrationsUrl);
  // Strip CR/LF and other control chars from the network name before splicing
  // it into the Subject header — defends against header injection.
  const subjectName = p.networkName.replace(/[\r\n\t\f\v\0]+/g, ' ').trim().slice(0, 200);

  return {
    subject: `Master key rotated for ${subjectName}`,
    html: `<div style="font-family: Arial, sans-serif;">
  <p>The master key for <strong>${safeNetwork}</strong> has just been rotated by <strong>${safeActor}</strong>.</p>
  <p>The previous key is no longer valid. Any backend (InstaClaw, EdgeOS) still using the old key will return 403 until it is reconfigured.</p>
  <p>Your new master key (shown only once):</p>
  <pre style="font-family: monospace; background: #f6f6f6; padding: 12px; border-radius: 6px;">${safeKey}</pre>
  <p>Treat this like a password — store it in your backend's secret manager. You can view the integration on the <a href="${safeUrl}">${safeNetwork} integrations tab</a>.</p>
  <div style="margin-top: 20px; text-align: center;">
    <img src="https://index.network/logo.png" alt="Index" style="height: 24px; opacity: 0.5;" />
  </div>
</div>`,
    text: `The master key for ${p.networkName} has just been rotated by ${p.actorDisplay}.

The previous key is no longer valid. Any backend (InstaClaw, EdgeOS) still using the old key will return 403 until it is reconfigured.

Your new master key (shown only once):

${p.newKey}

Treat this like a password — store it in your backend's secret manager. Integrations tab: ${p.integrationsUrl}`,
  };
};
```

- [ ] **Step 4: Run the template spec.**

Run: `cd backend && bun test src/lib/email/templates/tests/network-master-key-rotated.template.spec.ts`
Expected: PASS — all five tests green.

- [ ] **Step 5: Commit.**

```bash
git add backend/src/lib/email/templates/network-master-key-rotated.template.ts backend/src/lib/email/templates/tests/network-master-key-rotated.template.spec.ts
git commit -m "feat(backend): add network-master-key-rotated email template

Pure function — subject, HTML, and plain-text bodies. HTML-escapes the
network name + actor display + key; strips control chars from the
subject header to defend against injection."
```

---

## Task 3: Service method `rotateExperimentMasterKey`

TDD with database fixtures (matches the existing `network-invitation.service.spec.ts` pattern).

**Files:**
- Create: `backend/src/services/tests/network.service.master-key-rotation.spec.ts`
- Modify: `backend/src/services/network.service.ts` (add method, add private email-dispatch helper)

- [ ] **Step 1: Write the failing service spec.**

Create `backend/src/services/tests/network.service.master-key-rotation.spec.ts`:

```ts
import { config } from 'dotenv';
config({ path: '.env.test' });

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

const sendSpy = mock(async (_args: { to: string; subject: string; html: string; text: string }) => ({ data: null, skipped: false }));
mock.module('../../lib/email/transport.helper', () => ({
  executeSendEmail: sendSpy,
}));

import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { hashMasterKey } from '../../lib/experiment/master-key';
import { networkService } from '../network.service';

describe('networkService.rotateExperimentMasterKey', () => {
  let networkId: string;
  let nonExperimentNetworkId: string;
  let ownerId: string;
  let coOwnerId: string;
  let nonOwnerId: string;
  const cleanupNetworkIds: string[] = [];
  const cleanupUserIds: string[] = [];

  beforeAll(async () => {
    const stamp = Date.now();
    const [owner] = await db.insert(schema.users)
      .values({ email: `rotate-owner-${stamp}@test.dev`, name: 'Rotate Owner', emailVerified: true })
      .returning({ id: schema.users.id });
    const [coOwner] = await db.insert(schema.users)
      .values({ email: `rotate-coowner-${stamp}@test.dev`, name: 'Co Owner', emailVerified: true })
      .returning({ id: schema.users.id });
    const [nonOwner] = await db.insert(schema.users)
      .values({ email: `rotate-nonowner-${stamp}@test.dev`, name: 'Non Owner', emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = owner.id;
    coOwnerId = coOwner.id;
    nonOwnerId = nonOwner.id;
    cleanupUserIds.push(ownerId, coOwnerId, nonOwnerId);

    const initialHash = await hashMasterKey('initial-plaintext-for-test');
    const [n] = await db.insert(schema.networks)
      .values({
        title: 'Rotate Test Experiment',
        isPersonal: false,
        isExperiment: true,
        experimentMasterKeyHash: initialHash,
        permissions: { joinPolicy: 'invite_only', invitationLink: null, allowGuestVibeCheck: false },
      })
      .returning({ id: schema.networks.id });
    networkId = n.id;
    cleanupNetworkIds.push(networkId);

    await db.insert(schema.networkMembers).values([
      { networkId, userId: ownerId, permissions: ['owner'] },
      { networkId, userId: coOwnerId, permissions: ['owner'] },
      { networkId, userId: nonOwnerId, permissions: ['member'] },
    ]);

    const [nx] = await db.insert(schema.networks)
      .values({ title: 'Rotate Test Non-Experiment', isPersonal: false, isExperiment: false })
      .returning({ id: schema.networks.id });
    nonExperimentNetworkId = nx.id;
    cleanupNetworkIds.push(nonExperimentNetworkId);
    await db.insert(schema.networkMembers).values({ networkId: nonExperimentNetworkId, userId: ownerId, permissions: ['owner'] });
  });

  afterAll(async () => {
    if (cleanupNetworkIds.length > 0) {
      await db.delete(schema.networkMembers).where(inArray(schema.networkMembers.networkId, cleanupNetworkIds));
      await db.delete(schema.networks).where(inArray(schema.networks.id, cleanupNetworkIds));
    }
    if (cleanupUserIds.length > 0) {
      await db.delete(schema.users).where(inArray(schema.users.id, cleanupUserIds));
    }
  });

  test('rotates the hash and returns a fresh plaintext key', async () => {
    sendSpy.mockClear();

    const [before] = await db
      .select({ hash: schema.networks.experimentMasterKeyHash })
      .from(schema.networks)
      .where(eq(schema.networks.id, networkId));

    const result = await networkService.rotateExperimentMasterKey(networkId, ownerId);

    expect(result.masterKey).toBeTruthy();
    expect(result.masterKey.length).toBe(64);

    const [after] = await db
      .select({ hash: schema.networks.experimentMasterKeyHash })
      .from(schema.networks)
      .where(eq(schema.networks.id, networkId));
    expect(after.hash).not.toBe(before.hash);
    const expectedHash = await hashMasterKey(result.masterKey);
    expect(after.hash).toBe(expectedHash);
  });

  test('emails every owner of the network', async () => {
    sendSpy.mockClear();
    await networkService.rotateExperimentMasterKey(networkId, ownerId);

    // Email dispatch is fire-and-forget; await a microtask flush.
    await new Promise((r) => setTimeout(r, 50));

    expect(sendSpy.mock.calls.length).toBe(2);
    const recipients = sendSpy.mock.calls.map((c) => (c[0] as { to: string }).to).sort();
    expect(recipients).toEqual([
      expect.stringContaining('rotate-coowner'),
      expect.stringContaining('rotate-owner'),
    ]);
  });

  test('throws when the network is not an experiment', async () => {
    await expect(
      networkService.rotateExperimentMasterKey(nonExperimentNetworkId, ownerId),
    ).rejects.toThrow(/not an experiment/i);
  });

  test('throws when the caller is not an owner', async () => {
    await expect(
      networkService.rotateExperimentMasterKey(networkId, nonOwnerId),
    ).rejects.toThrow(/owner/i);
  });
});
```

- [ ] **Step 2: Run the spec to see it fail.**

Run: `cd backend && bun test src/services/tests/network.service.master-key-rotation.spec.ts`
Expected: FAIL — `networkService.rotateExperimentMasterKey is not a function`.

- [ ] **Step 3: Implement the service method.**

Edit `backend/src/services/network.service.ts`.

Add at the top of the imports block (alongside the existing imports):

```ts
import { generateMasterKey } from '../lib/experiment/master-key';
import { executeSendEmail } from '../lib/email/transport.helper';
import { networkMasterKeyRotatedTemplate } from '../lib/email/templates/network-master-key-rotated.template';
```

(If `generateMasterKey` is already imported from Task 1, do not add it twice.)

At the bottom of the `NetworkService` class, **before** the closing brace, add:

```ts
  /**
   * Rotate the master key on an experiment network. The plaintext is returned
   * exactly once and never persisted; the hash replaces the existing
   * `experiment_master_key_hash`. Every owner of the network receives an
   * email with the new key.
   *
   * @throws Error('Not an experiment network') when the target is not an
   *         experiment or has no existing hash.
   * @throws Error('Owner-only operation') when the caller is not an owner.
   */
  async rotateExperimentMasterKey(networkId: string, userId: string): Promise<{ masterKey: string }> {
    logger.verbose('[NetworkService] Rotating experiment master key', { networkId, userId });

    const [network] = await db
      .select({
        id: schema.networks.id,
        title: schema.networks.title,
        isExperiment: schema.networks.isExperiment,
        experimentMasterKeyHash: schema.networks.experimentMasterKeyHash,
        deletedAt: schema.networks.deletedAt,
      })
      .from(schema.networks)
      .where(eq(schema.networks.id, networkId))
      .limit(1);

    if (!network || network.deletedAt || !network.isExperiment || !network.experimentMasterKeyHash) {
      throw new Error('Not an experiment network');
    }

    const isOwner = await this.adapter.isIndexOwner(networkId, userId);
    if (!isOwner) {
      throw new Error('Owner-only operation');
    }

    const { key, hash } = await generateMasterKey();
    await db.update(schema.networks)
      .set({ experimentMasterKeyHash: hash })
      .where(eq(schema.networks.id, networkId));

    // Dispatch owner emails fire-and-forget — rotation has already committed.
    this.dispatchRotationEmails(network.id, network.title, userId, key)
      .catch((err) => logger.error('[NetworkService] Rotation email dispatch failed', { networkId, err }));

    return { masterKey: key };
  }

  /**
   * Look up every owner of the network and email them the new plaintext key.
   * Fire-and-forget; per-recipient errors are swallowed so one bad address
   * cannot block delivery to the others.
   */
  private async dispatchRotationEmails(
    networkId: string,
    networkName: string,
    actorUserId: string,
    newKey: string,
  ): Promise<void> {
    const owners = await db
      .select({
        userId: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
      })
      .from(schema.networkMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.networkMembers.userId))
      .where(and(
        eq(schema.networkMembers.networkId, networkId),
        sql`'owner' = ANY(${schema.networkMembers.permissions})`,
        isNull(schema.users.deletedAt),
      ));

    if (owners.length === 0) return;

    const actor = owners.find((o) => o.userId === actorUserId);
    const actorDisplay = actor?.name || actor?.email || 'an owner';
    const appUrl = process.env.APP_URL || 'https://index.network';
    const integrationsUrl = `${appUrl}/networks/${networkId}/integrations`;

    const rendered = networkMasterKeyRotatedTemplate({
      networkName,
      actorDisplay,
      newKey,
      integrationsUrl,
    });

    await Promise.all(owners.map(async (o) => {
      try {
        await executeSendEmail({
          to: o.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
      } catch (err) {
        logger.error('[NetworkService] Rotation email failed for owner', { to: o.email, err });
      }
    }));
  }
```

At the top of the file, ensure the imports include `and`, `isNull`, `sql` from `drizzle-orm` — extend the existing import line. Concretely change:

```ts
import { eq } from 'drizzle-orm';
```

to:

```ts
import { and, eq, isNull, sql } from 'drizzle-orm';
```

- [ ] **Step 4: Run the service spec to see it pass.**

Run: `cd backend && bun test src/services/tests/network.service.master-key-rotation.spec.ts`
Expected: PASS — all four tests green.

- [ ] **Step 5: Run tsc on the backend.**

Run: `cd backend && bun run tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add backend/src/services/network.service.ts backend/src/services/tests/network.service.master-key-rotation.spec.ts
git commit -m "feat(backend): NetworkService.rotateExperimentMasterKey

Owner-only rotation of an experiment network's master key. Mints a fresh
64-char key, replaces the stored hash, and emails the plaintext to every
owner of the network via the existing Resend transport. Email dispatch
is fire-and-forget — rotation has already committed when the response
returns."
```

---

## Task 4: Controller endpoint `POST /networks/:id/rotate-master-key`

TDD. Reuses the existing `assertExperimentOwner` private helper on the controller for the auth + experiment + owner check.

**Files:**
- Modify: `backend/src/controllers/tests/network.controller.spec.ts` (add a new `describe` block)
- Modify: `backend/src/controllers/network.controller.ts` (add route handler)

- [ ] **Step 1: Write the failing controller test.**

Edit `backend/src/controllers/tests/network.controller.spec.ts`. Add this `describe` block immediately after the existing `POST /:id/members/invite (experiment networks)` block (search for that string to find the right spot):

```ts
  describe("POST /:id/rotate-master-key", () => {
    let rotateNetworkId: string;

    beforeAll(async () => {
      const req = new Request("http://localhost/networks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Rotate Master Key Test", isExperiment: true }),
      });
      const res = await controller.create(req, mockUser());
      const data = (await res.json()) as { network?: { id: string } };
      rotateNetworkId = data.network!.id;
    });

    afterAll(async () => {
      if (rotateNetworkId) await indexAdapter.deleteNetworkAndMembers(rotateNetworkId);
    });

    test("returns 200 with a fresh masterKey for the owner", async () => {
      const req = new Request(`http://localhost/networks/${rotateNetworkId}/rotate-master-key`, {
        method: "POST",
      });
      const res = await controller.rotateMasterKey(req, mockUser(), { id: rotateNetworkId });
      const data = (await res.json()) as { masterKey?: string };

      expect(res.status).toBe(200);
      expect(data.masterKey).toBeTruthy();
      expect(data.masterKey!.length).toBe(64);
    });

    test("returns 403 when network is not an experiment", async () => {
      const req = new Request(`http://localhost/networks/${createdIndexId}/rotate-master-key`, {
        method: "POST",
      });
      const res = await controller.rotateMasterKey(req, mockUser(), { id: createdIndexId });
      expect(res.status).toBe(403);
    });

    test("returns 404 when network does not exist", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const req = new Request(`http://localhost/networks/${fakeId}/rotate-master-key`, {
        method: "POST",
      });
      const res = await controller.rotateMasterKey(req, mockUser(), { id: fakeId });
      // assertExperimentOwner throws 403 for unknown networks → either is acceptable
      expect([403, 404]).toContain(res.status);
    });
  });
```

- [ ] **Step 2: Run the controller spec to see the new tests fail.**

Run: `cd backend && bun test src/controllers/tests/network.controller.spec.ts -t "rotate-master-key"`
Expected: FAIL — `controller.rotateMasterKey is not a function`.

- [ ] **Step 3: Implement the controller handler.**

Edit `backend/src/controllers/network.controller.ts`. Add this method to the `NetworkController` class — place it immediately after the existing `inviteMember` handler and before the `assertExperimentOwner` private helper. Search for `private async assertExperimentOwner` to locate the insertion point.

```ts
  /**
   * Rotate the master key on an experiment network. Owner-only. The plaintext
   * is returned in the response body exactly once; the previous key stops
   * working immediately. Every owner of the network also receives the new
   * key by email.
   */
  @Post('/:id/rotate-master-key')
  @UseGuards(AuthOrApiKeyGuard)
  async rotateMasterKey(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      await this.assertExperimentOwner(params.id, user.id);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    try {
      const result = await networkService.rotateExperimentMasterKey(params.id, user.id);
      logger.verbose('Master key rotated', { networkId: params.id, userId: user.id });
      return Response.json({ masterKey: result.masterKey });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      logger.error('Master key rotation failed', { networkId: params.id, error: msg });
      if (msg.includes('Not an experiment network')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (msg.includes('Owner-only')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }
```

- [ ] **Step 4: Run the controller spec to see the new tests pass.**

Run: `cd backend && bun test src/controllers/tests/network.controller.spec.ts -t "rotate-master-key"`
Expected: PASS — three tests green.

- [ ] **Step 5: Run the full network spec sweep to make sure nothing else broke.**

Run: `cd backend && bun test src/controllers/tests/network.controller.spec.ts src/services/tests/network.service.master-key-rotation.spec.ts src/services/tests/network-invitation.service.spec.ts`
Expected: PASS across all three files.

- [ ] **Step 6: Add a guard-level sanity spec.**

Create `backend/src/guards/tests/experiment.guard.spec.ts`. This proves end-to-end that after rotation the new plaintext validates and the old plaintext is rejected — exercises the full `ExperimentMasterKeyGuard` path that the signup endpoint uses.

```ts
import { config } from 'dotenv';
config({ path: '.env.test' });

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { hashMasterKey } from '../../lib/experiment/master-key';
import { ExperimentMasterKeyGuard } from '../experiment.guard';
import { networkService } from '../../services/network.service';

describe('ExperimentMasterKeyGuard after rotation', () => {
  let networkId: string;
  let ownerId: string;
  const cleanupUserIds: string[] = [];
  const cleanupNetworkIds: string[] = [];
  const originalKey = 'original-plaintext-for-guard-test-with-padding-12345678901234';

  beforeAll(async () => {
    const stamp = Date.now();
    const [owner] = await db.insert(schema.users)
      .values({ email: `guard-rot-${stamp}@test.dev`, name: 'Guard Owner', emailVerified: true })
      .returning({ id: schema.users.id });
    ownerId = owner.id;
    cleanupUserIds.push(ownerId);

    const initialHash = await hashMasterKey(originalKey);
    const [n] = await db.insert(schema.networks)
      .values({
        title: 'Guard Rotation Test',
        isPersonal: false,
        isExperiment: true,
        experimentMasterKeyHash: initialHash,
        permissions: { joinPolicy: 'invite_only', invitationLink: null, allowGuestVibeCheck: false },
      })
      .returning({ id: schema.networks.id });
    networkId = n.id;
    cleanupNetworkIds.push(networkId);
    await db.insert(schema.networkMembers).values({ networkId, userId: ownerId, permissions: ['owner'] });
  });

  afterAll(async () => {
    if (cleanupNetworkIds.length > 0) {
      await db.delete(schema.networkMembers).where(inArray(schema.networkMembers.networkId, cleanupNetworkIds));
      await db.delete(schema.networks).where(inArray(schema.networks.id, cleanupNetworkIds));
    }
    if (cleanupUserIds.length > 0) {
      await db.delete(schema.users).where(inArray(schema.users.id, cleanupUserIds));
    }
  });

  test('original key validates before rotation, new key validates after, old key is rejected after', async () => {
    const before = await ExperimentMasterKeyGuard(
      new Request(`http://localhost/networks/${networkId}/signup`, {
        method: 'POST',
        headers: { 'x-api-key': originalKey },
      }),
      { id: networkId },
    );
    expect(before.id).toBe(networkId);

    const { masterKey: newKey } = await networkService.rotateExperimentMasterKey(networkId, ownerId);

    const after = await ExperimentMasterKeyGuard(
      new Request(`http://localhost/networks/${networkId}/signup`, {
        method: 'POST',
        headers: { 'x-api-key': newKey },
      }),
      { id: networkId },
    );
    expect(after.id).toBe(networkId);

    let rejected: Response | null = null;
    try {
      await ExperimentMasterKeyGuard(
        new Request(`http://localhost/networks/${networkId}/signup`, {
          method: 'POST',
          headers: { 'x-api-key': originalKey },
        }),
        { id: networkId },
      );
    } catch (err) {
      if (err instanceof Response) rejected = err;
    }
    expect(rejected).not.toBeNull();
    expect(rejected!.status).toBe(403);
  });
});
```

- [ ] **Step 7: Run the guard spec.**

Run: `cd backend && bun test src/guards/tests/experiment.guard.spec.ts`
Expected: PASS.

- [ ] **Step 8: Run tsc.**

Run: `cd backend && bun run tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit.**

```bash
git add backend/src/controllers/network.controller.ts backend/src/controllers/tests/network.controller.spec.ts backend/src/guards/tests/experiment.guard.spec.ts
git commit -m "feat(backend): POST /networks/:id/rotate-master-key endpoint

Owner-only rotation route guarded by assertExperimentOwner. Returns
the plaintext key in the response once; the old key stops working
immediately and every owner receives the new key by email."
```

---

## Task 5: Frontend service method `rotateMasterKey`

**Files:**
- Modify: `frontend/src/services/networks.ts`

- [ ] **Step 1: Add `rotateMasterKey` to the service factory.**

Edit `frontend/src/services/networks.ts`. Inside `createIndexesService` (around line 352, after `resendInvite`), add the new method:

```ts
  // Rotate the master key on an experiment network. Plaintext is returned
  // exactly once; the old key stops working immediately.
  rotateMasterKey: async (networkId: string): Promise<{ masterKey: string }> => {
    return api.post<{ masterKey: string }>(`/networks/${networkId}/rotate-master-key`, {});
  },
```

The new method goes inside the object literal returned by `createIndexesService`, immediately before the closing `});` of the factory.

- [ ] **Step 2: Run tsc on the frontend.**

Run: `cd frontend && bun run tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add frontend/src/services/networks.ts
git commit -m "feat(frontend): add rotateMasterKey to network service

Wraps POST /networks/:id/rotate-master-key. Returns plaintext key
that the caller must surface once and never store."
```

---

## Task 6: EdgeClaw row in the integrations tab

UI change. No new test file — relies on `tsc --noEmit`, ESLint, and manual verification per the spec.

**Files:**
- Modify: `frontend/src/components/NetworkSettingsPanel.tsx`

- [ ] **Step 1: Add imports + state for the rotation flow.**

Edit `frontend/src/components/NetworkSettingsPanel.tsx`.

At the top of the file, add this import alongside the other component imports (the existing import block ends with `CsvPreviewModal` on line 20):

```ts
import MasterKeyDialog from '@/components/MasterKeyDialog';
```

Inside `NetworkSettingsPanel` (the function body, near the other `useState` hooks around line 87 where `csvError` and `showCsvModal` are declared), add:

```ts
  const [showRotateConfirm, setShowRotateConfirm] = useState(false);
  const [rotateConfirmationText, setRotateConfirmationText] = useState('');
  const [isRotating, setIsRotating] = useState(false);
  const [rotatedMasterKey, setRotatedMasterKey] = useState<string | null>(null);
```

- [ ] **Step 2: Add the rotate handler.**

In the same component, add this callback alongside the existing handlers — place it immediately after `handleConfirmResend` (around line 337):

```ts
  const handleConfirmRotate = async () => {
    if (isRotating) return;
    if (rotateConfirmationText !== currentIndex.title) return;
    setIsRotating(true);
    try {
      const result = await indexesService.rotateMasterKey(index.id);
      setShowRotateConfirm(false);
      setRotateConfirmationText('');
      setRotatedMasterKey(result.masterKey);
      success('Master key rotated — old key is now invalid');
    } catch (err) {
      console.error('Master key rotation failed', err);
      error('Failed to rotate master key');
    } finally {
      setIsRotating(false);
    }
  };
```

`indexesService`, `success`, and `error` are already in scope at this point (lines 40–43 of the file). `currentIndex` is the existing memoized network object (line 47).

- [ ] **Step 3: Render the EdgeClaw block in the integrations tab.**

Find the existing `activeTab === 'integrations'` branch (line 900). Inside that `<div className="space-y-4">` (immediately after the closing `</div>` of the Gmail/Slack toolkit list, around line 936), add the EdgeClaw block:

```tsx
          {currentIndex.isExperiment && (
            <div className="pt-2">
              <div className="flex items-start gap-3 p-3 border border-gray-200 rounded-sm">
                <img
                  src="/integrations/edgeclaw.png"
                  width={24}
                  height={24}
                  alt="EdgeClaw"
                  className="flex-shrink-0 mt-0.5"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div className="flex-1 min-w-0 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-black">EdgeClaw</div>
                      <div className="text-xs text-gray-500">Server-side signup for experiment attendees</div>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => setShowRotateConfirm(true)}
                      disabled={isRotating}
                    >
                      <RotateCw className="h-3.5 w-3.5 mr-1.5" />
                      Rotate key
                    </Button>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-1.5">Signup endpoint</div>
                    <CopyableBox value={typeof window !== 'undefined' ? `${window.location.origin}/api/networks/${currentIndex.id}/signup` : `/api/networks/${currentIndex.id}/signup`} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-1.5">Master key</div>
                    <CopyableBox value={'•••••••• (shown once at creation — rotate for a new one)'} />
                  </div>
                  <p className="text-xs text-gray-500">
                    Used server-side by InstaClaw and EdgeOS. Never expose in user-facing apps.
                  </p>
                </div>
              </div>
            </div>
          )}
```

`RotateCw` and `Button` are already imported at the top of this file (`RotateCw` is in the `lucide-react` import on line 4; `Button` on line 6). `CopyableBox` is imported on line 30.

- [ ] **Step 4: Render the rotate-confirm `AlertDialog`.**

Find the existing **Delete network** `AlertDialog.Root` block at the bottom of the JSX (search for `Delete &apos;{currentIndex.title}&apos;` — it's around line 944). Add this new dialog immediately after the closing `</AlertDialog.Root>` of the delete dialog and before the resend `AlertDialog.Root`:

```tsx
      <AlertDialog.Root open={showRotateConfirm} onOpenChange={(open) => { if (!open) { setShowRotateConfirm(false); setRotateConfirmationText(''); } }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
            <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-4">Rotate master key</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-gray-600 mb-4">
              Rotating issues a new master key and immediately revokes the current one. Any backend using the old key (InstaClaw, EdgeOS) will stop working until you redeploy it with the new key. We will also email the new key to every owner of this network. Type the network name to confirm.
            </AlertDialog.Description>
            <Input
              value={rotateConfirmationText}
              onChange={(e) => setRotateConfirmationText(e.target.value)}
              placeholder={currentIndex.title}
              className="mb-4"
            />
            <div className="flex justify-end gap-3">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={isRotating}>Cancel</Button>
              </AlertDialog.Cancel>
              <Button
                onClick={handleConfirmRotate}
                disabled={isRotating || rotateConfirmationText !== currentIndex.title}
              >
                {isRotating ? 'Rotating...' : 'Rotate'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
```

- [ ] **Step 5: Render the one-time `MasterKeyDialog`.**

Add this component just before the closing `</>` fragment at the bottom of the return statement (after the `CsvPreviewModal` block at the very end):

```tsx
      {rotatedMasterKey && (
        <MasterKeyDialog
          open={!!rotatedMasterKey}
          masterKey={rotatedMasterKey}
          onClose={() => setRotatedMasterKey(null)}
        />
      )}
```

- [ ] **Step 6: Run tsc.**

Run: `cd frontend && bun run tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Run lint.**

Run: `cd frontend && bun run lint`
Expected: no errors. Warnings about pre-existing files are fine; the new code must lint clean.

- [ ] **Step 8: Commit.**

```bash
git add frontend/src/components/NetworkSettingsPanel.tsx
git commit -m "feat(frontend): EdgeClaw row + master-key rotation on integrations tab

Adds an EdgeClaw block to NetworkSettingsPanel's integrations tab,
visible only on experiment networks. Shows the signup endpoint and a
masked master-key placeholder, plus a typed-confirm rotate dialog that
calls POST /networks/:id/rotate-master-key and surfaces the new key
once via the existing MasterKeyDialog."
```

---

## Task 7: Documentation + version bumps

**Files:**
- Modify: `docs/specs/api-reference.md`
- Modify: `packages/edgeclaw/README.md`
- Modify: `backend/package.json`
- Modify: `frontend/package.json`

- [ ] **Step 1: Document the new endpoint.**

Edit `docs/specs/api-reference.md`. After the existing `### DELETE /api/networks/:id` block (it ends at line 1594), insert:

```markdown
### POST /api/networks/:id/rotate-master-key

Rotate the master key on an experiment network. Owner only. The plaintext is returned exactly once; the previous key stops working immediately. Every owner of the network also receives the new key by email.

**Auth**: AuthGuard (session) or AuthOrApiKeyGuard (API key)

**Path params**:
- `id` — Network ID

**Request body**: none

**Response**:
```json
{
  "masterKey": "<plaintext-64-chars>"
}
```

**Errors**:
- `400` — Network is not an experiment network.
- `403` — Caller is not an owner.

```

- [ ] **Step 2: Update the EdgeClaw README.**

Edit `packages/edgeclaw/README.md`. Find the "Authentication" subsection in the "Integration API" section (around line 45). After the paragraph that begins `The master key is issued once when the experiment network is created…`, append this paragraph:

```markdown
The master key can be **rotated** from the integrations tab of the network's settings page in the Index Network dashboard. Rotation issues a new plaintext key (shown once) and emails it to every owner of the network; the previous key is invalidated immediately. Use this when the key is lost or to revoke an existing one.
```

- [ ] **Step 3: Bump backend version.**

Edit `backend/package.json`. Change:

```json
"version": "0.21.7",
```

to:

```json
"version": "0.22.0",
```

- [ ] **Step 4: Bump frontend version.**

Edit `frontend/package.json`. Change:

```json
"version": "0.7.4",
```

to:

```json
"version": "0.8.0",
```

- [ ] **Step 5: Commit docs + versions.**

```bash
git add docs/specs/api-reference.md packages/edgeclaw/README.md backend/package.json frontend/package.json
git commit -m "docs+chore: document rotate-master-key endpoint, bump backend 0.22.0 + frontend 0.8.0"
```

---

## Task 8: Manual verification

Don't claim done without doing this. The UI cannot be verified by type-checking alone.

- [ ] **Step 1: Start the dev stack.**

Run (in one terminal): `cd backend && bun run dev`
Run (in another terminal): `cd frontend && bun run dev`

Wait until both servers are listening. The backend logs `Server running on port 3001`; the frontend logs the Vite URL (typically `http://localhost:5173`).

- [ ] **Step 2: Create an experiment network in the UI.**

In a logged-in browser session, open Sidebar → New Network → switch to **Experiment** in the create modal → submit. Confirm the `MasterKeyDialog` shows a plaintext key. **Close the dialog without copying** to simulate the recovery scenario.

- [ ] **Step 3: Open the integrations tab.**

Navigate to that network → click the **Integrations** tab. Confirm:
- The Gmail and Slack rows render as before.
- The EdgeClaw block appears below them with the signup endpoint and masked master-key placeholder.
- Both `<CopyableBox>` widgets copy their values when clicked.

- [ ] **Step 4: Rotate the key.**

Click **Rotate key**. Confirm:
- The dialog appears with the network name prompt.
- The **Rotate** button is disabled until you type the network name exactly.
- On confirm, the dialog closes, a `MasterKeyDialog` appears with a new 64-character key, and a "Master key rotated" toast fires.

- [ ] **Step 5: Verify the new key works against the signup endpoint.**

Copy the new master key. Run:

```bash
curl -i -X POST "http://localhost:3001/api/networks/<NETWORK_ID>/signup" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <NEW_MASTER_KEY>" \
  -d '{"email":"verify-rotate@example.com"}'
```

Expected: `HTTP/1.1 200 OK` or `201 Created` with a JSON body containing `user`, `apiKey`, and `mcpServer`.

- [ ] **Step 6: Verify the old key is rejected (if you saved it from creation).**

If you did keep the original key from the creation dialog, repeat the curl with the OLD key.

Expected: `HTTP/1.1 403 Forbidden` with `{"error":"Forbidden"}`.

(If you didn't keep the original key, that's fine — the service spec from Task 3 already asserts the hash changed.)

- [ ] **Step 7: Verify the rotation email.**

If `RESEND_API_KEY` is set in the backend `.env` and `EMAIL_PRODUCTION_MODE !== 'true'`, look at `backend/email-debug.md` — the rotation email should be appended there with the new key in both the text and HTML parts.

If `RESEND_API_KEY` is unset (default for local dev), `executeSendEmail` no-ops cleanly and the backend logs a warning — no email artifact, which is expected.

- [ ] **Step 8: Verify non-experiment networks hide the block.**

Open a non-experiment network's integrations tab. Confirm the EdgeClaw block does NOT render. Gmail/Slack rows render normally.

- [ ] **Step 9: Stop the dev servers and report completion.**

Mention any unexpected behavior in the completion message. If the UI verification surfaced a defect, **do not** mark the work complete — open a follow-up commit or surface it.

---

## Self-review notes

This plan covers every section of the spec:
- ✅ Surface model on integrations tab — Task 6
- ✅ Rotation flow (frontend) — Task 6 steps 2, 4
- ✅ Frontend service plumbing — Task 5
- ✅ Visibility rule (experiment-only) — Task 6 step 3
- ✅ New backend endpoint — Task 4
- ✅ Service-layer change — Task 3
- ✅ Shared key-generator helper — Task 1
- ✅ Hashing function reuse — Task 1 step 2
- ✅ Email template — Task 2
- ✅ Backend tests — Tasks 2, 3, 4
- ✅ Frontend manual verification — Task 8
- ✅ Migrations: none required — confirmed in plan header
- ✅ Version bumps — Task 7
- ✅ Documentation (api-reference, edgeclaw README) — Task 7
