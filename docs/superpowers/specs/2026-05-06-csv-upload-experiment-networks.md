# CSV Upload for Experiment Networks

**Date:** 2026-05-06  
**Status:** Approved

## Overview

Allow owners of experiment networks to bulk-import members from a CSV file via the network settings page. Each row can carry email, name, bio, and any number of social links. Existing members are upserted rather than duplicated. The feature is restricted to experiment networks only.

## CSV Schema

Headers are case-insensitive. Column order is irrelevant. Unknown columns are treated as custom socials.

| Column | Required | Behaviour |
|--------|----------|-----------|
| `email` | Yes | Normalized to lowercase + trim. Invalid format → row skipped. |
| `name` | No | Falls back to email prefix if absent. |
| `bio` | No | Maps to `userProfiles.identity.bio`. Empty cell = no change on upsert. |
| `linkedin` | No | Stored as `userSocials` row with label `linkedin`. |
| `github` | No | Stored as `userSocials` row with label `github`. |
| `twitter` | No | Stored as `userSocials` row with label `twitter`. |
| any other column | No | Stored as `userSocials` row with the column name as label. |

Empty cells are treated as absent — they do not blank out existing values on upsert. A non-empty value always overwrites.

Known social labels (`linkedin`, `github`, `twitter`, `telegram`) render with their respective icons in the profile UI. All other column names are stored with the column name as label and appear in the custom socials section.

## Architecture & Data Flow

```
[Access Tab — experiment networks only]
    │
    ├─ File picker (CSV only, 10MB max via existing validateFile())
    │
    ├─ rows ≤ 500?
    │     YES → PapaParse client-side → ImportRow[]
    │     NO  → POST /networks/:id/members/import/parse (multipart) → ImportRow[]
    │
    ├─ Preview modal
    │     • Valid rows: normal
    │     • Invalid rows: highlighted red + inline reason
    │     • Summary: "X will be imported · Y skipped"
    │     • "Confirm import" CTA (disabled if 0 valid rows)
    │
    └─ Confirm → POST /networks/:id/members/import
                  body: { members: ImportRow[] }
                  → ExperimentService.importMembers(networkId, rows)
                       ├─ signup(email) per row (upserts user + membership)
                       ├─ update userProfiles.identity.bio if present
                       └─ upsert userSocials rows per social column
                  → { imported: number, skipped: number }
                  → success toast
```

## Backend

### New endpoints

**`POST /networks/:id/members/import/parse`**
- Auth: network owner/admin + network must be `isExperiment = true`
- Body: `multipart/form-data` with CSV file
- Returns: `{ valid: ImportRow[], invalid: { row: RawRow, reason: string }[] }`
- Used only for the large-file path (rows > 500)

**`POST /networks/:id/members/import`**
- Auth: network owner/admin + network must be `isExperiment = true`
- Body: `{ members: ImportRow[] }`
- Calls `ExperimentService.importMembers(networkId, rows)`
- Returns: `{ imported: number, skipped: number }`

Both endpoints return 403 if the network is not an experiment network.

### `ExperimentService.importMembers(networkId, rows)`

For each valid row:
1. `signup(email)` — upserts user + experiment network membership (existing method)
2. Update `userProfiles.identity.bio` if `bio` is present
3. Upsert `userSocials` rows for each social column

Rows where `signup()` fails (e.g. invalid email that slipped through) are counted as skipped.

### Types

```ts
type ImportRow = {
  email: string
  name?: string
  bio?: string
  socials: { label: string; value: string }[]
}
```

## Frontend

### Components

**`CsvImportButton`** — small component rendered in the access tab only when `network.isExperiment === true`. Triggers a hidden `<input type="file" accept=".csv">`. On file select: validates via existing `validateFile()`, branches on row count threshold (500), produces `ImportRow[]`, opens `CsvPreviewModal`.

**`CsvPreviewModal`** — modal showing:
- Table with columns dynamically derived from the CSV (only columns present are shown)
- Invalid rows highlighted red with inline reason
- Summary bar: "X will be imported · Y skipped"
- "Confirm import" CTA (disabled if 0 valid rows) + "Cancel"

**Placement:** "Import CSV" button placed alongside the existing "Add by email" flow in the access tab of `NetworkSettingsPanel.tsx`.

## Error Handling

| Scenario | Behaviour |
|---|---|
| File is not CSV or exceeds 10MB | Rejected by `validateFile()`, inline error under button |
| CSV has no `email` column | File-level error in modal: "CSV must have an email column", confirm blocked |
| Row has empty or malformed email | Row highlighted red with reason, skipped on import |
| All rows invalid | Confirm disabled, summary shows "0 will be imported" |
| Backend parse fails (large file path) | Toast error, modal closes, user can retry |
| Import endpoint error | Toast error, modal stays open so user does not lose their selection |
| Email already a member | Upserted silently, counted as "imported" (not "skipped") |

## Testing

### Backend (integration tests in `backend/tests/`)
- Import creates ghost users, upserts profiles and socials, adds memberships
- Re-importing an existing member updates bio/socials without duplicating membership
- Non-experiment network returns 403
- Non-owner returns 403
- Parse endpoint returns correct `ImportRow[]` for a valid CSV

### Frontend (unit tests)
- CSV parser util: known columns mapped correctly, unknown columns → custom socials, empty email → invalid row, case-insensitive headers
- `CsvImportButton` not rendered for non-experiment networks
