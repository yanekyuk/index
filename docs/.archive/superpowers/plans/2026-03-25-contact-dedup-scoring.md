# Contact Dedup Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace exact-name contact dedup with a configurable scoring system using Jaro-Winkler similarity on both name and email fields.

**Architecture:** Pure functions in `protocol/src/lib/dedup/dedup.ts` — Jaro-Winkler, domain classification, email scoring, preset config, and the main `deduplicateContacts` entry point. Call sites in `ContactService` and `IntegrationService` swap the old function for the new one.

**Tech Stack:** TypeScript, Bun test runner, no new dependencies.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `protocol/src/lib/dedup/dedup.ts` | Create | Jaro-Winkler, domain classification, email scoring, name scoring, preset config, `deduplicateContacts` |
| `protocol/src/lib/dedup/dedup.spec.ts` | Create | Unit tests for all pure functions |
| `protocol/src/lib/contact.utils.ts` | Delete | Replaced by `lib/dedup/dedup.ts` |
| `protocol/src/services/contact.service.ts` | Modify (lines 1-4, 256-258) | Update import, swap `deduplicateByName` → `deduplicateContacts`, log removals |
| `protocol/src/services/integration.service.ts` | Modify (lines 5-6, 89-92) | Update import, swap function, log removals |
| `protocol/src/services/tests/contact.service.spec.ts` | Modify (lines 21, 23-107) | Remove old `deduplicateByName` unit tests, update integration test assertions |
| `protocol/.env.example` | Modify (append) | Add `CONTACT_DEDUP_STRATEGY` with docs |

---

### Task 1: Jaro-Winkler Implementation

**Files:**
- Create: `protocol/src/lib/dedup/dedup.ts`
- Create: `protocol/src/lib/dedup/dedup.spec.ts`

- [ ] **Step 1: Write failing tests for Jaro-Winkler**

In `protocol/src/lib/dedup/dedup.spec.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { jaroWinkler } from './dedup';

describe('jaroWinkler', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaroWinkler('hello', 'hello')).toBe(1.0);
  });

  it('returns 0.0 when both strings are empty', () => {
    expect(jaroWinkler('', '')).toBe(0.0);
  });

  it('returns 0.0 when one string is empty', () => {
    expect(jaroWinkler('hello', '')).toBe(0.0);
    expect(jaroWinkler('', 'hello')).toBe(0.0);
  });

  it('scores prefix-sharing strings higher (Winkler boost)', () => {
    const score = jaroWinkler('john', 'johnny');
    expect(score).toBeGreaterThan(0.85);
  });

  it('handles transpositions', () => {
    const score = jaroWinkler('martha', 'marhta');
    expect(score).toBeGreaterThan(0.95);
  });

  it('scores completely different strings low', () => {
    const score = jaroWinkler('abc', 'xyz');
    expect(score).toBeLessThan(0.5);
  });

  it('is case-sensitive (caller normalizes)', () => {
    const lower = jaroWinkler('john', 'john');
    const mixed = jaroWinkler('John', 'john');
    expect(lower).toBeGreaterThan(mixed);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd protocol && bun test src/lib/dedup/dedup.spec.ts`
Expected: FAIL — `jaroWinkler` not found

- [ ] **Step 3: Implement Jaro-Winkler**

In `protocol/src/lib/dedup/dedup.ts`:

```typescript
/**
 * Jaro-Winkler string similarity score (0.0–1.0).
 * Higher scores indicate greater similarity. Favors prefix matches.
 *
 * @param s1 - First string
 * @param s2 - Second string
 * @returns Similarity score between 0.0 and 1.0
 */
export function jaroWinkler(s1: string, s2: string): number {
  if (s1.length === 0 || s2.length === 0) return 0.0;
  if (s1 === s2) return 1.0;

  const maxDist = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(i + maxDist + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;

  // Winkler boost: up to 4 shared prefix characters
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd protocol && bun test src/lib/dedup/dedup.spec.ts`
Expected: 7 PASS

- [ ] **Step 5: Commit**

```bash
git add protocol/src/lib/dedup/dedup.ts protocol/src/lib/dedup/dedup.spec.ts
git commit -m "feat(dedup): add Jaro-Winkler string similarity function with tests"
```

---

### Task 2: Domain Classification & Email Scoring

**Files:**
- Modify: `protocol/src/lib/dedup/dedup.ts`
- Modify: `protocol/src/lib/dedup/dedup.spec.ts`

- [ ] **Step 1: Write failing tests for domain classification and email scoring**

Append to `protocol/src/lib/dedup/dedup.spec.ts`:

```typescript
import { isCommonProvider, emailSimilarity } from './dedup';

describe('isCommonProvider', () => {
  it('recognizes gmail.com', () => {
    expect(isCommonProvider('gmail.com')).toBe(true);
  });

  it('recognizes outlook.com', () => {
    expect(isCommonProvider('outlook.com')).toBe(true);
  });

  it('rejects custom domains', () => {
    expect(isCommonProvider('smith.dev')).toBe(false);
    expect(isCommonProvider('acme.com')).toBe(false);
  });
});

describe('emailSimilarity', () => {
  it('scores identical emails as 1.0', () => {
    expect(emailSimilarity('john@gmail.com', 'john@gmail.com', 0.25)).toBe(1.0);
  });

  it('scores only local-part for common providers', () => {
    const score = emailSimilarity('john.smith@gmail.com', 'johnsmith@yahoo.com', 0.25);
    // Domain mismatch ignored (both common), only local-part Jaro-Winkler
    expect(score).toBeGreaterThan(0.8);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('adds domain bonus for matching custom domains', () => {
    const withBonus = emailSimilarity('sarah@connor.io', 's.connor@connor.io', 0.25);
    const withoutBonus = emailSimilarity('sarah@connor.io', 's.connor@other.io', 0.25);
    expect(withBonus).toBeGreaterThan(withoutBonus);
  });

  it('caps score at 1.0 after domain bonus', () => {
    const score = emailSimilarity('john@smith.dev', 'john@smith.dev', 0.25);
    expect(score).toBe(1.0);
  });

  it('gives no domain bonus when custom domains differ', () => {
    const score = emailSimilarity('john@smith.dev', 'john@doe.io', 0.25);
    // Same local-part, different custom domains — no bonus
    const localOnly = emailSimilarity('john@gmail.com', 'john@yahoo.com', 0.25);
    expect(score).toBeCloseTo(localOnly, 2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd protocol && bun test src/lib/dedup/dedup.spec.ts`
Expected: FAIL — `isCommonProvider` and `emailSimilarity` not found

- [ ] **Step 3: Implement domain classification and email scoring**

Append to `protocol/src/lib/dedup/dedup.ts`:

```typescript
/** Common email providers where domain match is meaningless. */
const COMMON_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com',
  'proton.me', 'protonmail.com',
  'zoho.com',
  'mail.com',
  'gmx.com', 'gmx.net',
  'fastmail.com',
  'tutanota.com', 'tuta.io',
  'yandex.com', 'yandex.ru',
]);

/**
 * Checks if an email domain is a common provider (domain match is meaningless).
 *
 * @param domain - Lowercase email domain
 * @returns True if the domain is a common email provider
 */
export function isCommonProvider(domain: string): boolean {
  return COMMON_PROVIDERS.has(domain);
}

/**
 * Computes email similarity by comparing local-parts with Jaro-Winkler,
 * then adding a domain bonus for matching custom domains.
 *
 * @param email1 - First email (lowercase)
 * @param email2 - Second email (lowercase)
 * @param domainBonus - Bonus to add when custom domains match
 * @returns Similarity score between 0.0 and 1.0
 */
export function emailSimilarity(email1: string, email2: string, domainBonus: number): number {
  const [local1, domain1] = email1.split('@');
  const [local2, domain2] = email2.split('@');

  const localScore = jaroWinkler(local1, local2);

  const bothCommon = isCommonProvider(domain1) && isCommonProvider(domain2);
  const customMatch = !bothCommon && !isCommonProvider(domain1) && !isCommonProvider(domain2) && domain1 === domain2;

  const bonus = customMatch ? domainBonus : 0;
  return Math.min(1.0, localScore + bonus);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd protocol && bun test src/lib/dedup/dedup.spec.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add protocol/src/lib/dedup/dedup.ts protocol/src/lib/dedup/dedup.spec.ts
git commit -m "feat(dedup): add domain classification and email similarity scoring"
```

---

### Task 3: Preset Configuration

**Files:**
- Modify: `protocol/src/lib/dedup/dedup.ts`
- Modify: `protocol/src/lib/dedup/dedup.spec.ts`
- Modify: `protocol/.env.example`

- [ ] **Step 1: Write failing tests for presets**

Append to `protocol/src/lib/dedup/dedup.spec.ts`:

```typescript
import { getPreset, type DedupPreset } from './dedup';

describe('getPreset', () => {
  it('returns conservative thresholds by default', () => {
    const preset = getPreset(undefined);
    expect(preset).toEqual({
      nameThreshold: 0.92,
      emailThreshold: 0.85,
      domainBonus: 0.25,
    });
  });

  it('returns null for "off"', () => {
    expect(getPreset('off')).toBeNull();
  });

  it('returns conservative preset', () => {
    const preset = getPreset('conservative');
    expect(preset?.nameThreshold).toBe(0.92);
  });

  it('returns balanced preset', () => {
    const preset = getPreset('balanced');
    expect(preset?.nameThreshold).toBe(0.85);
    expect(preset?.emailThreshold).toBe(0.75);
    expect(preset?.domainBonus).toBe(0.30);
  });

  it('returns aggressive preset', () => {
    const preset = getPreset('aggressive');
    expect(preset?.nameThreshold).toBe(0.78);
    expect(preset?.emailThreshold).toBe(0.65);
    expect(preset?.domainBonus).toBe(0.35);
  });

  it('defaults to conservative for unknown values', () => {
    const preset = getPreset('invalid');
    expect(preset?.nameThreshold).toBe(0.92);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd protocol && bun test src/lib/dedup/dedup.spec.ts`
Expected: FAIL — `getPreset` not found

- [ ] **Step 3: Implement preset configuration**

Append to `protocol/src/lib/dedup/dedup.ts`:

```typescript
/** Threshold configuration for a dedup preset. */
export interface DedupPreset {
  nameThreshold: number;
  emailThreshold: number;
  domainBonus: number;
}

const PRESETS: Record<string, DedupPreset> = {
  conservative: { nameThreshold: 0.92, emailThreshold: 0.85, domainBonus: 0.25 },
  balanced:     { nameThreshold: 0.85, emailThreshold: 0.75, domainBonus: 0.30 },
  aggressive:   { nameThreshold: 0.78, emailThreshold: 0.65, domainBonus: 0.35 },
};

/**
 * Resolves a strategy string to a preset, or null if dedup is disabled.
 *
 * @param strategy - Environment variable value (conservative|balanced|aggressive|off)
 * @returns Preset thresholds, or null if strategy is "off"
 */
export function getPreset(strategy: string | undefined): DedupPreset | null {
  if (strategy === 'off') return null;
  return PRESETS[strategy ?? ''] ?? PRESETS.conservative;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd protocol && bun test src/lib/dedup/dedup.spec.ts`
Expected: All PASS

- [ ] **Step 5: Add env variable to .env.example**

Append to `protocol/.env.example`:

```bash

########################################
# 10. Contact Dedup
########################################

# Deduplication strategy for bulk contact imports.
# Determines how aggressively the system merges contacts with similar names/emails.
#   conservative — near-exact matches only (default)
#   balanced     — catches common name/email variations
#   aggressive   — catches looser matches, higher false-positive risk
#   off          — disable dedup entirely
# CONTACT_DEDUP_STRATEGY=conservative
```

- [ ] **Step 6: Commit**

```bash
git add protocol/src/lib/dedup/dedup.ts protocol/src/lib/dedup/dedup.spec.ts protocol/.env.example
git commit -m "feat(dedup): add configurable preset system with env variable"
```

---

### Task 4: Main `deduplicateContacts` Function

**Files:**
- Modify: `protocol/src/lib/dedup/dedup.ts`
- Modify: `protocol/src/lib/dedup/dedup.spec.ts`

- [ ] **Step 1: Write failing tests for deduplicateContacts**

Append to `protocol/src/lib/dedup/dedup.spec.ts`:

```typescript
import { deduplicateContacts, type DedupResult } from './dedup';

describe('deduplicateContacts', () => {
  const preset = { nameThreshold: 0.92, emailThreshold: 0.85, domainBonus: 0.25 };

  it('keeps all contacts when names differ', () => {
    const contacts = [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
    ];
    const details = [
      { email: 'alice@test.com', userId: 'u1', isNew: true },
      { email: 'bob@test.com', userId: 'u2', isNew: true },
    ];
    const result = deduplicateContacts(contacts, details, preset);
    expect(result.kept).toEqual(details);
    expect(result.removed).toEqual([]);
  });

  it('deduplicates when name and email both score above thresholds', () => {
    const contacts = [
      { name: 'John Smith', email: 'john.smith@gmail.com' },
      { name: 'John Smith', email: 'johnsmith@yahoo.com' },
    ];
    const details = [
      { email: 'john.smith@gmail.com', userId: 'u1', isNew: true },
      { email: 'johnsmith@yahoo.com', userId: 'u2', isNew: true },
    ];
    const result = deduplicateContacts(contacts, details, preset);
    expect(result.kept.length).toBe(1);
    expect(result.kept[0].email).toBe('john.smith@gmail.com');
    expect(result.removed.length).toBe(1);
    expect(result.removed[0].matchedWith).toBe('john.smith@gmail.com');
  });

  it('keeps both when name matches but email scores too low', () => {
    const contacts = [
      { name: 'John Smith', email: 'john@gmail.com' },
      { name: 'John Smith', email: 'jsmith@work.com' },
    ];
    const details = [
      { email: 'john@gmail.com', userId: 'u1', isNew: true },
      { email: 'jsmith@work.com', userId: 'u2', isNew: true },
    ];
    const result = deduplicateContacts(contacts, details, preset);
    expect(result.kept.length).toBe(2);
    expect(result.removed.length).toBe(0);
  });

  it('applies domain bonus for matching custom domains', () => {
    const contacts = [
      { name: 'Sarah Connor', email: 'sarah@connor.io' },
      { name: 'Sarah Connor', email: 's.connor@connor.io' },
    ];
    const details = [
      { email: 'sarah@connor.io', userId: 'u1', isNew: true },
      { email: 's.connor@connor.io', userId: 'u2', isNew: true },
    ];
    const result = deduplicateContacts(contacts, details, preset);
    expect(result.kept.length).toBe(1);
    expect(result.removed.length).toBe(1);
  });

  it('uses full email as name when name is empty', () => {
    const contacts = [
      { name: '', email: 'sam@gmail.com' },
      { name: '', email: 'sam@company.com' },
    ];
    const details = [
      { email: 'sam@gmail.com', userId: 'u1', isNew: true },
      { email: 'sam@company.com', userId: 'u2', isNew: true },
    ];
    const result = deduplicateContacts(contacts, details, preset);
    // Full emails as names: "sam@gmail.com" vs "sam@company.com" — low name similarity
    expect(result.kept.length).toBe(2);
  });

  it('returns all contacts when preset is null (off)', () => {
    const contacts = [
      { name: 'John Smith', email: 'john.smith@gmail.com' },
      { name: 'John Smith', email: 'johnsmith@yahoo.com' },
    ];
    const details = [
      { email: 'john.smith@gmail.com', userId: 'u1', isNew: true },
      { email: 'johnsmith@yahoo.com', userId: 'u2', isNew: true },
    ];
    const result = deduplicateContacts(contacts, details, null);
    expect(result.kept).toEqual(details);
    expect(result.removed).toEqual([]);
  });

  it('handles single contact without error', () => {
    const contacts = [{ name: 'Alice', email: 'alice@test.com' }];
    const details = [{ email: 'alice@test.com', userId: 'u1', isNew: true }];
    const result = deduplicateContacts(contacts, details, preset);
    expect(result.kept).toEqual(details);
    expect(result.removed).toEqual([]);
  });

  it('handles empty input', () => {
    const result = deduplicateContacts([], [], preset);
    expect(result.kept).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('removed entries include scores', () => {
    const contacts = [
      { name: 'John Smith', email: 'john.smith@gmail.com' },
      { name: 'John Smith', email: 'johnsmith@yahoo.com' },
    ];
    const details = [
      { email: 'john.smith@gmail.com', userId: 'u1', isNew: true },
      { email: 'johnsmith@yahoo.com', userId: 'u2', isNew: true },
    ];
    const result = deduplicateContacts(contacts, details, preset);
    if (result.removed.length > 0) {
      const removed = result.removed[0];
      expect(removed.nameScore).toBeGreaterThan(0);
      expect(removed.emailScore).toBeGreaterThan(0);
      expect(typeof removed.nameScore).toBe('number');
      expect(typeof removed.emailScore).toBe('number');
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd protocol && bun test src/lib/dedup/dedup.spec.ts`
Expected: FAIL — `deduplicateContacts` not found

- [ ] **Step 3: Implement deduplicateContacts**

Append to `protocol/src/lib/dedup/dedup.ts`:

```typescript
/** Result of contact deduplication. */
export interface DedupResult {
  kept: Array<{ email: string; userId: string; isNew: boolean }>;
  removed: Array<{
    email: string;
    userId: string;
    matchedWith: string;
    nameScore: number;
    emailScore: number;
  }>;
}

/**
 * Deduplicates resolved contact details using name + email similarity scoring.
 * Both name and email must independently pass their thresholds for a pair to
 * be considered duplicates. First contact in import order is kept.
 *
 * @param contacts - Original import input (provides name-to-email mapping)
 * @param details - Resolved details from resolveUsers (email, userId, isNew)
 * @param preset - Threshold config, or null to disable dedup
 * @returns Kept and removed contacts with scores for removed entries
 */
export function deduplicateContacts(
  contacts: Array<{ name?: string; email: string }>,
  details: Array<{ email: string; userId: string; isNew: boolean }>,
  preset: DedupPreset | null,
): DedupResult {
  if (!preset || details.length <= 1) {
    return { kept: [...details], removed: [] };
  }

  // Build email → normalized name map
  const emailToName = new Map<string, string>();
  for (const c of contacts) {
    const email = c.email.toLowerCase().trim();
    if (!emailToName.has(email)) {
      const name = c.name?.trim();
      emailToName.set(email, name ? name.toLowerCase().replace(/\s+/g, ' ') : email);
    }
  }

  const kept: DedupResult['kept'] = [];
  const removed: DedupResult['removed'] = [];
  const removedIndexes = new Set<number>();

  for (let i = 0; i < details.length; i++) {
    if (removedIndexes.has(i)) continue;

    kept.push(details[i]);
    const nameI = emailToName.get(details[i].email) ?? details[i].email;
    const emailI = details[i].email;

    for (let j = i + 1; j < details.length; j++) {
      if (removedIndexes.has(j)) continue;

      const nameJ = emailToName.get(details[j].email) ?? details[j].email;
      const emailJ = details[j].email;

      const nameScore = jaroWinkler(nameI, nameJ);
      if (nameScore < preset.nameThreshold) continue;

      const eScore = emailSimilarity(emailI, emailJ, preset.domainBonus);
      if (eScore < preset.emailThreshold) continue;

      removedIndexes.add(j);
      removed.push({
        email: details[j].email,
        userId: details[j].userId,
        matchedWith: details[i].email,
        nameScore,
        emailScore: eScore,
      });
    }
  }

  return { kept, removed };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd protocol && bun test src/lib/dedup/dedup.spec.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add protocol/src/lib/dedup/dedup.ts protocol/src/lib/dedup/dedup.spec.ts
git commit -m "feat(dedup): add deduplicateContacts with pairwise scoring"
```

---

### Task 5: Wire Into Call Sites & Clean Up

**Files:**
- Delete: `protocol/src/lib/contact.utils.ts`
- Modify: `protocol/src/services/contact.service.ts` (lines 1-4, 256-278)
- Modify: `protocol/src/services/integration.service.ts` (lines 5-6, 89-102)
- Modify: `protocol/src/services/tests/contact.service.spec.ts` (lines 21, 23-107)

- [ ] **Step 1: Update ContactService import and call site**

In `protocol/src/services/contact.service.ts`:

Replace the import:
```typescript
// Old
import { deduplicateByName } from '../lib/contact.utils';

// New
import { deduplicateContacts, getPreset } from '../lib/dedup/dedup';
```

Replace the dedup block (around line 256):
```typescript
// Old
const dedupedDetails = deduplicateByName(contacts, resolved.details);
const dedupedUserIds = dedupedDetails.map(d => d.userId);
const nameSkipped = resolved.details.length - dedupedDetails.length;

// New
const preset = getPreset(process.env.CONTACT_DEDUP_STRATEGY);
const dedupResult = deduplicateContacts(contacts, resolved.details, preset);
const dedupedUserIds = dedupResult.kept.map(d => d.userId);
const nameSkipped = dedupResult.removed.length;

if (dedupResult.removed.length > 0) {
  logger.info('[ContactService] Dedup removed contacts', {
    ownerId,
    removed: dedupResult.removed.map(r => ({
      email: r.email,
      matchedWith: r.matchedWith,
      nameScore: r.nameScore.toFixed(3),
      emailScore: r.emailScore.toFixed(3),
    })),
  });
}
```

Also update `resolved.details` → `dedupResult.kept` in the count and return:
```typescript
const newCount = dedupResult.kept.filter(d => d.isNew).length;
const result: ImportResult = {
  imported: dedupedUserIds.length,
  skipped: resolved.skipped + nameSkipped,
  newContacts: newCount,
  existingContacts: dedupedUserIds.length - newCount,
  details: dedupResult.kept,
};
```

- [ ] **Step 2: Update IntegrationService import and call site**

In `protocol/src/services/integration.service.ts`:

Replace the import:
```typescript
// Old
import { deduplicateByName } from '../lib/contact.utils';

// New
import { deduplicateContacts, getPreset } from '../lib/dedup/dedup';
```

Replace the dedup block (around line 89):
```typescript
// Old
const dedupedDetails = deduplicateByName(contacts, resolved.details);
const dedupedUserIds = dedupedDetails.map(d => d.userId);
const nameSkipped = resolved.details.length - dedupedDetails.length;

// New
const preset = getPreset(process.env.CONTACT_DEDUP_STRATEGY);
const dedupResult = deduplicateContacts(contacts, resolved.details, preset);
const dedupedUserIds = dedupResult.kept.map(d => d.userId);
const nameSkipped = dedupResult.removed.length;

if (dedupResult.removed.length > 0) {
  logger.info('[IntegrationService] Dedup removed contacts', {
    removed: dedupResult.removed.map(r => ({
      email: r.email,
      matchedWith: r.matchedWith,
      nameScore: r.nameScore.toFixed(3),
      emailScore: r.emailScore.toFixed(3),
    })),
  });
}
```

Also update the return:
```typescript
const newCount = dedupResult.kept.filter(d => d.isNew).length;
return {
  imported: dedupedUserIds.length,
  skipped: resolved.skipped + nameSkipped,
  newContacts: newCount,
  existingContacts: dedupedUserIds.length - newCount,
  details: dedupResult.kept,
};
```

- [ ] **Step 3: Delete old contact.utils.ts**

```bash
rm protocol/src/lib/contact.utils.ts
```

- [ ] **Step 4: Update test file — remove old unit tests, fix import**

In `protocol/src/services/tests/contact.service.spec.ts`:

Remove the import of `deduplicateByName`:
```typescript
// Old
import { deduplicateByName } from '../../lib/contact.utils';

// Delete this line entirely
```

Remove the entire `describe('deduplicateByName (unit)', ...)` block (lines 23-107). These tests are superseded by `dedup.spec.ts`.

The integration tests (`describe('importContacts — name dedup', ...)`) should stay but will now exercise the scoring-based dedup. Their assertions may need minor adjustments — the scoring system may keep or skip different contacts than exact-name matching did. Review each test:
- "deduplicates same-name contacts with different emails" — may now keep both if email similarity is below threshold. Update assertion to match new behavior.
- "deduplicates names case-insensitively" — same consideration.
- "does not merge contacts with different names" — should still pass unchanged.
- "does not merge nameless contacts with different email local-parts" — should still pass unchanged.
- "does not merge nameless contacts with same local-part but different domains" — should still pass unchanged.

- [ ] **Step 5: Run all affected tests**

Run: `cd protocol && bun test src/lib/dedup/dedup.spec.ts src/services/tests/contact.service.spec.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add -u && git add protocol/src/lib/dedup/
git commit -m "refactor(dedup): wire scoring system into import paths, remove old name dedup"
```

---

### Task 6: Verify & Final Check

- [ ] **Step 1: Run full dedup test suite**

Run: `cd protocol && bun test src/lib/dedup/dedup.spec.ts`
Expected: All PASS

- [ ] **Step 2: Run contact service tests**

Run: `cd protocol && bun test src/services/tests/contact.service.spec.ts`
Expected: All PASS

- [ ] **Step 3: Verify no references to old module remain**

Run: `cd protocol && grep -r "contact.utils" src/`
Expected: No matches

Run: `cd protocol && grep -r "deduplicateByName" src/`
Expected: No matches

- [ ] **Step 4: Verify env variable is documented**

Run: `grep "CONTACT_DEDUP_STRATEGY" protocol/.env.example`
Expected: Shows the variable with comment
