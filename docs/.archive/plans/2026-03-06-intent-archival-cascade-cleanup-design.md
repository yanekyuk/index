# Intent Archival with Cascade Cleanup

**Issue**: IND-119 — Connect "create intent" frontend to backend, incl. undo functionality
**Date**: 2026-03-06
**Status**: Approved

## Problem

The frontend intent proposal flow creates intents via `POST /intents/confirm` and provides a 10-second undo window. The undo needs to archive the intent via `PATCH /intents/:id/archive`. However, the current archive implementation only sets `archivedAt` — it does not clean up dependent data (HyDE documents, opportunities, intent-index associations, queue jobs).

## Decision

- **No new endpoints.** The undo button calls `PATCH /intents/${intentId}/archive` (already exists).
- **Fix `intentService.archive()`** to perform full cascade cleanup.
- **Frontend change**: replace the stubbed `POST /intents/undo-proposal` call with `PATCH /intents/${intentId}/archive`, using the `intentId` returned from `POST /intents/confirm`.

## Frontend Changes

### `ChatContent.tsx`

- In `handleIntentProposalApprove`: store the `intentId` from the confirm response.
- In the toast `onAction` (undo): call `PATCH /intents/${intentId}/archive` instead of `POST /intents/undo-proposal`.
- Remove `handleIntentProposalUndo` (the card's inline undo) or have it also call the archive endpoint with `intentId`.
- Remove `POST /intents/undo-proposal` references entirely.

### `IntentProposalCard.tsx`

- The `onUndo` prop should pass `intentId` (not `proposalId`). The parent is responsible for capturing the `intentId` from the confirm response and closing over it.

## Backend Changes

### `intentService.archive(intentId, userId)`

Currently:
1. Verify ownership
2. Set `archivedAt` timestamp

After fix:
1. Verify ownership
2. Set `archivedAt` timestamp (existing)
3. Delete HyDE documents — enqueue `addDeleteHydeJob({ intentId })`
4. Remove intent-index associations — `DELETE FROM intent_indexes WHERE intentId = ?`
5. Expire opportunities — find opportunities where any `actors[].intent = intentId`, set `status = 'expired'`
6. Cancel pending queue jobs — remove queued HyDE generation and indexing jobs for this intent
7. Emit `IntentEvents.onArchived({ intentId, userId })`

### Database Adapter additions

- `deleteIntentIndexAssociations(intentId)` — removes all `intent_indexes` rows for the intent
- `expireOpportunitiesByIntentActor(intentId)` — finds opportunities with the intent in `actors[].intent` (JSONB query) and sets `status = 'expired'`

### Queue cleanup

- Cancel any pending `generate_hyde` or `index_intent` jobs with matching `intentId`
- Jobs already in-flight will check `if (!intent || intent.archivedAt)` and bail (existing guard pattern)

### Event emission

- Add `IntentEvents.onArchived({ intentId, userId })` emission after successful archive
- Brokers that implement `onIntentArchived` will react (future extensibility)

## What stays the same

- `PATCH /intents/:id/archive` endpoint signature and auth guard — unchanged
- `POST /intents/confirm` — unchanged
- `POST /intents/reject` — unchanged
- `IntentProposalCard` countdown/auto-save behavior — unchanged
- `NotificationContext` toast with undo — unchanged (just different API call)

## Edge Cases

- **User closes tab during undo window**: Intent is already created. No undo happens. This is correct — the intent persists.
- **Undo after jobs have started processing**: In-flight jobs check for archived intents and bail. The cascade cleanup cancels any still-queued jobs.
- **Double undo**: `archiveIntent` is idempotent — archiving an already-archived intent is a no-op.
- **Undo after opportunities created**: Opportunities are expired (not deleted), preserving audit trail.
