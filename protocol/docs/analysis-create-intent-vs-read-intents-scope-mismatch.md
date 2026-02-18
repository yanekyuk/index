# Analysis: create_intent vs read_intents Scope Mismatch (Index-Bound Chat)

## Summary

When chat is **index-bound** (scoped to a community), the model is encouraged to call **read_intents** before **create_intent** to "see existing intents for context." That read is **index-scoped** (only intents in that community). **create_intent** internally uses the **intent graph**, which loads **all** of the user's active intents for reconciliation. So the model's view of "what exists" can be a subset of what the backend uses, leading to wrong UX (e.g. "fresh slate") and potential duplicate/update mismatches.

---

## 1. Observed behavior (your example)

User expressed a creative-project intent. The AI replied in the spirit of:

- "Let me see if you've already noted down any similar ideas…"
- "Checking your current priorities…"
- "It looks like we're starting with a fresh slate for this project."
- Then asked for more detail (interactive fiction vs survival vs experimental, etc.)

So the model is **looking up existing intents before creating**, then inferring "no prior similar intents" and saying "fresh slate." In index-bound chat that lookup is **index-scoped**; the backend create path is **user-global**.

---

## 2. Where the mismatch comes from

### 2.1 read_intents (tool → intent graph read path)

- **Definition**: `protocol/src/lib/protocol/tools/intent.tools.ts` — `readIntents` handler.
- **Scope logic** (lines 82–93):
  - `effectiveIndexId = context.indexId || query.indexId || undefined`  
    → In index-bound chat, `context.indexId` is set, so `effectiveIndexId` is the scoped index.
  - `allUserIntents = !context.indexId && !effectiveIndexId && (!queryUserId || queryUserId === context.userId)`  
    → When `context.indexId` is set, **allUserIntents is false**.
- **Intent graph invoke** (lines 85–93):
  - `graphs.intent.invoke({ userId, indexId: effectiveIndexId, operationMode: 'read', queryUserId, allUserIntents })`.
- **Intent graph queryNode** (`protocol/src/lib/protocol/graphs/intent.graph.ts` ~535–648):
  - When `allUserIntents` is false and `effectiveIndexId` is set, it uses **index-scoped** reads:
    - `getIndexIntentsForMember(indexId, userId)` or
    - `getIntentsInIndexForMember(queryUserId, indexId)`.
  - So **read_intents in index-bound chat returns only intents in that index**.

Result: the model’s "existing intents" context is **only that community**, not the user’s full intent list.

### 2.2 create_intent (tool → intent graph create path)

- **Definition**: same file, `createIntent` handler (lines 124–213).
- **Flow**:
  1. Fetches profile, then calls `graphs.intent.invoke({ userId, userProfile, inputContent, operationMode: 'create', indexId?: effectiveIndexId })`.
  2. Intent graph runs **prepNode** then inference → verification → **reconciliation** → executor.
- **Intent graph prepNode** (`intent.graph.ts` ~130–162):
  - Comment: *"Always fetches ALL of the user's active intents from the DB via getActiveIntents(userId)."*
  - Code: `const activeIntents = await this.database.getActiveIntents(state.userId);`
- **Intent graph database**: same `database` as the rest of chat (e.g. `ChatDatabaseAdapter` from `createChatTools` in `tools/index.ts` line 96). That adapter’s `getActiveIntents(userId)` returns **all** active intents for the user (no index filter; see `database.adapter.ts` ~679–697).
- **Reconciler** (`intent.graph.ts` ~301–347): receives `state.activeIntents` (the **full** formatted list from prepNode) and decides create/update/expire against that **global** list.

Result: **create_intent** always reconciles against **all** of the user’s intents, regardless of index scope.

---

## 3. Why the model "looks at indexes" first

Prompt in `protocol/src/lib/protocol/agents/chat.prompt.ts` (pattern "User wants to create an intent"):

```text
IF description is vague ("find a job", "meet people", "learn something"):
  1. read_user_profiles()           → get their background
  2. read_intents()                 → see existing intents for context
  3. THINK: given their profile and existing intents, suggest a refined version
  ...
```

So the model is **instructed** to call **read_intents()** to get "existing intents for context" before refining or creating. It is not told that in index-bound chat this list is only the current community. So:

- The model treats **read_intents()** as the source of truth for "what the user already has."
- In index-bound chat that is **index-scoped**.
- The backend then uses **all** user intents for create/reconcile.

---

## 4. Consequences

1. **Wrong "fresh slate" / wrong prior context**  
   User may have the same or similar intent in another community. The model only sees intents in the current index → says "fresh slate" or "no similar ideas." Backend might later **update** an existing (other-index) intent instead of creating, so the model’s narrative and the actual outcome can diverge.

2. **Duplicate intents**  
   If the reconciler does not match the new description to an intent that exists only in other indexes (e.g. different wording), it may **create** a new intent. The model, having seen only the scoped list, might still say "we’re adding this as a new priority" — which can be correct, but the **decision** was made with incomplete context.

3. **Update vs create mismatch**  
   Backend might **update** an intent the model never saw (because it’s only in another index). The model might say "I’ve added that" (implying create) while the system actually updated an existing intent.

4. **Prompt reinforces the wrong mental model**  
   Telling the model to use "read_intents() → see existing intents for context" without clarifying index-scoping encourages using a **subset** of intents as if it were the full set for create flow.

---

## 5. Design intent (as implemented)

- **Intent graph comment** (prepNode): reconciliation is explicitly **global** — *"regardless of index scope"* — so that duplicates and updates are decided across all of the user’s intents. That is consistent and correct for a single source of truth.
- **read_intents** in index-bound chat is intentionally **index-scoped** so the model (and user) see only what’s relevant to that community when **reading** or exploring.
- The bug is not that create uses global intents; it’s that the **orchestration** (prompt + tool semantics) leads the model to **rely on read_intents as the pre-create context**, which in index-bound chat is a different scope than create uses.

---

## 6. Recommendations

### 6.1 Prompt and tool description (minimal, clarifies behavior)

- In **chat.prompt.ts**, in the "User wants to create an intent" section and in the index-scope section, state explicitly:
  - When chat is **index-scoped**, **read_intents** returns only intents in **this** community.
  - **create_intent** still considers **all** of the user’s intents (across communities) to avoid duplicates and to update similar intents. So "no intents here" from read_intents does **not** mean the user has no similar intents elsewhere.
- Optionally: when the flow says "read_intents() → see existing intents for context," add a note that in index-scoped chat this is "intents in this community only; the system still checks all your priorities when saving."

### 6.2 Optional: explicit "all my intents" read for create flow

- Add a way for the model to request "current user’s intents, all indexes" **only** when preparing for **create_intent** (e.g. a parameter like `allUserIntents: true` on read_intents, or a separate tool), and document in the prompt: "When you need to check for similar/duplicate intents before create, use … so you see all of the user’s intents."
- Keep the default **read_intents** behavior index-scoped when index-bound, so normal "what’s in this community" reads stay scoped.

### 6.3 Optional: surface scope in tool results

- When **read_intents** is index-scoped, the response already can include `_scopeRestriction`-style metadata (see index tools). Ensure **read_intents** in index-bound chat includes a clear hint that results are "limited to this community" so the model (and future UX) don’t treat it as "all my intents."

### 6.4 No change to intent graph semantics

- **create_intent** should continue to use **getActiveIntents(userId)** for reconciliation; changing that to index-scoped would break deduplication and update semantics across communities.

---

## 7. References (code locations)

| Concern | File | Approx. lines |
|--------|------|----------------|
| read_intents scope (allUserIntents, effectiveIndexId) | `protocol/src/lib/protocol/tools/intent.tools.ts` | 82–93 |
| create_intent → intent graph invoke | `protocol/src/lib/protocol/tools/intent.tools.ts` | 151–161 |
| prepNode: getActiveIntents(userId) (all intents) | `protocol/src/lib/protocol/graphs/intent.graph.ts` | 130–162 |
| queryNode: index vs global read | `protocol/src/lib/protocol/graphs/intent.graph.ts` | 535–648 |
| Prompt: "read_intents() → see existing intents for context" | `protocol/src/lib/protocol/agents/chat.prompt.ts` | 148–158 |
| Index scope notice for read_intents/create_intent | `protocol/src/lib/protocol/agents/chat.prompt.ts` | 244–249 |
| getActiveIntents (no index filter) | `protocol/src/adapters/database.adapter.ts` | 679–697 |
| createChatTools: intent graph uses same database | `protocol/src/lib/protocol/tools/index.ts` | 95–96, 127–128 |

---

## 8. Conclusion

There is a **scope mismatch** between:

- **read_intents** in index-bound chat → **index-scoped** (intents in that community only).
- **create_intent** (intent graph) → **user-global** (all active intents for reconciliation).

The prompt encourages using read_intents as "existing intents for context" before create, which in index-bound chat is incomplete and leads to wrong "fresh slate" messaging and possible duplicate/update confusion. Fixes should align the **model’s expectations** (and optionally its pre-create data) with the global reconciliation behavior, without making reconciliation itself index-scoped.
