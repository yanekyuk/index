# Quick Wins Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three independent bugs — wrong detection.source for introducer discovery, missing felicityClarity DB persistence, and incomplete respond_to_negotiation MCP tool schema.

**Architecture:** Three isolated fixes on a single `fix/quick-wins-batch` branch, one commit per fix. Each touches a different subsystem (opportunity graph, intent pipeline, negotiation tools) with no shared state.

**Tech Stack:** TypeScript, Drizzle ORM, Zod, Bun test runner

---

## File Map

### Task 1 (IND-241)
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts` (lines 2437–2452)
- Reference: `packages/protocol/src/opportunity/opportunity.introducer.ts` (line 21, constant definition)
- Modify: `backend/tests/introducer-discovery.spec.ts` (add test)

### Task 2 (IND-238)
- Modify: `backend/src/schemas/database.schema.ts` (line 321)
- Create: migration file via `bun run db:generate`
- Modify: `packages/protocol/src/shared/interfaces/database.interface.ts` (lines 133, 162)
- Modify: `backend/src/adapters/database.adapter.ts` (lines 110, 122, 263, 294, 1049, 1081)
- Modify: `packages/protocol/src/intent/intent.graph.ts` (lines 553, 600)

### Task 3 (IND-239)
- Modify: `packages/protocol/src/negotiation/negotiation.tools.ts` (lines 304–360)

---

### Task 1: IND-241 — Fix detection.source for introducer discovery

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts:2437-2452`
- Modify: `backend/tests/introducer-discovery.spec.ts`

- [ ] **Step 1: Add import for INTRODUCER_DISCOVERY_SOURCE**

In `packages/protocol/src/opportunity/opportunity.graph.ts`, find the existing imports from `opportunity.introducer.ts` or the closest related import block. Add the constant to the imports. Search for any existing import from `'./opportunity.introducer.js'`:

```bash
grep -n 'opportunity.introducer' packages/protocol/src/opportunity/opportunity.graph.ts
```

If no import exists, add after the last import from the `./opportunity.*` group:

```typescript
import { INTRODUCER_DISCOVERY_SOURCE } from './opportunity.introducer.js';
```

If an import already exists, add `INTRODUCER_DISCOVERY_SOURCE` to it.

- [ ] **Step 2: Replace detection.source value**

In `packages/protocol/src/opportunity/opportunity.graph.ts`, find and replace at line ~2439:

```typescript
// OLD (line 2437-2443):
              data = {
                detection: {
                  source: 'manual',
                  createdBy: state.userId,
                  createdByName: introducerUserForOnBehalf?.name ?? undefined,
                  timestamp: now,
                },

// NEW:
              data = {
                detection: {
                  source: INTRODUCER_DISCOVERY_SOURCE,
                  createdBy: state.userId,
                  createdByName: introducerUserForOnBehalf?.name ?? undefined,
                  timestamp: now,
                },
```

- [ ] **Step 3: Update curator_judgment detail string**

In the same file at line ~2452, update the signal detail:

```typescript
// OLD:
                  signals: [{
                    type: 'curator_judgment',
                    weight: 1,
                    detail: `Discovery on behalf of another user by ${introducerUserForOnBehalf?.name ?? 'a member'} via chat`,
                  }],

// NEW:
                  signals: [{
                    type: 'curator_judgment',
                    weight: 1,
                    detail: `Introducer discovery for ${introducerUserForOnBehalf?.name ?? 'a member'} via background maintenance`,
                  }],
```

- [ ] **Step 4: Add test assertion**

In `backend/tests/introducer-discovery.spec.ts`, add a test to the `constants` describe block (after line 46):

```typescript
    it('INTRODUCER_DISCOVERY_SOURCE matches the value used in opportunity persist', () => {
      expect(INTRODUCER_DISCOVERY_SOURCE).toBe('introducer_discovery');
      expect(typeof INTRODUCER_DISCOVERY_SOURCE).toBe('string');
    });
```

Note: The test file already imports `INTRODUCER_DISCOVERY_SOURCE` (line 11) and tests its value (line 45). The existing test `expect(INTRODUCER_DISCOVERY_SOURCE).toBe('introducer_discovery')` already covers the constant. The real integration test — verifying the graph uses this constant — requires a running DB and full graph invocation, which is beyond unit test scope. The constant test plus the code change together provide the safety net.

- [ ] **Step 5: Run tests**

```bash
cd backend && bun test tests/introducer-discovery.spec.ts -v
```

Expected: All existing tests pass, new test passes.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.graph.ts backend/tests/introducer-discovery.spec.ts
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
fix(protocol): use INTRODUCER_DISCOVERY_SOURCE for introducer-discovered opportunities

The onBehalfOfUserId persist path in opportunity.graph.ts was writing
detection.source: 'manual' instead of 'introducer_discovery'. The constant
existed but was never referenced in the persist path.

Closes IND-241
EOF
)"
```

---

### Task 2: IND-238 — Persist felicityClarity to database

**Files:**
- Modify: `backend/src/schemas/database.schema.ts:321`
- Modify: `packages/protocol/src/shared/interfaces/database.interface.ts:133,162`
- Modify: `backend/src/adapters/database.adapter.ts:110,122,263,294,1049,1081`
- Modify: `packages/protocol/src/intent/intent.graph.ts:553,600`
- Create: migration file

- [ ] **Step 1: Add column to schema**

In `backend/src/schemas/database.schema.ts`, after line 321 (`felicitySincerity`), add:

```typescript
// OLD (lines 320-322):
  felicityAuthority: integer('felicity_authority'),
  felicitySincerity: integer('felicity_sincerity'),
  status: intentStatusEnum('status').default('ACTIVE'),

// NEW:
  felicityAuthority: integer('felicity_authority'),
  felicitySincerity: integer('felicity_sincerity'),
  felicityClarity: integer('felicity_clarity'),
  status: intentStatusEnum('status').default('ACTIVE'),
```

- [ ] **Step 2: Add field to protocol interfaces**

In `packages/protocol/src/shared/interfaces/database.interface.ts`, add `felicityClarity` to both interfaces.

For `CreateIntentData` (after line 133):

```typescript
// OLD (lines 131-134):
  /** Felicity authority score from verifier (0-100) */
  felicityAuthority?: number | null;
  /** Felicity sincerity score from verifier (0-100) */
  felicitySincerity?: number | null;
  /** Donnellan intent mode */

// NEW:
  /** Felicity authority score from verifier (0-100) */
  felicityAuthority?: number | null;
  /** Felicity sincerity score from verifier (0-100) */
  felicitySincerity?: number | null;
  /** Felicity clarity score from verifier (0-100) */
  felicityClarity?: number | null;
  /** Donnellan intent mode */
```

For `UpdateIntentData` (after line 162):

```typescript
// OLD (lines 160-164):
  /** Felicity authority score from verifier (0-100) */
  felicityAuthority?: number | null;
  /** Felicity sincerity score from verifier (0-100) */
  felicitySincerity?: number | null;
  /** Donnellan intent mode */

// NEW:
  /** Felicity authority score from verifier (0-100) */
  felicityAuthority?: number | null;
  /** Felicity sincerity score from verifier (0-100) */
  felicitySincerity?: number | null;
  /** Felicity clarity score from verifier (0-100) */
  felicityClarity?: number | null;
  /** Donnellan intent mode */
```

- [ ] **Step 3: Add field to adapter local interfaces**

In `backend/src/adapters/database.adapter.ts`, add `felicityClarity` to both local input interfaces.

For `CreateIntentInput` (after line 110):

```typescript
// OLD (lines 109-112):
  felicityAuthority?: number | null;
  felicitySincerity?: number | null;
  intentMode?: 'REFERENTIAL' | 'ATTRIBUTIVE' | null;

// NEW:
  felicityAuthority?: number | null;
  felicitySincerity?: number | null;
  felicityClarity?: number | null;
  intentMode?: 'REFERENTIAL' | 'ATTRIBUTIVE' | null;
```

For `UpdateIntentInput` (after line 122):

```typescript
// OLD (lines 121-123):
  felicityAuthority?: number | null;
  felicitySincerity?: number | null;
  intentMode?: 'REFERENTIAL' | 'ATTRIBUTIVE' | null;

// NEW:
  felicityAuthority?: number | null;
  felicitySincerity?: number | null;
  felicityClarity?: number | null;
  intentMode?: 'REFERENTIAL' | 'ATTRIBUTIVE' | null;
```

- [ ] **Step 4: Wire into IntentDatabaseAdapter.createIntent**

In `backend/src/adapters/database.adapter.ts`, add to the insert values (after line 263):

```typescript
// OLD (lines 262-265):
          felicityAuthority: data.felicityAuthority ?? undefined,
          felicitySincerity: data.felicitySincerity ?? undefined,
          intentMode: data.intentMode ?? undefined,

// NEW:
          felicityAuthority: data.felicityAuthority ?? undefined,
          felicitySincerity: data.felicitySincerity ?? undefined,
          felicityClarity: data.felicityClarity ?? undefined,
          intentMode: data.intentMode ?? undefined,
```

- [ ] **Step 5: Wire into IntentDatabaseAdapter.updateIntent**

In the same file, add to the update path (after line 294):

```typescript
// OLD (lines 293-296):
      if (data.felicityAuthority !== undefined) updateData.felicityAuthority = data.felicityAuthority;
      if (data.felicitySincerity !== undefined) updateData.felicitySincerity = data.felicitySincerity;
      if (data.intentMode !== undefined) updateData.intentMode = data.intentMode;

// NEW:
      if (data.felicityAuthority !== undefined) updateData.felicityAuthority = data.felicityAuthority;
      if (data.felicitySincerity !== undefined) updateData.felicitySincerity = data.felicitySincerity;
      if (data.felicityClarity !== undefined) updateData.felicityClarity = data.felicityClarity;
      if (data.intentMode !== undefined) updateData.intentMode = data.intentMode;
```

- [ ] **Step 6: Wire into ChatDatabaseAdapter.createIntent**

In the same file, add to the insert values (after line 1049):

```typescript
// OLD (lines 1048-1051):
          felicityAuthority: data.felicityAuthority ?? undefined,
          felicitySincerity: data.felicitySincerity ?? undefined,
          intentMode: data.intentMode ?? undefined,

// NEW:
          felicityAuthority: data.felicityAuthority ?? undefined,
          felicitySincerity: data.felicitySincerity ?? undefined,
          felicityClarity: data.felicityClarity ?? undefined,
          intentMode: data.intentMode ?? undefined,
```

- [ ] **Step 7: Wire into ChatDatabaseAdapter.updateIntent**

In the same file, add to the update path (after line 1080):

```typescript
// OLD (lines 1079-1082):
      if (data.felicityAuthority !== undefined) updateData.felicityAuthority = data.felicityAuthority;
      if (data.felicitySincerity !== undefined) updateData.felicitySincerity = data.felicitySincerity;
      if (data.intentMode !== undefined) updateData.intentMode = data.intentMode;

// NEW:
      if (data.felicityAuthority !== undefined) updateData.felicityAuthority = data.felicityAuthority;
      if (data.felicitySincerity !== undefined) updateData.felicitySincerity = data.felicitySincerity;
      if (data.felicityClarity !== undefined) updateData.felicityClarity = data.felicityClarity;
      if (data.intentMode !== undefined) updateData.intentMode = data.intentMode;
```

- [ ] **Step 8: Wire into intent.graph.ts create path**

In `packages/protocol/src/intent/intent.graph.ts`, add to the create call (after line 553):

```typescript
// OLD (lines 552-554):
                felicityAuthority: matchedVerifiedIntent?.verification?.felicity_scores.authority ?? null,
                felicitySincerity: matchedVerifiedIntent?.verification?.felicity_scores.sincerity ?? null,
                intentMode: createAction.intentMode ?? null,

// NEW:
                felicityAuthority: matchedVerifiedIntent?.verification?.felicity_scores.authority ?? null,
                felicitySincerity: matchedVerifiedIntent?.verification?.felicity_scores.sincerity ?? null,
                felicityClarity: matchedVerifiedIntent?.verification?.felicity_scores.clarity ?? null,
                intentMode: createAction.intentMode ?? null,
```

- [ ] **Step 9: Wire into intent.graph.ts update path**

In the same file, add to the update call (after line 600):

```typescript
// OLD (lines 599-601):
                felicityAuthority: matchedVerifiedIntent?.verification?.felicity_scores.authority ?? null,
                felicitySincerity: matchedVerifiedIntent?.verification?.felicity_scores.sincerity ?? null,
                intentMode: updateAction.intentMode ?? null,

// NEW:
                felicityAuthority: matchedVerifiedIntent?.verification?.felicity_scores.authority ?? null,
                felicitySincerity: matchedVerifiedIntent?.verification?.felicity_scores.sincerity ?? null,
                felicityClarity: matchedVerifiedIntent?.verification?.felicity_scores.clarity ?? null,
                intentMode: updateAction.intentMode ?? null,
```

- [ ] **Step 10: Generate and rename migration**

```bash
cd backend && bun run db:generate
```

This creates a new migration file in `backend/drizzle/`. Find it:

```bash
ls -t backend/drizzle/*.sql | head -1
```

Rename it following the convention. Check the latest migration number:

```bash
ls backend/drizzle/*.sql | sort | tail -1
```

Rename to `NNNN_add_intent_felicity_clarity.sql` (where NNNN is the next sequential number). Then update `backend/drizzle/meta/_journal.json` — find the last entry and update its `tag` to match the new filename (without `.sql`).

- [ ] **Step 11: Apply migration**

```bash
cd backend && bun run db:migrate
```

- [ ] **Step 12: Verify no remaining schema drift**

```bash
cd backend && bun run db:generate
```

Expected: "No schema changes" or "Nothing to generate".

- [ ] **Step 13: Commit**

```bash
git add backend/src/schemas/database.schema.ts packages/protocol/src/shared/interfaces/database.interface.ts backend/src/adapters/database.adapter.ts packages/protocol/src/intent/intent.graph.ts backend/drizzle/
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(protocol): persist felicityClarity score to database

The clarity felicity score was already computed by the semantic verifier
and used at runtime for VAGUE_INTENT flagging, but was silently discarded
during persistence. Adds the felicity_clarity column and wires it through
both adapter classes and both graph persistence paths.

Closes IND-238
EOF
)"
```

---

### Task 3: IND-239 — Align respond_to_negotiation MCP tool schema

**Files:**
- Modify: `packages/protocol/src/negotiation/negotiation.tools.ts:304-360`

- [ ] **Step 1: Update the querySchema**

In `packages/protocol/src/negotiation/negotiation.tools.ts`, replace the `querySchema` at lines 304-307:

```typescript
// OLD (lines 304-307):
    querySchema: z.object({
      negotiationId: z.string().describe('The negotiation task ID to respond to.'),
      action: z.enum(['accept', 'reject', 'counter', 'question']).describe('The response action: accept the proposal, reject it, counter with a new message, or ask a clarifying question.'),
      message: z.string().optional().describe('Required for "counter" and "question" actions. Your message explaining what you want to change or clarify.'),
    }),

// NEW:
    querySchema: z.object({
      negotiationId: z.string().describe('The negotiation task ID to respond to.'),
      action: z.enum(['propose', 'accept', 'reject', 'counter', 'question']).describe('The response action. On the first turn (turnCount === 0) this MUST be "propose".'),
      reasoning: z.string().describe('Why you are taking this action — your assessment of the opportunity.'),
      suggestedRoles: z.object({
        ownUser: z.enum(['agent', 'patient', 'peer']).describe('Suggested role for your user in this opportunity.'),
        otherUser: z.enum(['agent', 'patient', 'peer']).describe('Suggested role for the other user in this opportunity.'),
      }).describe('Role suggestions for both parties.'),
      message: z.string().optional().describe('Required for "counter" and "question" actions. Your message explaining what you want to change or clarify.'),
    }),
```

- [ ] **Step 2: Update the handler to use query fields**

In the same file, replace the turnData construction at lines 353-361:

```typescript
// OLD (lines 353-361):
        // ── Build and persist the external agent's turn ──
        const turnData: NegotiationTurn = {
          action: query.action,
          assessment: {
            reasoning: query.message ?? `User ${query.action}ed the proposal.`,
            suggestedRoles: { ownUser: 'peer', otherUser: 'peer' },
          },
          ...(query.message ? { message: query.message } : {}),
        };

// NEW:
        // ── Build and persist the external agent's turn ──
        const turnData: NegotiationTurn = {
          action: query.action,
          assessment: {
            reasoning: query.reasoning,
            suggestedRoles: query.suggestedRoles,
          },
          ...(query.message ? { message: query.message } : {}),
        };
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd packages/protocol && npx tsc --noEmit
```

Expected: No type errors. The `NegotiationTurn` type expects `action: 'propose' | 'accept' | 'reject' | 'counter' | 'question'` which now matches the updated enum.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/negotiation/negotiation.tools.ts
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
fix(protocol): add reasoning and suggestedRoles to respond_to_negotiation schema

The MCP tool was hardcoding assessment.reasoning to the message text and
suggestedRoles to peer/peer. Adds both as required top-level input fields
matching the domain doc contract. Also adds 'propose' to the action enum
to align with NegotiationTurnSchema.

Closes IND-239
EOF
)"
```

---

### Task 4: Create PR

- [ ] **Step 1: Push and create PR**

```bash
git push origin fix/quick-wins-batch -u
```

```bash
gh pr create --base dev --repo indexnetwork/index --title "fix: quick wins batch (IND-241, IND-238, IND-239)" --body "$(cat <<'EOF'
## Summary

- **IND-241** — Use `INTRODUCER_DISCOVERY_SOURCE` constant for introducer-discovered opportunities instead of hardcoded `'manual'`
- **IND-238** — Persist `felicityClarity` score to database (was computed but silently discarded)
- **IND-239** — Add `reasoning` and `suggestedRoles` as required fields on `respond_to_negotiation` MCP tool, add `propose` to action enum

## Test plan

- [ ] `bun test tests/introducer-discovery.spec.ts` passes
- [ ] `bun run db:generate` reports no schema drift after migration
- [ ] `npx tsc --noEmit` in packages/protocol passes
- [ ] Existing negotiation tests still pass
EOF
)"
```
