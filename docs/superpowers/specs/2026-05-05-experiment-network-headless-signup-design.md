# Experiment Network Headless Signup

**Issue:** IND-245
**Date:** 2026-05-05
**Status:** Draft

## Overview

Networks can be flagged as "experiments" — isolated, invite-only environments where an external app (e.g., InstaClaw for Edge City) can create user accounts via a trusted master key. Experiment users are scoped to their network, invisible to the regular auth system, and fully disposable. The pattern is generalizable: "Edge City" is just the first instance.

## Schema Changes

### `users` table

- Add `experimentNetworkId` column: `uuid`, nullable, FK to `networks.id`.
  - When set: user is an experiment user scoped to that network.
  - When null: normal organic user.
- **Replace** `uniqueIndex('users_email_unique').on(email)` with a compound unique index on `(email, experimentNetworkId)`.
  - Postgres treats nulls as distinct in unique indexes, so one organic `alice@example.com` plus one per experiment network is allowed.

### `networks` table

- Add `isExperiment` column: `boolean`, default `false`, not null. **Immutable** — set at creation, cannot be changed after.
- Add `experimentMasterKeyHash` column: `text`, nullable. Stores SHA-256 + base64url hash of the master key (same hashing as existing API keys).

### No new tables.

## Endpoint

### `POST /networks/:id/signup`

**Auth:** Custom guard — no session/JWT. Validates `x-api-key` header against the network's `experimentMasterKeyHash`.

**Guard logic:**
1. Look up network by `:id`
2. Verify `isExperiment === true`
3. Hash provided key, compare against `experimentMasterKeyHash`
4. Reject with 403 if any check fails

**Request body:**
```json
{ "email": "alice@example.com" }
```

**Response (201 created / 200 existing):**
```json
{
  "user": { "id": "...", "email": "alice@example.com" },
  "apiKey": "idx_..."
}
```

**Idempotency:** If the email already exists for this experiment network, return the existing user but generate a new API key (old keys cannot be retrieved).

## Signup Flow

1. **Find or create user** — Query by `(email, experimentNetworkId)`. If not found, create with `experimentNetworkId` set, `isGhost: false`, `emailVerified: true` (trusted by master key).
2. **Ensure personal network** — Call existing `ensurePersonalNetwork(userId)`.
3. **Join experiment network** — Upsert into `networkMembers` with `['member']` permissions.
4. **Create personal agent + token** — `agentService.create()` + default permissions + `agentService.createToken()`.
5. **Return** user info + raw API key.

On repeat calls (user exists), steps 1–3 are idempotent; step 4 creates a new token.

## Master Key Provisioning

When a network is created with `isExperiment: true`:

1. Generate a 64-char random master key (same format as agent API keys).
2. Hash with SHA-256 + base64url (matching existing key hashing).
3. Store hash in `experimentMasterKeyHash`.
4. Return the raw key **once** in the create response.

Key regeneration (rotate) is out of initial scope but the hash approach makes it possible later.

## Constraints & Rules

### Network rules
- `isExperiment` is **immutable** — set at creation, never changed. Existing networks cannot be converted.
- Experiment networks force `joinPolicy: 'invite_only'` and `allowGuestVibeCheck: false`.
- Experiment networks cannot be public. All users come through headless signup.

### User isolation
- Experiment users (`experimentNetworkId IS NOT NULL`) cannot log into index.network. Better Auth queries filter `experimentNetworkId IS NULL`.
- Experiment users can only see their personal network and their experiment network when listing networks.
- Same email across multiple experiments creates separate user rows.

### Existing query safety
Every existing query that looks up users by email must explicitly filter `WHERE experimentNetworkId IS NULL` to avoid resolving to an experiment user:
- Better Auth adapter (user lookup, upsert, ghost user claiming)
- ContactService (find by email)
- Ghost user claiming (only claim organic ghosts)
- Any other email-based user lookups

### Cascading soft delete
When an experiment network is soft-deleted (`deletedAt` set), cascade `deletedAt` to:
- All experiment users scoped to that network (`experimentNetworkId = network.id`)
- Their intents, intent_indexes, opportunities, network memberships, personal networks, agents, API keys

Data remains recoverable but disappears from all queries (which filter `deletedAt IS NULL`).

### Within the experiment
- Users have full functionality: manage intents, opportunities, personal network, contacts.
- Users get the same personal agent + default permissions as any organic user.

## Data Model (future-proofing)

- `experimentNetworkId` on the user row serves as an origin marker. If account merging is ever needed, this field identifies which users came from which experiment.
- No merge flow is in scope. Experiment accounts are disposable.
