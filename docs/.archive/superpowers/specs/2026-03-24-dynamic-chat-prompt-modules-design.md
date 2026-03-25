# Dynamic Chat Prompt Modules

**Date:** 2026-03-24
**Status:** Approved
**Problem:** The chat agent system prompt has grown to ~10.4K tokens (545 lines) from accumulating pattern-specific instructions. This degrades LLM performance — especially on smaller models — and creates a vicious cycle where misbehavior prompts more corrective rules, which further bloat the prompt.

## Goal

Split the chat agent system prompt into a lean always-present core and conditional modules injected at runtime based on tool call history, user message patterns, and conversation context. The LLM sees only what's relevant to the current iteration.

## Architecture

### Prompt Assembly Flow

```
chat.agent.ts runIteration(messages, iterationCount)
  → extractRecentToolCalls(messages)     // parse previous iteration's AIMessage.tool_calls
  → getCurrentUserMessage(messages)      // latest HumanMessage text
  → buildSystemContent(ctx, iterCtx)     // assemble core + resolved modules
    → buildCore(ctx)                     // ~350 lines, always present
    → buildScoping(ctx)                  // index-scoped vs scopeless variant
    → buildOnboarding(ctx)               // only when ctx.isOnboarding
    → resolveModules(iterCtx)            // match modules by triggers
  → SystemMessage(assembled prompt)
  → model.invoke(fullMessages)
```

### Module Interface

```typescript
// chat.prompt.modules.ts

interface PromptModule {
  id: string;
  triggers: string[];                                    // tool names that activate this module
  excludes?: string[];                                   // module IDs to suppress when this module activates
  triggerFilter?: (iterCtx: IterationContext) => boolean; // optional filter after tool trigger match (e.g., arg inspection)
  regex?: RegExp;                                        // user message patterns (secondary trigger)
  context?: (ctx: ResolvedToolContext) => boolean;        // context flag (tertiary trigger)
  content: (ctx: ResolvedToolContext) => string;          // prompt text to inject
}

interface IterationContext {
  recentTools: Array<{ name: string; args: Record<string, unknown> }>;
  currentMessage?: string;
  ctx: ResolvedToolContext;
}
```

Triggers are OR'd — any match includes the module.

### Trigger Resolution Logic

```typescript
export function resolveModules(iterCtx: IterationContext): string {
  // Phase 1: Collect candidate modules
  //   For each registered module:
  //     1. Check if any recentTools[].name appears in module.triggers
  //        - For tools with arg-based disambiguation (create_opportunities),
  //          check args to pick introduction vs discovery
  //     2. Check if module.regex?.test(iterCtx.currentMessage)
  //     3. Check if module.context?.(iterCtx.ctx)
  //     If any match → add to candidates
  //
  // Phase 2: Apply exclusions (unidirectional — the excluding module is always retained)
  //   For each candidate with excludes[], remove excluded module IDs from candidates
  //   (introduction.excludes = ["discovery"] → discovery is dropped, introduction stays)
  //
  // Phase 3: Skip all non-onboarding modules when ctx.isOnboarding is true
  //
  // Return concatenated content from surviving candidates
}

export function extractRecentToolCalls(
  messages: BaseMessage[]
): Array<{ name: string; args: Record<string, unknown> }> {
  // Scan backwards through messages for ALL AIMessages with tool_calls
  // since the last HumanMessage (i.e., all tool calls in the current
  // agent turn, which may span multiple iterations)
  // Return flattened array of { name, args }
  // Return [] if no tool calls found (first iteration)
}
```

**Tool history scope:** `extractRecentToolCalls` collects tool calls from ALL iterations since the last user message — not just the immediately previous AIMessage. This ensures that if the agent called `create_opportunities` in iteration 2 and is now generating a final text response in iteration 3, the discovery module's formatting rules are still present. The scope resets on each new `HumanMessage` (new user turn).

## Content Split

### Core (always present, ~350 lines, ~8K tokens)

| Content | Current lines | Notes |
|---|---|---|
| Mission + capabilities | 58-67 | Identity — who Index is and what it does |
| Voice, tone, banned vocabulary | 68-89 | Always applies to all responses |
| Session context (user/profile/indexes JSON) | 92-209 | Already dynamic via `ctx` |
| Preloaded context policy | 198-209 | Rules for when to use preloaded data vs call tools |
| Architecture philosophy + entity model | 210-228 | Framing for tool composition |
| Tools reference table | 230-261 | LLM needs this to pick tools on any iteration |
| Core routing rule: discovery-first | 282-288 | Extracted from Pattern 1 — "DO NOT create intent first" |
| Core routing rule: discovery-first behavioral | 448-454 | Extracted from behavioral rules section |
| When to mention community/index | 443-447 | Always applies |
| Internal errors and retries | 472-476 | Always applies |
| Narration style | 478-516 | Blockquote rules, streaming behavior |
| Output format | 523-545 | Markdown, no raw JSON, synthesize, card rules |
| General behavioral rules | 540-545 | Don't fabricate, check results, keep iterating |

### Index Scoping (variant, not toggle)

Two mutually exclusive variants based on `ctx.indexId`:

**When `ctx.indexId` is truthy (scoped):**
- Scope enforcement rules (results limited to this community)
- `_scopeRestriction` handling
- Default `indexId` for `read_intents` and `create_intent`
- "Cannot infer 'no similar signals' from empty scoped results"
- Owner capabilities line (when `ctx.isOwner` is also true)

**When `ctx.indexId` is falsy (scopeless):**
- "No index scope. System evaluates against all indexes."
- "Use `read_index_memberships` to intersect for shared context."

### Onboarding (conditional on `ctx.isOnboarding`)

The full onboarding flow (steps 1-8, profile confirmation handling, onboarding rules). Already conditional in the current prompt. No structural change needed — just stays excluded from the module system since it's context-flag-driven and self-contained.

When `ctx.isOnboarding` is true, non-onboarding pattern modules are skipped (onboarding has its own complete orchestration flow).

### Modules (injected by triggers)

#### `discovery`
- **Triggers:** `create_opportunities`, `update_opportunity`
- **Content:** Pattern 1 (network scoping with personal index, `createIntentSuggested` handling, `suggestIntentCreationForVisibility` flow, exhausted results behavior), Pattern 1a (direct connection with `targetUserId`), Pattern 7 (opportunity cards in chat, status translation, "only describe what tool confirms"), introducer exception for signal suppression
- **~45 lines**

#### `introduction`
- **Triggers:** `create_opportunities` (only when args contain `partyUserIds` or `introTargetUserId`)
- **Excludes:** `["discovery"]`
- **Content:** Pattern 6 (full introduction workflow: gather context first, entities array format, exactly two parties), Pattern 6a (discover connections for a person via `introTargetUserId`), "no signal creation in introducer flows" critical rule. Includes its own opportunity card handling and status translation rules (subset of Pattern 7 relevant to introductions).
- **~35 lines**

#### `intent-creation`
- **Triggers:** `create_intent`
- **Content:** Pattern 2 (specificity test: vague vs specific, refinement workflow, "never write `intent_proposal` block yourself", proposal card verbatim inclusion)
- **~20 lines**

#### `intent-management`
- **Triggers:** `update_intent`, `delete_intent`
- **Content:** Pattern 4 (look up ID with `read_intents` first, match to correct intent, then update/delete)
- **~10 lines**

#### `person-lookup`
- **Triggers:** `read_user_profiles`
- **Content:** Pattern 0 (name lookup: single match → present, multiple → disambiguate, none → inform, transition to Pattern 1 or 1a)
- **~10 lines**

#### `url-scraping`
- **Triggers:** `scrape_url`
- **Regex:** `/(https?:\/\/)/i` (activates when user message contains a URL)
- **Content:** Pattern 3 (scrape before intent creation, profile URL exception — pass directly to `create_user_profile`)
- **~15 lines**

#### `community`
- **Triggers:** `read_indexes`, `create_index`, `create_index_membership`, `update_index`, `delete_index`, `delete_index_membership`
- **Content:** Pattern 8 (explore community: read intents + memberships, synthesize purpose/needs/composition)
- **~10 lines**

#### `contacts`
- **Triggers:** `import_gmail_contacts`, `add_contact`, `list_contacts`, `remove_contact`
- **Content:** Patterns 9-10 (Gmail auth flow with `requiresAuth`/`authUrl`, ghost user explanation, manual contact management)
- **~25 lines**

#### `shared-context`
- **Triggers:** `read_index_memberships`
- **Content:** Pattern 5 (intersect indexes between two users, read intents from shared indexes, synthesize overlap)
- **~10 lines**

#### `mentions`
- **Regex:** `/@\[.*?\]\(.*?\)/`
- **Content:** @mention format explanation (`@[Display Name](userId)` — value in parentheses is the userId)
- **~2 lines**

### Tools with no module (intentional)

These tools are self-explanatory from their tool descriptions and do not need pattern-specific orchestration guidance:

- `read_intents` — always used as a prerequisite for other patterns; guidance comes from the active pattern module
- `read_intent_indexes`, `create_intent_index`, `delete_intent_index` — simple CRUD, tool descriptions sufficient
- `read_docs` — self-explanatory documentation lookup
- `create_user_profile`, `update_user_profile`, `complete_onboarding` — profile tools; onboarding-specific guidance is in the onboarding block, non-onboarding usage is straightforward
- `import_contacts` — bulk import variant; ghost user context is relevant but no orchestration pattern exists yet. Add to `contacts` module triggers if/when bulk import guidance is written.

## `buildSystemContent` Signature

```typescript
// Before (current):
export function buildSystemContent(ctx: ResolvedToolContext): string

// After:
export function buildSystemContent(ctx: ResolvedToolContext, iterCtx?: IterationContext): string
```

`IterationContext` is optional to maintain backward compatibility (tests, any other callers). When omitted, no modules are injected — only core + scoping + onboarding. `ResolvedToolContext` is defined in `protocol/src/lib/protocol/tools/tool.helpers.ts`.

## File Changes

### New Files

| File | Purpose |
|---|---|
| `protocol/src/lib/protocol/agents/chat.prompt.modules.ts` | Module definitions, `PromptModule` interface, `resolveModules()`, `extractRecentToolCalls()` |
| `protocol/src/lib/protocol/agents/chat.prompt.modules.spec.ts` | Unit tests for module resolution logic |
| `protocol/src/lib/protocol/agents/chat.prompt.dynamic.spec.ts` | Smartest behavioral tests for dynamic prompt assembly |

### Modified Files

| File | Change |
|---|---|
| `chat.prompt.ts` | Extract pattern sections into modules. Split `buildSystemContent` into `buildCore` + `buildScoping` + `buildOnboarding` + `resolveModules`. Add `IterationContext` parameter. |
| `chat.agent.ts` | In `runIteration` and `streamRun`: extract recent tool calls and current user message from `messages`, pass as `IterationContext` to `buildSystemContent`. ~10 lines added. |

### Unchanged Files

- `model.config.ts` — no model/temperature changes
- All tool files — tool descriptions stay static
- All graph files — no invocation changes
- All other agent files — only chat agent affected

## Testing Strategy

### Level 1: Module Resolution Unit Tests (`chat.prompt.modules.spec.ts`)

Pure logic, no LLM calls, fast execution:

- No tools, no regex, no index → core only + scopeless variant
- No tools, no index, `isOnboarding: true` → core + onboarding, NO pattern modules
- `recentTools: [create_opportunities]` → core + discovery module
- `recentTools: [create_opportunities]` with `args.introTargetUserId` → core + introduction module (NOT discovery)
- `recentTools: [create_intent]` → core + intent-creation module
- `recentTools: [read_user_profiles]` → core + person-lookup module
- `recentTools: [scrape_url]` → core + url-scraping module
- `recentTools: [read_indexes]` → core + community module
- `recentTools: [import_gmail_contacts]` → core + contacts module
- `recentTools: [read_index_memberships]` → core + shared-context module
- `recentTools: [update_intent]` → core + intent-management module
- `ctx.indexId` set → scoped variant included, scopeless excluded
- `ctx.indexId` falsy → scopeless variant included, scoped excluded
- `ctx.indexId` + `ctx.isOwner` → scoped variant + owner capabilities line
- User message contains URL → url-scraping module included
- User message contains `@[Name](id)` → mentions module included
- Multiple tools in one iteration → multiple modules included
- `isOnboarding: true` + tool calls → onboarding only, pattern modules skipped

### Level 2: Smartest Behavioral Tests (`chat.prompt.dynamic.spec.ts`)

LLM-verified tests confirming the agent behaves correctly with dynamically assembled prompts:

- "find me a mentor" → LLM calls `create_opportunities` (not `create_intent`) — validates core routing rule works without discovery module
- After `create_opportunities` returns with `suggestIntentCreationForVisibility` → LLM correctly offers signal creation — validates discovery module injection
- "introduce Alice to Bob" → LLM gathers context before calling `create_opportunities` — validates introduction module
- `@[Alice](uuid)` in message → LLM extracts userId correctly — validates mentions regex trigger
- User pastes URL → LLM calls `scrape_url` first — validates url-scraping regex trigger

### Regression Baseline

Run existing `chat.graph.invoke.spec.ts` tests before any code changes to capture current pass/fail state. All existing tests must pass after the refactor — prompt content is identical, only delivery timing changes.

## Prompt Size Impact

| Scenario | Before | After | Reduction |
|---|---|---|---|
| First iteration (no tools called yet) | ~10.4K tokens | ~8K tokens | ~23% |
| After `create_opportunities` | ~10.4K tokens | ~8.5K tokens | ~18% |
| After `create_intent` | ~10.4K tokens | ~8.2K tokens | ~21% |
| Worst case (3+ tools triggered) | ~10.4K tokens | ~9K tokens | ~13% |

The reduction is most impactful on the first iteration — where the LLM needs to pick the right tool from the tools table without pattern noise competing for attention.

## Migration Path

This is a pure refactor — no prompt content changes, no behavioral changes. The same text is delivered to the LLM, just conditionally instead of statically. This means:

1. Extract patterns into module objects (copy-paste, no rewriting)
2. Wire up `buildSystemContent` to call `resolveModules`
3. Add `IterationContext` extraction in `chat.agent.ts`
4. Run existing tests to confirm no regression
5. Add new unit + Smartest tests

No feature flags needed. No gradual rollout. If tests pass, the behavior is identical.
