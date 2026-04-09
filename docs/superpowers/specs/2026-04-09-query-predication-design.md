# Query Predication Classification — Design Spec

**Goal:** Ensure the opportunity evaluator and negotiator correctly handle identity/role queries by classifying query type before scoring and threading the original search query to the negotiation agent.

**Architecture:** Prompt-level changes to the evaluator and negotiator agents, plus a data-threading change to pass `discoveryQuery` from the opportunity graph through to the negotiation graph.

**Tech Stack:** LangChain/LangGraph agents, Zod schemas, TypeScript

---

## Problem Statement

When a user searches for an identity term like "samurai" or "investors", the system should find people who **ARE** that thing — not people who are tangentially associated with the concept. Two failures were observed:

1. **Evaluator**: Scored a character design artist at 75/100 for "samurai" because the artist's work involves character design (topical association). The evaluator treated the query as a topic search, not an identity search.

2. **Negotiator**: Accepted the weak match because it had no visibility into the original search query. It only saw background intents ("Connect with visual artists") and the evaluator's hedging reasoning, which was enough to justify a connection.

## Linguistic Framework

The fix is grounded in predication type theory — different query types assert different semantic relations between the sought person and the query term.

### Query Types

**IDENTITY/ROLE** (`IS-A` predicate): The query term is a count noun / sortal that serves as a predicate nominal. "X IS A samurai" is grammatical and meaningful. The user wants someone who falls within the extension of the kind. Subject-matter contact is not identity — a character designer who draws samurai IS NOT a samurai; an engineer who raised funding IS NOT an investor.

**TOPICAL/DOMAIN** (`WORKS-IN` predicate): The query term is a field or abstract topic. "X IS A machine learning" is ungrammatical — it only works as "X works IN machine learning." Gradient scoring is appropriate; hyponymic satisfaction is allowed (deep learning satisfies machine learning).

**NEED/CAPABILITY** (`CAN-DO` predicate): The query contains a purposive frame — "someone to help with X", "need a Y". Scoring requires both capability match and availability.

### Felicity Conditions for Identity Queries

A match for an identity query is felicitous only when:

- **Propositional content**: The matched person's primary professional identity or self-description places them within the extension of the query term.
- **Sincerity**: The identity claim is primary and stable — not a metaphor, not creative subject matter, not a peripheral reference.
- **Essential**: The match presents the person AS an instance of the query term.

### Query Priority over Background Intents

When an explicit search query coexists with stored background intents, the query takes pragmatic priority (Gricean Maxim of Relation: the most recent, most intentional communicative act is maximally relevant). Background intents serve only as tiebreakers among candidates that satisfy the query.

## Changes

### 1. Evaluator Prompt — Query Type Classification Gate

**File:** `packages/protocol/src/opportunity/opportunity.evaluator.ts`

The `CRITICAL SCORING RULES FOR DISCOVERY REQUESTS` section is rewritten to:

1. Classify the query as IDENTITY/ROLE, TOPICAL/DOMAIN, or NEED/CAPABILITY using a grammatical test (`"X IS A [query]"` grammaticality).
2. Apply type-specific scoring:
   - **IDENTITY/ROLE**: Binary IS-A gate first. Pass (IS-A = true) → score 75-100. Fail → score ≤35 hard ceiling. No partial credit for adjacency.
   - **TOPICAL/DOMAIN**: Gradient 0-100 based on engagement depth.
   - **NEED/CAPABILITY**: Capability + availability scoring.
3. Explicit rule: background intents cannot rescue a failed IS-A judgment.

Existing rules (same-side check, location enforcement) are preserved and renumbered.

### 2. Negotiator — Discovery Query Threading

**Data path:** `opportunity.graph.ts` → `NegotiationCandidate.discoveryQuery` → `negotiateCandidates()` → `NegotiationGraphState.discoveryQuery` → `NegotiationTurnPayload.discoveryQuery` → `IndexNegotiator.invoke()`

**Files changed:**

| File | Change |
|------|--------|
| `shared/interfaces/agent-dispatcher.interface.ts` | Add `discoveryQuery?: string` to `NegotiationTurnPayload` |
| `negotiation/negotiation.state.ts` | Add `discoveryQuery` to `NegotiationGraphState` and `NegotiationGraphLike` |
| `negotiation/negotiation.agent.ts` | Add `discoveryQuery?: string` to `NegotiationAgentInput`; add query priority prompt section |
| `negotiation/negotiation.graph.ts` | Add `discoveryQuery?: string` to `NegotiationCandidate`; thread through `negotiateCandidates()` and `turnNode` |
| `opportunity/opportunity.graph.ts` | Pass `state.searchQuery` as `discoveryQuery` when constructing `NegotiationCandidate` |

### 3. Negotiator Prompt — Query Priority Rule

**File:** `packages/protocol/src/negotiation/negotiation.agent.ts`

When `discoveryQuery` is present:

- **System prompt** includes a `QUERY PRIORITY RULE` section that instructs the agent to evaluate the other user against the query first, applying IS-A logic for identity terms.
- **User message** labels the discoverer's intents as "Background intents (secondary to discovery query)" instead of "Intents".
- **Reminder** at the end of the user message reinforces the query check.

When `discoveryQuery` is absent (background discovery), behavior is unchanged — standard intent-based matching.

## What This Does NOT Change

- **Search/HyDE pipeline**: Candidate retrieval is unchanged. Broad retrieval is still correct — we want to find candidates that might match, then let the evaluator apply strict criteria.
- **Background discovery** (no search query): Evaluator and negotiator behave exactly as before. Gradient scoring, intent-based matching.
- **Existing scoring rules**: Same-side check, location enforcement, substitutive/complementary role analysis all preserved.
- **Pairwise evaluator** (`systemPrompt`): Only the entity-bundle evaluator (`entityBundleSystemPrompt`) has the discovery query section. The pairwise path is unaffected.

## Test Coverage

### Evaluator Tests (`evaluator-identity-query.spec.ts`)

| Test | Query | Candidate | Expected | Result |
|------|-------|-----------|----------|--------|
| Identity rejection | "samurai" | Character design artist | Score <50 | Score 35 (was 75) |
| Identity rejection | "investors" | ML engineer who raised funding | Score <50 | Score 0 |
| Identity acceptance | "investors" | Actual angel investor | Score >=70 | Score 95 |
| Intent override prevention | "samurai" + "visual artists" intent | Character design artist | Score <50 | Score 35 (was 60) |

### Negotiator Tests (`negotiator-discovery-query.spec.ts`)

| Test | Query | Candidate | Expected | Result |
|------|-------|-----------|----------|--------|
| Query mismatch rejection | "samurai" | Character design artist | Reject | Reject |
| Query match acceptance | "samurai" | Kendo instructor | Propose | Propose |
| No query, intent match | None | Character design artist | Propose | Propose |

All tests use `assertLLM` (LLM-as-judge) for evaluation criteria and have been verified stable across multiple runs.
