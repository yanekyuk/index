# Resend Network Invitation with Key Rotation

**Status:** Draft
**Date:** 2026-05-09

## Goal

Network owners can resend the invitation email for any member of an experimental network they own — including themselves. Each resend rotates the recipient's network-scoped API key: the previous key (or keys) for that user's network-scoped agent is deleted and a fresh key is minted, then emailed. The action is exposed as a small button immediately to the left of the existing trash icon on each member row in the network settings panel.

## Non-Goals

- Bulk resend (CSV-style or "rotate all members").
- Resend for non-experimental networks. The current invite flow is gated to experiment networks via `assertExperimentOwner`; this feature inherits that gate.
- Persisting rotation history or surfacing it in the UI.
- Changing the threat model — possession of the email inbox remains the verification.

## Background

The existing invitation flow (`backend/src/services/network-invitation.service.ts`) is intentionally idempotent: `invite({ networkId, email, name? })` always ensures the user, personal network, and `network_members` row exist, then provisions a network-scoped personal agent + API key **only if no scoped agent exists**. If one already exists, it returns `agentProvisioned: false` and sends nothing. This is the right shape for a first-time CSV import but does not give organizers a way to recover when a member loses their key.

API keys live in Better Auth's `apikey` table and are written by `agentTokenAdapter.create()` (hashed via SHA-256 + base64url). `agentTokenAdapter.revoke(userId, tokenId)` performs a hard `DELETE`. There is no soft-revoke field. Each token's `metadata` column is a JSON-stringified `{ agentId }` pointer back to the agent it authenticates for.

## Design

### Backend

**New endpoint:** `POST /networks/:networkId/members/:memberId/resend-invite`

- Auth + ownership: reuses `assertExperimentOwner(networkId, userId)` (already used by remove-member, invite-member, CSV-import).
- 404 if `memberId` is not a current member of `networkId`.
- Self-target is allowed: `memberId` may equal the caller's user id (an owner rotating their own key).
- Response: `{ rotated: boolean, email: string }`.
  - `rotated: true` when at least one existing API key for the member's network-scoped agent was deleted before minting the new one.
  - `rotated: false` when the member had no scoped agent yet and one was provisioned fresh (treated like a first-time invite).

**Service:** add `networkInvitationService.resendInvite({ networkId, memberId, requestedByUserId })` to `backend/src/services/network-invitation.service.ts`.

Behavior:

1. Look up the member's email from `users` (filter `deletedAt IS NULL`); 404 if missing.
2. Confirm `network_members(networkId, memberId)` exists; 404 otherwise.
3. Look up the member's network-scoped agent via `agent_permissions` joined with `agents` (replicating the predicate already used by `hasScopedAgent`).
4. **If the agent exists:** delete every `apikey` row whose `metadata::jsonb->>'agentId'` matches that agent id (a new helper `agentTokenAdapter.revokeAllForAgent(agentId)` — see below). Mint a fresh key with `agentTokenAdapter.create`. Set `rotated = true`.
5. **If no agent exists:** call `provisionScopedAgent(memberId, networkId)` (the existing helper used by `invite()`). Set `rotated = false`.
6. Look up the network's title and build the connect command, identical to the original invite path.
7. Dispatch the invitation email passing a new `isResend: true` flag (see template change below). Existing fail-soft logging behavior is preserved.
8. Return `{ rotated, email }`.

**Adapter helper:** add `agentTokenAdapter.revokeAllForAgent(agentId: string): Promise<number>` to `backend/src/adapters/agent-token.adapter.ts`. Implementation deletes from `apikey` where `metadata::jsonb->>'agentId' = $1` and returns the count of rows deleted. The cast is required because `metadata` is stored as a JSON-encoded string; the query must use `sql` template tags from `drizzle-orm` for the JSON operator.

**Email template:** extend `network-invitation.template.ts` with optional `isResend?: boolean` on `NetworkInvitationParams`.

- When `isResend === true`:
  - Subject becomes `Your access key for ${subjectName} (refreshed)`.
  - Body (both HTML and text variants) prepends a single sentence: `Your previous key has been revoked. Use the key below going forward.`
- Default (`isResend` falsy): unchanged subject and body.

The fail-soft pattern (catch errors, log, return) carries over. If the email fails, the rotation has already succeeded and the previous key is gone — the spec accepts this trade-off because the alternative (rolling back token deletion) is more complex and the organizer can retry the resend.

### Frontend

**Component:** `frontend/src/components/NetworkSettingsPanel.tsx`.

- Add a `RotateCw` (lucide) icon button immediately before the existing trash icon for each member row. Tooltip: `Resend invitation`. The button is rendered for the network owner only — the same condition that gates the trash icon today.
- Clicking the button opens an `AlertDialog` built from the same Radix primitives + inline Tailwind currently used for the delete-network confirm at lines 905-920. The dialog is local to the row's button (single shared dialog with state pointing at the targeted member).
  - Title: `Resend invitation to {memberDisplay}?` where `memberDisplay` is the member's name (or email if name is absent), substituting `yourself` when the target is the current user.
  - Description: `This rotates {their|your} access key. The previous key will stop working immediately.` Pronoun varies on self-vs-other.
  - Buttons: `Cancel` and `Resend`. `Resend` is disabled while the request is in flight.
- On success: close the dialog and show a toast (using the same toast mechanism in use elsewhere in this file). On error: keep the dialog open and surface the error message inline.

**Service:** add `resendInvite(networkId, memberId): Promise<{ rotated: boolean; email: string }>` to `frontend/src/services/networks.ts`, posting to the new endpoint. The hook-only stub in the noop fallback at the bottom of that file should mirror the existing `removeMember` stub pattern.

## Permissions and Security

- Owner check: `assertExperimentOwner` already validates that the caller is the owner and that the network is an experiment network. No new guard needed.
- Self-resend is intentional and allowed.
- Old key revocation is unconditional once the agent is found — there is no "warn first" surface on the backend; the confirmation lives in the UI.
- The new endpoint is authenticated via `AuthOrApiKeyGuard`, matching sibling member endpoints. An API key calling this endpoint must have appropriate scope (`assertAgentNetworkScope` should be applied in the handler, mirroring `importMembers`).

## Tests

Backend:

- `resendInvite` rotates an existing token: pre-seed a member with a scoped agent and a key, call resend, assert the old key row is gone and a new key row exists with a different `start` value.
- `resendInvite` provisions when no scoped agent exists: pre-seed a member with no agent, call resend, assert agent + permissions + key are created and `rotated === false`.
- `resendInvite` fails 404 for a user who is not a member of the network.
- Controller: 403 for non-owner, 403 for non-experiment network, 404 for missing member, 200 for owner-on-other-member, 200 for owner-on-self.
- Email template: `isResend: true` produces refreshed subject and prepended addendum line in both HTML and text; `isResend: false` is byte-identical to the previous output.

Frontend (where the existing settings-panel test pattern allows):

- Clicking the resend button opens the dialog targeting the correct member; cancel closes without calling the service; confirm calls the service exactly once and shows a toast on success.

## Open / Deferred Decisions

None — the rotation deletes existing keys hard (matching the existing `agent-token.adapter` pattern) and the email template adds a small variant rather than a parallel template.
