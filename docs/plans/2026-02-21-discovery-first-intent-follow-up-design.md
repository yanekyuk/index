# Discovery-First, Intent as Follow-Up — Design

**Date:** 2026-02-21

## Goal

Establish "opportunity discovery first, intent creation as optional follow-up" as the default product flow. The chat agent should prefer discovery unless the user explicitly asks to create or save an intent.

## Scope

- **In scope:** Design doc, chat prompt orchestration and Behavioral Rules, optional one-line tool copy so "discovery first" is consistent.
- **Out of scope:** Schema/API changes, opportunity graph logic, frontend UI flows.

## Success criteria

- Design doc exists and is committed.
- Chat prompt has a "Discovery first" orchestration pattern and a "Discovery-first" behavioral rule; "Create intent" is the path when the user explicitly says they want to create/save an intent.
- Existing callback behavior (create_opportunities → createIntentSuggested → create_intent → retry) remains and is documented.

---

## Canonical flow

### Default flow (user does not say "create intent")

1. User expresses a discovery-style need (e.g. "find me a mentor", "who's looking for a React dev", "I want to meet people building in AI").
2. Agent calls `create_opportunities(searchQuery=...)` with that need as the query.
3. Opportunity graph runs (HyDE strategies, scoring). If it finds candidates → return them; agent presents results.
4. If it finds no candidates and the user has no (or weak) profile/intent signal in scope, the graph may return `createIntentSuggested: true` and `suggestedIntentDescription` (e.g. the search query).
5. Chat agent's existing callback (`handleCreateIntentCallback`) runs: calls `create_intent(description=suggestedIntentDescription)` then re-invokes `create_opportunities` with the same args.
6. Second discovery may return candidates; agent presents those. The new intent also enables future ambient discovery.

### Explicit "create intent" path

When the user clearly asks to create or save an intent (e.g. "add this as a priority", "create an intent for X", "save that I'm looking for Y"), the agent follows the existing "User wants to create an intent" pattern: vagueness check, optional refine, then `create_intent(description=...)`. No need to run discovery first.

### Distinction

- **Discovery-first:** Need expressed as "find / who / connect me" → `create_opportunities` first; intent creation only when the tool suggests it or the user later asks.
- **Intent-first:** User says "create intent", "add priority", "save this" → go straight to the create-intent pattern.

---

## Architecture

Prompt and behavioral rules only. Opportunity graph, `opportunity.discover`, and `chat.agent` callback stay unchanged; this doc describes how they already implement the flow.

---

## Prompt changes (implementation reference)

### 1. New orchestration pattern (first in list)

Add as **pattern 1** in `protocol/src/lib/protocol/agents/chat.prompt.ts`. Current "User wants to create an intent" becomes pattern 2; others shift.

**1. User wants to find connections or discover (default for connection-seeking)**

- For open-ended connection-seeking ("find me a mentor", "who needs a React dev", "I want to meet people in AI"), run **discovery first**.
- Call `create_opportunities(searchQuery=user's request)` (with indexId when scoped). Do not call `create_intent` first unless the user explicitly asked to create or save an intent.
- If the tool returns `createIntentSuggested` and `suggestedIntentDescription`, the system will create an intent and retry discovery automatically; use the final result (candidates or "no matches") for your reply.
- If the user **explicitly** says they want to create/save an intent (e.g. "add a priority", "create an intent", "save that I'm looking for X"), use pattern 2 instead.

### 2. Rename and renumber existing pattern

- Current "1. User wants to create an intent" → **2. User explicitly wants to create or save an intent**
- Keep existing steps (vagueness check, refine, create_intent) and scope note unchanged.

### 3. Behavioral Rules

Replace **Intent-First Discovery** with:

**Discovery-first; intent as follow-up**

- For connection-seeking (find connections, discover, who's looking for X), use `create_opportunities(searchQuery=...)` first. Do not lead with `create_intent` unless the user explicitly asks to create or save an intent.
- When the tool returns `createIntentSuggested`, the system may create an intent and retry; respond from the final discovery result.
- Only call `create_opportunities` for explicit "find me connections" / discovery or for introductions between two other people (existing rule).

### 4. Tool table (optional)

Optionally add one line to the `create_opportunities` row or a short note: "Discovery (query) first for connection-seeking; intent creation is optional and can be suggested by the tool."

---

## Implementation plan

See `docs/plans/2026-02-21-discovery-first-intent-follow-up.md` for the step-by-step implementation plan (prompt edits, verification, commit strategy).
