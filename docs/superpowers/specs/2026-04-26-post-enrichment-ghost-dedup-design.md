# Post-Enrichment Ghost User Deduplication

## Problem

When contacts are imported via different email addresses, the system creates separate ghost users for each email — even when they represent the same person. The existing import-time dedup (`backend/src/lib/dedup/dedup.ts`) requires both name AND email similarity to pass thresholds, so contacts with different email domains (e.g. `seref@index.network`, `seref@index.as`, `serafettin@gowit.dev`) survive dedup despite being the same person.

After enrichment via the Parallel Chat API, we have strong identity signals — social handles, professional narrative, location — that can reliably distinguish duplicates from genuinely different people sharing a name.

## Solution

Add a post-enrichment dedup step inside the profile generation graph. After a ghost user is enriched and before embedding/saving the profile, check for matching users globally. If a match is found, merge the ghost into the target user and exit the graph early.

## Matching Strategy

Run in priority order, stop at first match:

1. **LinkedIn handle** — exact, case-insensitive match on `users.socials->>'linkedin'`
2. **GitHub handle** — exact, case-insensitive match on `users.socials->>'github'`
3. **Twitter/X handle** — exact, case-insensitive match on `users.socials->>'x'`
4. **Embedding similarity** (fallback) — only when the ghost has no enriched social handles. Compute a lightweight embedding from enrichment text, query `user_profiles` for cosine similarity >= 0.95 combined with Jaro-Winkler name similarity >= 0.85.

### Candidate Selection

- Check against **all non-deleted users globally** (not scoped to a single owner's contacts).
- Exclude the ghost being enriched from results.
- Prefer real users over ghosts. Among ghosts, prefer the oldest (`created_at`).
- Social handles are globally unique identifiers (one `serefyarar` on LinkedIn), so global scope is safe.

## Merge Operation

A single database transaction re-points all of the ghost's data to the target user, then soft-deletes the ghost.

### Re-point to target user (B)

| Table | Column | Strategy |
|-------|--------|----------|
| `intents` | `user_id` | `UPDATE SET user_id = B WHERE user_id = A` |
| `opportunities` | `actors` (JSONB) | Replace A's userId with B in the actors array; also update `detection.created_by` if present |
| `opportunity_deliveries` | `user_id` | `UPDATE SET user_id = B`; skip rows that would violate the conditional unique index |
| `network_members` | `user_id` | `UPDATE SET user_id = B`; skip rows where B is already a member of that network |
| `conversation_participants` | `participant_id` | `UPDATE SET participant_id = B WHERE participant_type = 'user'`; skip if B already participates |
| `messages` | `sender_id` | `UPDATE SET sender_id = B WHERE sender_id = A` (only where `role = 'user'`) |
| `files` | `user_id` | `UPDATE SET user_id = B` |
| `links` | `user_id` | `UPDATE SET user_id = B` |

### Delete ghost-only data

| Table | Reason |
|-------|--------|
| `user_profiles` | Target already has (or will get) a profile |
| `user_notification_settings` | Ghosts don't have meaningful settings |
| `sessions`, `accounts` | Ghosts have no auth sessions |
| `apikeys` | Ghosts don't have API keys |
| `agents`, `agent_permissions` | Ghosts shouldn't own agents; defensive cleanup |
| `hyde_documents` | Ghost's HyDE docs (source='profile') are orphaned after merge |

### Final step

Soft-delete user A: `UPDATE users SET deleted_at = now() WHERE id = A`.

### Constraints handled

- `user_profiles.user_id` has a UNIQUE constraint — delete A's profile before merge.
- `user_notification_settings.user_id` has a UNIQUE constraint — delete A's settings before merge.
- `network_members` has composite PK `(network_id, user_id)` — skip if B already in network.
- `opportunity_deliveries` has a conditional unique on `(user_id, opportunity_id, channel, delivered_at_status)` — skip conflicting rows.
- `agent_permissions` has a conditional unique on `(agent_id, user_id)` WHERE scope='global' — delete A's permissions.
- `conversation_participants` has composite PK `(conversation_id, participant_id)` — skip if B already participates.
- `personal_networks` PK is `user_id` — ghosts never have personal networks (confirmed in prod; creation path is auth-only). No handling needed.

## Hook Point

`packages/protocol/src/profile/profile.graph.ts`, inside `autoGenerateNode`:

- **After**: `hasMeaningfulEnrichment` check confirms enrichment has identity + socials data.
- **Before**: Name validation, embedding computation, profile save.

If a duplicate is found, the graph returns early with a "merged as duplicate" status. No embedding or HyDE generation runs for the duplicate.

## Code Changes

### New interface methods

In `packages/protocol/src/shared/interfaces/database.interface.ts` on the `ProfileGraphDatabase` interface:

- `findDuplicateUser(userId: string, socials: EnrichmentSocials, enrichmentText?: string): Promise<{ id: string } | null>` — queries for matching users by social handles (primary) or embedding similarity (fallback). Excludes the given userId and deleted users. Returns the best match (real user preferred, then oldest ghost).
- `mergeGhostUser(sourceId: string, targetId: string): Promise<void>` — runs the full re-point + delete in a single transaction.

### Database adapter implementation

In `backend/src/adapters/database.adapter.ts`:

- `findDuplicateUser()` — queries `users.socials` JSONB for matching LinkedIn/GitHub/X handles. Falls back to embedding similarity if no social handles available.
- `mergeGhostUser()` — transaction with the re-point and delete operations listed above.

### Graph integration

~15 lines in `autoGenerateNode` between the `hasMeaningfulEnrichment` check and existing name validation:

1. Update the ghost's socials on the `users` row (so the match query works against persisted data, and so the ghost's enriched socials survive for audit).
2. Call `findDuplicateUser(userId, enrichedSocials)`.
3. If match found, call `mergeGhostUser(userId, match.id)`.
4. Return early with error status indicating merge.

## What This Doesn't Do

- No retroactive batch dedup of existing ghosts (future maintenance script).
- No merge of two real users.
- No UI — fully automatic and silent.
- No changes to the import-time dedup logic in `backend/src/lib/dedup/dedup.ts`.
