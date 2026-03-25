# Optimization Changes

Search limits, scoring rules, and discovery improvements.

## Overview

Expand candidate pool for discovery, improve evaluator structure, increase output limits.

## Search Limits

### Embedder Adapter

**File:** `protocol/src/adapters/embedder.adapter.ts`

| Parameter | Before | After |
|-----------|--------|-------|
| `limitPerStrategy` | 10 | 40 |
| `limit` | 20 | 80 |
| `minScore` | 0.5 | 0.30 |

Additional changes:
- **Fix search target:** `searchProfilesForHyde` now searches `userProfiles.embedding` (was incorrectly searching `hydeDocuments`)
- **Overfetch/dedupe:** Add `OVERFETCH_MULTIPLIER` and `MAX_OVERFETCH_ROWS` to handle duplicates from `indexMembers` join

### Opportunity Graph

**File:** `protocol/src/lib/protocol/graphs/opportunity.graph.ts`

| Parameter | Before | After |
|-----------|--------|-------|
| `limitPerStrategy` | 10 | 40 |
| `perIndexLimit` | 20 | 80 |
| `minScore` | 0.5 | 0.30 |
| Default output limit | 10 | 20 |
| Evaluation cap | none | 50 candidates |

Additional changes:
- **HyDE routing:** When `searchQuery` exists, always run query-based HyDE discovery even if profile embedding exists; merge results
- **Candidate cap:** Sort by similarity, take top 50 for LLM evaluation to avoid timeout

## Scoring Rules

### Evaluator Prompt

**File:** `protocol/src/lib/protocol/agents/opportunity.evaluator.ts`

**Score bands:**
- 90-100: Must Meet
- 70-89: Should Meet
- 50-69: Worth Considering
- <50: Weak match

**Structural rules:**
1. ONE OPPORTUNITY PER CANDIDATE — No multi-candidate synthesis
2. INDIVIDUAL REASONING — Each candidate gets specific reasoning, no mentioning other candidates

## Routing

### Chat Prompt

**File:** `protocol/src/lib/protocol/agents/chat.prompt.ts`

Discovery-first routing:
```text
DO NOT create an intent first. Discovery comes FIRST.
Phrases: "looking for X", "find me X", "I need X" → create_opportunities
```

## Output Limits

### Opportunity Tools

**File:** `protocol/src/lib/protocol/tools/opportunity.tools.ts`

| Parameter | Before | After |
|-----------|--------|-------|
| Discovery `limit` | 5 | 20 |

## Existing Connections

### Discover Support

**File:** `protocol/src/lib/protocol/support/opportunity.discover.ts`

- `EXISTING_CONNECTION_CARD_STATUSES`: Add `'pending'` (was `['draft', 'latent']`)
- Fetch full opportunity data for existing connections with card-eligible status
- Merge existing opportunities with newly created for display

## Summary

| Area | Change |
|------|--------|
| Search pool | 4x larger (40/strategy, 80/index) |
| Similarity threshold | 0.5 → 0.30 |
| Output limit | 5 → 20 cards |
| Evaluator | One opp per candidate, individual reasoning |
| Routing | Discovery-first for "find X" queries |
| Existing opps | Show pending status as cards |
