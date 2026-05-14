# EdgeClaw row on network integrations tab + master-key rotation

**Linear:** [IND-302](https://linear.app/indexnetwork/issue/IND-302/edgeclaw-row-on-network-integrations-tab-with-master-key-rotation)
**Date:** 2026-05-14
**Status:** Approved — ready for implementation plan

## Goal

Surface EdgeClaw as a first-class integration on the network settings → integrations tab for **experiment networks only**, and give owners a way to **rotate the network's master key** when they have lost it or want to revoke an existing one.

The master key is what InstaClaw and EdgeOS use server-side to call `POST /networks/:id/signup` and provision attendees of an Edge Esmeralda–style experiment network. Today the plaintext key is shown exactly once — in `MasterKeyDialog` immediately after creating an experiment network — and only the SHA-256 hash is persisted. If the operator misses that one-time reveal there is no recovery path other than recreating the network. This spec closes that gap.

## Why not just store the plaintext

Considered and rejected. Persisting the plaintext would mean anyone with database access can read the admin key in the clear. The integrations tab is a recovery surface for owners, not a vault — rotation gives the same UX outcome without weakening the threat model.

## User stories

1. As the owner of an experiment network, I open the **Integrations** tab and see an EdgeClaw row alongside Gmail and Slack — but only on networks I created as experiments.
2. The row tells me which endpoint to point a backend at (`POST /api/networks/<id>/signup`) and explains that the master key is server-side-only.
3. If I have lost the master key, I click **Rotate key**, type the network name to confirm, and immediately see a one-time dialog with the new plaintext key. Every owner of the network also receives the new key by email.
4. The previous key stops working the moment rotation succeeds. Any backend still using the old key returns 403 until reconfigured.

## Out of scope

- The existing **"OpenClaw plugin config"** JSON block in the access (contacts) tab — left untouched. This spec is purely for EdgeClaw on the integrations tab.
- Gmail and Slack rows — unchanged.
- The one-time `MasterKeyDialog` rendered at experiment-network creation — reused as-is.
- Non-experiment networks — the EdgeClaw row does not render at all for them.
- Audit log of past rotations. Not required.

## Frontend design

File: `frontend/src/components/NetworkSettingsPanel.tsx`.

The existing integrations tab (lines ~900–938) iterates over `AVAILABLE_TOOLKITS = ['gmail', 'slack']` and renders a toggle row per toolkit. EdgeClaw does not fit the toggle model — there is no "connect/disconnect" state, the row is simply present when the network is an experiment. So we add EdgeClaw **after** the toolkit list as a sibling block, gated on `currentIndex.isExperiment`.

### Row layout

Visual rhythm matches the existing Gmail/Slack rows:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [icon]  EdgeClaw                                            [Rotate key]│
│         Server-side signup for experiment attendees                     │
│                                                                         │
│         Signup endpoint                                                 │
│         ┌─────────────────────────────────────────────────────────────┐ │
│         │ https://protocol.index.network/api/networks/<id>/signup   📋│ │
│         └─────────────────────────────────────────────────────────────┘ │
│                                                                         │
│         Master key                                                      │
│         ┌─────────────────────────────────────────────────────────────┐ │
│         │ •••••••• (shown once at creation — rotate for a new one)  📋│ │
│         └─────────────────────────────────────────────────────────────┘ │
│                                                                         │
│         Used server-side by InstaClaw and EdgeOS. Never expose in       │
│         user-facing apps.                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

- Icon: `/integrations/edgeclaw.png` (added to `frontend/public/integrations/`).
- Both copyable fields use the existing `<CopyableBox>` component (matches the OpenClaw block on the access tab visually).
- Signup endpoint URL: built from `window.location.origin` + `/api/networks/<id>/signup` to mirror the existing OpenClaw block's pattern of deriving `url` from `window.location.origin`.
- The masked master-key field's copy button copies the placeholder text verbatim. There is no plaintext to copy at rest, and rendering a different (e.g. disabled) state would break the visual rhythm with the signup-endpoint field above it.
- `Rotate key` button is right-aligned in the row header. Disabled while a rotation request is in flight.

### Rotation flow (frontend)

1. Click `Rotate key` → opens an `AlertDialog` styled like the existing **Delete network** dialog (`NetworkSettingsPanel` line ~940).
2. Dialog copy:
   > Rotating issues a new master key and immediately revokes the current one. Any backend using the old key (InstaClaw, EdgeOS) will stop working until you redeploy it with the new key. We will also email the new key to every owner of this network.
   >
   > Type **\<network title\>** to confirm.
3. `Input` field; the `Rotate` button is disabled until the input exactly matches the network title (same predicate the delete dialog uses).
4. On `Rotate` click → `POST /api/networks/:id/rotate-master-key`, set `isRotating`. On success: close the confirm dialog, open `<MasterKeyDialog open masterKey={response.masterKey} onClose={...} />` (the component already exists and is reused unchanged). On failure: show a toast via the existing `useNotifications().error` channel.
5. The confirm dialog stays open behind a spinner while the request is in flight, so the user gets visible feedback before the one-time reveal.

### Service plumbing

Add to `frontend/src/services/networks.ts` (alongside the existing `createNetwork` that handles `masterKey`):

```ts
rotateMasterKey: async (networkId: string): Promise<{ masterKey: string }> => {
  return api.post<{ masterKey: string }>(`/networks/${networkId}/rotate-master-key`);
}
```

### Visibility rule

The entire EdgeClaw block is wrapped in `{currentIndex.isExperiment && ( … )}` and lives inside the `activeTab === 'integrations'` branch. `NetworkSettingsPanel` itself is only rendered when `isOwner` is true (see `networks/[id]/page.tsx`), so non-owners never see it even if the network is an experiment.

## Backend design

### New endpoint

`POST /networks/:id/rotate-master-key`

- Guards: `AuthGuard` + owner check on the network (same pattern used by other owner-only mutations in `network.controller.ts`, e.g. `updateNetwork`).
- Pre-conditions:
  - `networks.is_experiment === true`
  - `networks.experiment_master_key_hash IS NOT NULL`
  - `networks.deleted_at IS NULL`
  - Otherwise return `400` with `{ error: 'Not an experiment network' }` or `403` for the auth / ownership failures.
- Body: none.
- Response (200):
  ```json
  { "masterKey": "<plaintext>" }
  ```
- Side effects:
  1. New hash is committed before the function returns.
  2. Owner-notification email is dispatched **after** the DB write succeeds, fire-and-forget with a `.catch(logger.error)` — same fail-soft pattern as `network-invitation.service.invite()` (line ~199 of `network-invitation.service.ts`).

### Service-layer change

`backend/src/services/network.service.ts`:

```ts
async rotateExperimentMasterKey(
  networkId: string,
  userId: string,
): Promise<{ masterKey: string }>
```

Steps:

1. Load the network. Assert `isExperiment && experimentMasterKeyHash`. Otherwise throw a typed error mapped to `400` by the controller.
2. Assert the caller is an owner (existing helper or inline check via `network_members.permissions`).
3. Call `generateMasterKey()` (new shared helper, see below) — returns `{ key, hash }`.
4. `UPDATE networks SET experiment_master_key_hash = $hash WHERE id = $id`.
5. Look up every member of the network with `'owner'` in `permissions`, then dispatch the rotation email (see "Email" below) for each. Fire-and-forget per recipient.
6. Return `{ masterKey: key }`.

### Shared key-generator helper

The current key generation lives inline in `NetworkService.createExperimentNetwork` (lines ~58–70):

```ts
const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const bytes = crypto.getRandomValues(new Uint8Array(64));
let masterKey = '';
for (let i = 0; i < 64; i++) {
  masterKey += chars[bytes[i] % chars.length];
}
const encoded = new TextEncoder().encode(masterKey);
const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
const masterKeyHash = Buffer.from(hashBuffer).toString('base64url');
```

Extract this into `backend/src/lib/experiment/master-key.ts`:

```ts
export async function generateMasterKey(): Promise<{ key: string; hash: string }>;
```

`createExperimentNetwork` and the new `rotateExperimentMasterKey` both call it. Keeps the alphabet, length, and hashing in one place.

### Hashing function

The new helper uses the same SHA-256 + base64url scheme used by `experiment.guard.ts` `hashKey()` and the inline code in `createExperimentNetwork`. Verify by reading `experiment.guard.ts` lines 6–10:

```ts
async function hashKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return Buffer.from(hash).toString('base64url');
}
```

After this change, both places import the same helper from `lib/experiment/master-key.ts`. The guard's `hashKey()` is now a thin re-export so `ExperimentMasterKeyGuard` continues to work without code duplication.

### Email

New template: `backend/src/lib/email/templates/network-master-key-rotated.template.ts`, next to `network-invitation.template.ts`. Markdown body delivered via the same `executeSendEmail` transport helper used by the invitation email.

Subject: `Master key rotated for <network title>`

Body (Markdown, rendered to HTML by the transport):

```
Hi,

The master key for **<network title>** has just been rotated by **<actor name or email>**.

The previous key is no longer valid. Any backend (InstaClaw, EdgeOS) still using the old key will return 403 until it is reconfigured.

Your new master key (shown only once):

    <plaintext key>

Treat this like a password — store it in your backend's secret manager and do not paste it into chat. You can view the integration on the [<network title> integrations tab](<appUrl>/networks/<id>/integrations).

— Index Network
```

Recipients: every user that is a member of the network with `'owner'` in `network_members.permissions`. The actor row's email is omitted from the recipient list only if the actor is not actually an owner (defense in depth — should never happen because the endpoint already requires owner auth, so in practice the actor is always among the recipients).

If `RESEND_API_KEY` is not configured in the environment, the transport helper already no-ops cleanly — we do not block rotation on email delivery.

## Tests

Locations follow existing conventions (see `CLAUDE.md` Testing section — load env at top, import from `bun:test`, group with `describe`).

### Backend

- `backend/src/services/tests/network.service.spec.ts`
  - `rotateExperimentMasterKey` rotates the hash on an experiment network owned by the caller and returns plaintext.
  - Throws when the network is not an experiment.
  - Throws when the caller is not an owner.
  - Throws when the network is soft-deleted.
  - Emits owner emails (assert via a stubbed transport).
- `backend/src/controllers/tests/network.controller.spec.ts`
  - Endpoint is guarded by `AuthGuard` (401 without session).
  - Returns 403 for non-owners.
  - Returns 400 for non-experiment networks.
  - Returns 200 + `{ masterKey: string }` for the happy path.
- `backend/src/guards/tests/experiment.guard.spec.ts` (if it doesn't already cover this) — sanity check that the new key validates and the old key is rejected after rotation. Add the test even if it duplicates one assertion in the service spec; this exercises the full guard.

### Frontend

No new test file. Rely on:
- `tsc --noEmit` (per the `feedback_tsc_before_completion` rule)
- ESLint
- Manual UI check: open an experiment network's integrations tab as the owner; verify the row appears, fields copy correctly, rotation dialog requires the typed name, and the `MasterKeyDialog` appears on success.

## Migrations & schema

**None.** The work reuses the existing `networks.experiment_master_key_hash` column. No new tables, no new columns.

## Version bumps (per `feedback_version_bump`)

- `backend/package.json` — minor bump (new public endpoint).
- `frontend/package.json` — minor bump (new UI surface).
- No subtree package changes (`packages/cli`, `packages/protocol`, `packages/openclaw-plugin`, `packages/claude-plugin`, `packages/edgeclaw`) — none are touched.

## Documentation

- `docs/specs/api-reference.md` — add the `POST /networks/:id/rotate-master-key` endpoint under the networks section.
- `packages/edgeclaw/README.md` "Integration API" section — append a paragraph noting that the master key can be rotated from the integrations tab and is delivered by email on rotation. (Edit through this monorepo; the subtree-sync workflow propagates to the fork.)
- No changes to `CLAUDE.md` — no architectural shift.
- No changes to `docs/domain/` or `docs/design/` — entity model and architecture are unchanged.

## Implementation order

1. Backend: extract `generateMasterKey()` into `lib/experiment/master-key.ts`. Refactor `createExperimentNetwork` and `experiment.guard.ts` to use it. Keep behavior identical; run existing tests.
2. Backend: add email template + service method + controller route + tests.
3. Frontend: add `rotateMasterKey` to `services/networks.ts`. Add the EdgeClaw row and rotate confirm dialog to `NetworkSettingsPanel`. Wire the existing `MasterKeyDialog`.
4. Add `frontend/public/integrations/edgeclaw.png` (icon asset). If unavailable at implementation time, the existing `onError` handler on `<img>` already hides broken icons gracefully — no blocker.
5. Manual UI verification on a freshly created experiment network: create → close one-time dialog without copying → open integrations tab → rotate → verify the new key works against `/api/networks/:id/signup` and the old key returns 403.
6. Update docs and bump versions before merging.
