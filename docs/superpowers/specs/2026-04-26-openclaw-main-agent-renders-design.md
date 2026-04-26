# OpenClaw Main-Agent Renders — Replace the Dispatcher Subagent

**Date:** 2026-04-26
**Status:** Approved
**Scope:** `packages/openclaw-plugin/`, `backend/` (small controller change), `frontend/src/app/agents/[id]/page.tsx` (mirror)

## Problem

The plugin currently dispatches every user-facing message — daily digest, ambient discovery, test message — through a **silent dispatcher subagent** that has no access to the user's main OpenClaw agent context. The dispatcher renders in a neutral, isolated voice. With a personalized OpenClaw agent (e.g. a flirty test persona), the user's main agent introduces themselves with character, then a digest arrives moments later in a dry, templated voice. The two messages clearly come from different agents.

The intent of these notifications is that the user's *own* OpenClaw agent surfaces them — in its own voice, with whatever persona, history, and style the user has set up.

## Goal

Drive the user's main OpenClaw agent to render Index Network notifications, replacing the dispatcher subagent. The plugin remains the broker for all backend interaction (fetching pending, scraping rendered output, confirming delivery), but the user-visible *render* happens inside the main agent's session and is delivered through the agent's active channel automatically.

## Non-goals

- Persona/voice quality is the user's concern (it lives in their main agent).
- Channel-specific rendering rules — the main agent's system prompt knows its channel.
- Replacing the negotiator turn-handler subagent. That stays silent.
- Wiring up the negotiation accept-notification path. See the note in "Content types using the new path".

---

## Architecture

### Render primitive

The plugin gains a single helper, `dispatchToMainAgent({ prompt, idempotencyKey, allowSuppress })`, with two internal paths:

1. **`api.runtime.agent.runEmbeddedAgent`** (SDK, in-process). Tried first.
2. **`POST /hooks/agent`** (HTTP loopback to `localhost:gatewayPort`) with `agentId: <main>`, `wakeMode: "now"`, `deliver: true`, `channel: "last"`. Used as fallback if SDK doesn't auto-deliver to the agent's chat channel.

Both paths produce the same return shape `{ deliveredText, suppressedByNoReply }`. The rest of the plugin is primitive-agnostic.

### Render mode

**Single-pass only.** The main agent receives the candidate batch, ranks, picks, and renders in one turn. No evaluator subagent. The user accepted the trade-off that selection fairness becomes the agent's responsibility (mitigated by the daily digest catching what ambient missed, and the backend `?limit=N` cap).

### Plugin remains the broker

```
        Backend                  Plugin                Main agent
           │                       │                       │
   pending ├──────GET /pending────►│                       │
           │     ?limit=10|20      │                       │
           │                       ├──dispatchToMainAgent─►│
           │                       │   (prompt + INPUT)    │  renders in voice
           │                       │                       │  (or NO_REPLY)
           │                       │◄────deliveredText─────┤
           │                       │                       │
           │                       │ if !suppressed:       │
           │                       │   confirmedIds =      │
           │                       │     scrape(text) ∩    │
           │                       │     candidateIds      │
           │◄──POST /:id/delivered─┤                       │
```

The main agent never talks to the backend.

### Content types using the new path

| Content type | `allowSuppress` | Notes |
|---|---|---|
| `daily_digest` | true | Up to 20 candidates; agent picks up to `digestMaxCount`. |
| `ambient_discovery` | true | Up to 10 candidates; agent surfaces only alert-worthy ones. |
| `test_message` | **false** | Delivery verification — `NO_REPLY` clause omitted from prompt. |

The negotiator **turn-handler** subagent (which calls `respond_to_negotiation` silently on the user's behalf) is **unchanged**.

**Note on `negotiation_accept`.** The README documents an accept-notification ("a single short line telling you who you're now connected with and why"), and the `'negotiation_accept'` content type plus an `acceptedPrompt` builder exist in code, but **the negotiator poller does not currently dispatch any accept notification** — those artifacts are orphaned. They will be removed alongside `delivery.prompt.ts`. Wiring an accept-notification path against the new `dispatchToMainAgent` helper is **out of scope for this design**; it can be added later as a small follow-up using the same primitive.

---

## Components

### Plugin (`packages/openclaw-plugin/`)

**New:**

- `src/lib/delivery/main-agent.dispatcher.ts` — `dispatchToMainAgent({ prompt, idempotencyKey, allowSuppress })`. Internally tries `runEmbeddedAgent` then `/hooks/agent`. Returns `{ deliveredText, suppressedByNoReply }`. Owns NO_REPLY detection.
- `src/lib/delivery/main-agent.prompt.ts` — per-content-type prompt builders (see "Prompts" below).

**Modified pollers** (each replaces its dispatcher call with `dispatchToMainAgent`):

- `src/polling/daily-digest/daily-digest.poller.ts`
- `src/polling/ambient-discovery/ambient-discovery.poller.ts`
- `src/polling/test-message/test-message.poller.ts`

The first two end with: `if (!suppressedByNoReply) confirmDeliveredBatch(extractSelectedIds(deliveredText, candidateIds))`. Test-message uses its own pickup/confirm pair.

The negotiator poller is **unchanged** — its silent turn-handler subagent remains as-is. The orphaned `negotiation-accepted.prompt.ts` file is removed.

**Modified config + setup:**

- `openclaw.plugin.json` — remove `deliveryChannel`, `deliveryTarget`. Add `mainAgentToolUse: "disabled" | "enabled"` (default `"disabled"`). Change `digestMaxCount` default from `"10"` to `"20"`.
- `src/setup/setup.cli.ts` — remove the entire delivery-channel block. Add a `select` for `mainAgentToolUse` after the digest config. Update `digestMaxCount` default surfacing to `20`. (`agentId` is still resolved from `GET /api/agents/me`; that flow is unchanged.)
- `src/index.ts` — read `mainAgentToolUse`, pass into the prompt builder. Drop unused `gatewayPort`/`gatewayToken` plumbing once SDK path is verified; keep until then for hooks fallback.

**Removed:**

- `src/lib/delivery/delivery.dispatcher.ts`
- `src/lib/delivery/delivery.prompt.ts`
- `src/polling/daily-digest/digest-evaluator.prompt.ts`
- `src/polling/ambient-discovery/opportunity-evaluator.prompt.ts`
- `src/polling/negotiator/negotiation-accepted.prompt.ts` (orphaned — see note above)
- `src/tests/accepted.prompt.spec.ts` (tests the orphaned prompt)
- All Phase-1 evaluator subagent invocations inside the digest and ambient pollers
- Tests under `src/tests/lib/delivery/` referencing the dispatcher

**Updated docs:**

- `README.md` — rewrite "Automatic opportunity delivery" + "Daily Digest" sections. Drop Telegram-specific examples. Replace with: *"Index Network notifications are rendered by your main OpenClaw agent in its own voice, on whatever channel you currently use it on."*

### Backend (`backend/`)

- Opportunities controller — `GET /api/agents/:agentId/opportunities/pending` accepts optional `?limit=N` query parameter. Validate as positive integer; clamp server-side to `[1, 20]`. Reject non-integer / `<= 0` with HTTP 400.
- Service-layer test for the new param.

### Frontend (`frontend/src/app/agents/[id]/page.tsx`)

The agent detail page renders a copyable preview of the setup wizard for users who run setup outside an LLM (per the `MIRROR:` comment in `setup.cli.ts`). Update `WizardPromptGrid` and `SetupInstructions`:

- Remove the delivery-channel and delivery-target rows.
- Add a `mainAgentToolUse` row with the same two-option select and copy.
- Update the displayed default for `digestMaxCount` to `20`.

### Protocol package (`packages/protocol/`)

No changes expected. Agent graphs/tools don't reference `/opportunities/pending`. If audit during implementation reveals a touchpoint, the same `limit` plumbing flows through and the package gets a version bump.

### Version bumps (per CLAUDE.md)

- `packages/openclaw-plugin/package.json` AND `openclaw.plugin.json` to the same version. Bump both — mismatch is a silent foot-gun.
- `backend/`: no separate package bump (not an npm package).

---

## Data flow

### Daily digest / ambient discovery

```
1. plugin: GET /opportunities/pending?limit=20 (digest) or ?limit=10 (ambient)
2. plugin: dispatchToMainAgent({
             prompt: mainAgentPrompt({ contentType, candidates, maxToSurface, mainAgentToolUse }),
             idempotencyKey: `index:delivery:${contentType}:${agentId}:${dateStr}:${batchHash}`,
             allowSuppress: true,
           })
3. helper: try runEmbeddedAgent → fall back to POST /hooks/agent if needed
4. helper: returns { deliveredText, suppressedByNoReply }
5. plugin: if suppressedByNoReply → log, done
   else → confirmedIds = extractSelectedIds(deliveredText, candidateIds)
6. plugin: confirmDeliveredBatch(confirmedIds)
```

### Test message

```
1. plugin: POST /test-messages/pickup → reservation (60s TTL) + content
2. plugin: dispatchToMainAgent({
             prompt: mainAgentPrompt({ contentType: 'test_message', content, mainAgentToolUse }),
             idempotencyKey,
             allowSuppress: false,
           })
3. helper: dispatch as above
4. plugin: if NO_REPLY → log error (prompt forbade it), let reservation expire
   else → confirm via existing test-message confirm endpoint
```

### Negotiation accept

Out of scope for this design — see the note in the "Content types" section. The negotiator turn-handler subagent continues to run silently, unchanged.

### Idempotency

`runEmbeddedAgent` does not expose an `idempotencyKey` parameter. Two layers of dedup:

1. **Plugin-level** — preserve today's `lastOpportunityBatchHash` in the ambient poller. Identical batches do not trigger a fresh dispatch.
2. **Per-call** — derive a stable `runId` from `agentId + contentType + dateStr + batchHash`. When the helper falls through to `/hooks/agent`, this becomes the request's idempotency identifier (header or session-key suffix, whichever the gateway supports without `allowRequestSessionKey: true`).

The startup-nonce technique used today (`Date.now().toString(36)`) is no longer needed and is dropped.

---

## Setup wizard (final flow)

```
Index Network URL [https://index.network]:
API key:
  → resolves agentId silently via GET /api/agents/me
Daily digest:
  1. Enabled (default)
  2. Disabled
[if enabled]
  Digest time (HH:MM, 24-hour local time) [08:00]:
  Max opportunities per digest [20]:
Main agent tool use during Index Network renders:
  1. Disabled — agent renders from provided content only (default)
  2. Enabled — agent may call MCP tools to enrich
```

`agentId` is read at runtime by `src/index.ts`; the schema retains the key so the plugin can read it. `deliveryChannel`/`deliveryTarget` left in stale configs are inert — the plugin reads neither. No migration script.

### `openclaw.plugin.json` configSchema (final)

```json
{
  "agentId": { "type": "string" },
  "apiKey":  { "type": "string" },
  "url":     { "type": "string", "format": "uri", "default": "https://index.network" },
  "protocolUrl": { "type": "string", "description": "Deprecated — migrated to 'url' on next setup run." },

  "mainAgentToolUse": {
    "type": "string",
    "enum": ["disabled", "enabled"],
    "default": "disabled",
    "description": "If 'enabled', the main agent may call tools while rendering Index Network notifications."
  },

  "negotiationMode": { "type": "string", "enum": ["enabled", "disabled"], "default": "enabled" },

  "digestEnabled":  { "type": "string", "enum": ["true", "false"], "default": "true" },
  "digestTime":     { "type": "string", "default": "08:00" },
  "digestMaxCount": { "type": "string", "default": "20" }
}
```

---

## Prompts

### Shared skeleton

```
INDEX NETWORK NOTIFICATION
You are speaking to the user in your own voice, on their active channel.

[Tool-use clause]
  if mainAgentToolUse=disabled (default):
    Do not call any tools. Everything you need is in INPUT below.
  if mainAgentToolUse=enabled:
    You may call Index Network MCP tools to enrich. Stay brief — the user is waiting.

[URL preservation clause]
For any opportunity you decide to surface, include its acceptUrl and skipUrl exactly
as given. Link the person's name to their profileUrl. Do not reword, shorten, or
omit URLs. If you decide not to mention an opportunity, simply leave it out — do not
output its data without an action link.

[NO_REPLY clause — included when allowSuppress=true; OMITTED for test_message]
If this is a poor moment — user is mid-conversation on something else, has asked for
quiet, or this feels mistimed — output exactly `NO_REPLY` as your entire reply. The
runtime will suppress delivery; the items will roll over.

[Content-type instruction]
<see per-type below>

===== INPUT =====
<JSON payload>
===== END INPUT =====
```

### Per-content-type instruction

- **`daily_digest`** — "Rank the candidates, pick up to *${maxToSurface}* to surface, render as a numbered digest in your voice. The user is scanning at digest time. If none feel worth a digest today, NO_REPLY."
- **`ambient_discovery`** — "Real-time alert, not a digest. Surface only candidates worth interrupting for *right now*. If none qualify, NO_REPLY. Otherwise render briefly."
- **`test_message`** — "Delivery verification. Render the content below in your voice. Do not suppress."

### What the prompt deliberately excludes

- **Channel-specific formatting rules** (Telegram markdown, etc.) — main agent's system prompt knows its channel.
- **Persona instructions** — persona lives in the agent.
- **Selection criteria** — backend ordering + agent judgment do the work.

### `INPUT` payload shapes

```ts
// daily_digest, ambient_discovery
{
  contentType: "daily_digest" | "ambient_discovery",
  maxToSurface: number,
  candidates: Array<{
    opportunityId: string,
    counterpartUserId: string,
    headline: string,
    personalizedSummary: string,
    suggestedAction: string,
    narratorRemark: string,
    profileUrl: string,
    acceptUrl: string,
    skipUrl: string,
  }>
}

// test_message
{
  contentType: "test_message",
  content: string,
}
```

---

## Error handling

The invariant: **never confirm an opportunity the user didn't actually see.** Every failure defaults to "don't confirm; let it roll over."

| Failure | Detection | Plugin action |
|---|---|---|
| `runEmbeddedAgent` throws / unavailable | helper catches | transparent fallback to `/hooks/agent` |
| Both SDK and hooks fail | helper returns error | log warn, skip confirm, mark cycle `network_error` for backoff |
| Main agent turn times out | timeout in helper | log, skip confirm, backoff |
| Main agent emits `NO_REPLY` | first non-whitespace token matches `no_reply` (case-insensitive, also `noreply`) | log info "suppressed by agent", skip confirm, **no backoff** |
| Main agent emits empty/whitespace | `deliveredText.trim() === ''` | soft suppression, skip confirm, no backoff |
| Rendered text contains no recognizable IDs | `extractSelectedIds(text, batchIds).length === 0` | log debug, skip confirm, no backoff |
| Rendered text references IDs not in batch | intersection clamp | silently dropped — only known IDs reach confirm |
| `/pending` fetch fails | HTTP error | log warn, return `network_error`, backoff |
| `confirmDeliveredBatch` fails | per-id HTTP error | best-effort, logged; opportunities re-surface next cycle |
| `mainAgentToolUse=enabled` and a tool call errors | bubbles into agent turn timeout | same as turn timeout |
| Test-message: agent emits `NO_REPLY` despite prompt | NO_REPLY detected on `test_message` | log **error**, reservation expires, backend retries |
| Setup: `GET /agents/me` fails | already handled in `defaultFetchAgentId` | unchanged — user-readable error, non-zero exit |

### Backoff

Today's `*.scheduler.ts` modules double the poll interval up to ~8 min on `network_error` and reset on success. **Dispatch helper failures count as `network_error`**; `NO_REPLY` and empty/no-id renders **do not** — those are intentional agent decisions.

### Stale-config tolerance

After upgrade, users with `deliveryChannel` / `deliveryTarget` still in their config see no error — the plugin doesn't read those keys. Inert config; no migration script.

### Implementation-time unknowns the design accommodates

1. **`runEmbeddedAgent` delivery semantics.** Helper tries SDK first, falls to hooks if delivery doesn't happen. Both produce the same shape so the rest of the code is primitive-agnostic.
2. **`hooks.allowRequestSessionKey`.** Default to letting OpenClaw choose the session key (no custom `sessionKey` field on the hooks call) so no operator opt-in is required.
3. **`NO_REPLY` detection robustness.** Trim + lowercase the first 12 chars and check for `no_reply` or `noreply`.

---

## Testing

### Unit — plugin

**`main-agent.dispatcher.ts`** (new):

- SDK happy path returns `{ deliveredText, suppressedByNoReply: false }`.
- SDK throws → falls through to mocked `/hooks/agent`; same shape.
- Both fail → error / null.
- NO_REPLY detection: `NO_REPLY`, `no_reply`, ` NO_REPLY\n`, `NoReply…`, `NO_REPLY followed by content` → all set `suppressedByNoReply: true`.
- Empty / whitespace text → `suppressedByNoReply: true`.

**`main-agent.prompt.ts`** (new):

- Per content type: rendered prompt contains expected blocks.
- `mainAgentToolUse=disabled` → "Do not call any tools" present.
- `mainAgentToolUse=enabled` → permissive clause present.
- `daily_digest` / `ambient_discovery` → NO_REPLY clause present.
- `test_message` → NO_REPLY clause **absent**.
- `INPUT` block parses as valid JSON with expected keys.

### Unit — pollers

For each of `daily-digest`, `ambient-discovery`, and `test-message`:

| Scenario | Expected |
|---|---|
| Happy path | dispatch called once, `confirmDeliveredBatch` called with scraped IDs |
| NO_REPLY suppression | dispatch called, no confirm calls, no error log |
| Empty text | dispatch called, no confirm |
| Rendered text without recognizable IDs | dispatch called, no confirm |
| `/pending` returns empty | no dispatch, no confirm |
| `/pending` returns network error | no dispatch, scheduler `network_error` signaled |
| Batch hash matches last cycle (ambient) | no dispatch, no confirm |
| Test-message gets NO_REPLY despite prompt | error logged, no confirm |

Mocks: `api.runtime.agent.runEmbeddedAgent`, `fetch` (backend + hooks fallback), `api.logger`.

### Unit — setup wizard

- Remove delivery-channel / delivery-target prompt assertions.
- `mainAgentToolUse` prompt appears with two options; selected value written to config.
- `digestMaxCount` default surfaces as `20`.
- Existing `deliveryChannel` in input config: wizard does not error; values are not touched.
- `fetchAgentId` resolves and writes `agentId` (regression-protect).

### Backend — `?limit`

- Omitted → response unchanged.
- `limit=10` → at most 10 returned.
- `limit=20` → at most 20 returned.
- `limit=21` → server clamps to 20.
- `limit=0` / negative / non-integer → 400.

### Integration / manual verification

Three end-to-end checks before merging, against a real OpenClaw + dev backend:

1. **Voice carry-through.** Personalized OpenClaw agent (e.g. flirty test agent). Trigger a digest manually. Verify it reaches Telegram in *that* agent's voice.
2. **Test-message round-trip.** Send a test message from the backend. Verify rendered + ledger marks delivered.
3. **NO_REPLY suppression.** Wedge `NO_REPLY` into the agent's reply. Trigger a digest. Verify nothing reaches the user, no opportunities confirmed, same opportunities still pending afterwards.

### Out of scope for tests

- Persona/voice quality.
- Channel-specific rendering correctness (Telegram markdown, etc.).
- `runEmbeddedAgent` host implementation behavior.

---

## Decisions that shaped this design

- **Mode B (single-pass), not Mode A (with evaluator).** No extra agents. Selection fairness becomes the agent's responsibility, mitigated by the daily digest as a sweep.
- **Render-only by default; `mainAgentToolUse` knob.** Tool calls disabled in the v1 prompt for predictability. Knob exposed for users who want enrichment.
- **Confirm via scrape from rendered text.** Keeps the ledger honest about what the user actually saw. The intersection clamp prevents hallucinated IDs from leaking through.
- **Plugin remains the broker.** Main agent never talks to the backend. Bookkeeping is mechanical; agent only renders.
- **No per-channel formatting in the prompt.** Main agent already knows its channel from its system prompt.
- **Approach 1 first, Approach 2 fallback** for the dispatch primitive. Both behind the same helper interface; choice resolved at implementation time based on whether `runEmbeddedAgent` auto-delivers.
- **`deliveryChannel`/`deliveryTarget` removed without migration.** Stale config is inert; no script needed.
- **`?limit=N` defaults: 10 ambient, 20 digest.** Server caps at 20.
