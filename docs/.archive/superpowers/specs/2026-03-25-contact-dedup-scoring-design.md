# Contact Deduplication Scoring System

**Date:** 2026-03-25
**Branch:** `fix/ghost-name-dedup`
**Status:** Design approved, pending implementation

## Problem

When importing contacts from integrations (Gmail, Slack) or manual input, the same person often appears with multiple email addresses. The previous approach—exact name match dedup—was too aggressive (two real "John Smith"s get merged) and architecturally misplaced (lived inside the service layer).

## Scope

**In scope:**
- Scoring-based duplicate detection during bulk import
- Configurable strategy via environment variable with three presets
- Structured logging of dedup decisions
- Pure-function implementation in shared lib

**Out of scope:**
- Account merging / multi-email linking (separate Linear issue)
- UI for reviewing duplicates
- Retroactive dedup of existing contacts

## Scoring Model

The system computes a duplicate likelihood score between every pair of contacts in an import batch. Two sub-scores are computed independently and **both must pass their thresholds** for a pair to be considered duplicates.

### Name Similarity (Jaro-Winkler, 0.0–1.0)

- Normalize: lowercase, trim, collapse whitespace
- Compare using Jaro-Winkler (favors prefix matches — good for "John" vs "Johnny", "J. Smith" vs "John Smith")

### Email Similarity (Composite, 0.0–1.0)

- Split into local-part and domain
- **Local-part similarity:** Jaro-Winkler on the local-part
- **Domain classification:** Check against hardcoded common-provider list (~20 entries: gmail, outlook, yahoo, hotmail, icloud, etc.)
  - **Common provider:** Domain match contributes 0 — only local-part matters
  - **Custom domain, exact match:** Amplified bonus added — `localScore + domainBonus × (2 − localScore)`, capped at 1.0. The multiplier gives a stronger boost when local-parts are less similar, reflecting the higher signal that a shared custom domain provides. Note: with the aggressive preset (`domainBonus=0.35`), any same-domain pair exceeds the email threshold regardless of local-part similarity.
  - **Custom domain, no match:** No bonus

### Empty/Missing Names

When a contact has no name (empty or whitespace-only), the full email address is used as the name for scoring purposes. This means two nameless contacts will only dedup if their full emails are similar enough — effectively disabling name-based dedup for nameless entries while still allowing the email score to contribute.

### Duplicate Condition

A pair is a duplicate when:

```
nameSimilarity >= nameThreshold AND emailSimilarity >= emailThreshold
```

When a duplicate pair is found, the first contact in import order is kept, the second is skipped.

### Pairwise Complexity

O(N²) comparisons for N contacts. Acceptable for typical import sizes (hundreds to low thousands). If this becomes a bottleneck, bucket by name prefix first.

## Configuration

### Environment Variable: `CONTACT_DEDUP_STRATEGY`

Three presets, each mapping to internal thresholds:

| Preset | `nameThreshold` | `emailThreshold` | Custom domain bonus | Behavior |
|--------|-----------------|-------------------|---------------------|----------|
| `conservative` | 0.92 | 0.85 | +0.25 | Near-exact matches only |
| `balanced` | 0.85 | 0.75 | +0.30 | Catches common variations |
| `aggressive` | 0.78 | 0.65 | +0.35 | Catches looser matches |

Special values:
- `off` — disables dedup entirely (all contacts pass through)
- Omitted / not set — defaults to `conservative`

### Scoring Examples (conservative preset)

| Name A | Email A | Name B | Email B | Name sim | Email sim | Result |
|--------|---------|--------|---------|----------|-----------|--------|
| John Smith | john@gmail.com | John Smith | jsmith@work.com | 1.0 | 0.58 | **Keep both** (email too low) |
| John Smith | john.smith@gmail.com | John Smith | johnsmith@yahoo.com | 1.0 | 0.91 | **Dedup** |
| John Smith | john@smith.dev | J Smith | js@smith.dev | 0.82 | 0.41 + 0.40 = 0.81 | **Keep both** (name too low) |
| Sarah Connor | sarah@connor.io | Sarah Connor | s.connor@connor.io | 1.0 | 0.50 + 0.38 = 0.87 | **Dedup** |

## Architecture

### File Structure

```
protocol/src/lib/dedup/
├── dedup.ts        # Scoring, Jaro-Winkler, common providers, deduplicateContacts
└── dedup.spec.ts   # Unit tests (pure functions, no DB)
```

### Interface

```typescript
interface DedupResult {
  kept: Array<{ email: string; userId: string; isNew: boolean }>;
  removed: Array<{
    email: string;
    userId: string;
    matchedWith: string;      // email of the contact it matched against
    nameScore: number;        // raw Jaro-Winkler score
    emailScore: number;       // final score (local-part similarity + domain bonus if applicable)
  }>;
}

function deduplicateContacts(
  contacts: Array<{ name?: string; email: string }>,
  details: Array<{ email: string; userId: string; isNew: boolean }>,
): DedupResult
```

### Implementation Details

- **Jaro-Winkler:** Pure function (~30 lines), no external dependency
- **Common provider list:** Hardcoded `Set<string>`, ~20 entries, easy to extend
- **Preset loading:** Read `CONTACT_DEDUP_STRATEGY` at module level, map to thresholds

### Call Sites (same two as current implementation)

1. `ContactService.importContacts()` — after `resolveUsers()`, before `upsertContactMembershipBulk()`
2. `IntegrationService.importContacts()` (non-personal index path) — after `resolveUsers()`, before `addMembersBulkToIndex()`

Both call sites log `removed` entries at `info` level for traceability.

### What Changes vs Current

- `deduplicateByName` in `lib/contact.utils.ts` is **replaced** by `deduplicateContacts` in `lib/dedup/dedup.ts`
- `lib/contact.utils.ts` is deleted
- Same position in the flow (after resolve, before membership creation)
- Ghost users are still created for all emails (enrichment still runs) — only membership is deduped
- `ImportResult.skipped` still includes deduped count

## Testing Strategy

### Unit Tests (`lib/dedup/dedup.spec.ts`)

No DB required, fast execution:

1. **Jaro-Winkler correctness** — known string pairs with expected scores (exact match = 1.0, empty string, single char, transpositions)
2. **Domain classification** — common providers return true, custom domains return false
3. **Email scoring** — local-part similarity with/without domain bonus
4. **Name scoring** — case normalization, whitespace handling, prefix matching
5. **Preset loading** — each preset maps to correct thresholds, `off` disables, missing defaults to `conservative`
6. **End-to-end dedup scenarios:**
   - Same name, similar local-parts — deduped
   - Same name, unrelated emails — kept
   - Different names, same email pattern — kept
   - Custom domain bonus tips the score over threshold
   - Empty/missing names — falls back to full email comparison
   - Single contact — no dedup
   - `off` strategy — all contacts pass through

### Integration Tests

Existing tests in `contact.service.spec.ts` are updated to reflect the new function name. Current name-based dedup tests become baseline regression tests.

## Future Work

- **Full duplicate management** — account merging, multi-email linking, UI for reviewing duplicates (to be tracked as a Linear issue)
