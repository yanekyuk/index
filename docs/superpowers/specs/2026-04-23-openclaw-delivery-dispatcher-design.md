# Delivery Dispatcher — Unified Channel Control

**Date:** 2026-04-23
**Status:** Approved

## Problem

All polling processes that send messages to the user bypass the delivery dispatcher:

- `ambient-discovery.poller.ts` calls `api.runtime.subagent.run` directly with `deliver: true`, with Telegram-specific formatting hardcoded in `opportunityEvaluatorPrompt`
- `daily-digest.poller.ts` does the same via `digestEvaluatorPrompt`
- `test-message.poller.ts` already goes through `dispatchDelivery`, but uses a `rendered: { headline, body }` shape that is not composable

Styling is scattered, channel-specific language is baked into evaluator prompts, and there is no single place to control how messages look across channels.

## Goal

Route all user-visible output through `dispatchDelivery`. The dispatcher is the only place that sets `deliver: true`. Evaluator prompts contain zero formatting language. Adding or changing a channel requires editing one function.

---

## Architecture — Two-Phase Pipeline

### Phase 1 — Evaluator subagent (`deliver: false`)

Runs in its own persistent session (keyed per poller type + agentId). Evaluates candidates, calls `confirm_opportunity_delivery` for the ones it selects, and outputs plain content with no formatting instructions. The poller then calls `waitForRun` followed by `getSessionMessages` to capture the output text.

### Phase 2 — Dispatcher (`deliver: true`)

The poller passes the captured content to `dispatchDelivery` along with `channel`, `contentType`, and an `idempotencyKey`. The dispatcher builds a composable prompt (base instructions + temporal awareness + channel style + content-type context + content) and runs the delivery subagent with `deliver: true` against the channel session key.

**`dispatchDelivery` is the only place in the codebase that calls `subagent.run` with `deliver: true`.**

The delivery session (`agent:main:<channel>:direct:<target>`) is shared across all content types, so the delivery subagent sees the full history of everything already sent to the user.

---

## Component Changes

### `plugin-api.ts`

Extend `SubagentRuntime` with `waitForRun` and `getSessionMessages` to match the actual OpenClaw SDK:

```ts
interface WaitForRunOptions {
  runId: string;
  timeoutMs: number;
}

interface GetSessionMessagesOptions {
  sessionKey: string;
  limit?: number;
}

interface SessionMessage {
  role: string;
  content: string;
}

interface SubagentRuntime {
  run(options: SubagentRunOptions): Promise<SubagentRunResult>;
  waitForRun(options: WaitForRunOptions): Promise<{ result: unknown }>;
  getSessionMessages(options: GetSessionMessagesOptions): Promise<{ messages: SessionMessage[] }>;
}
```

### `delivery.dispatcher.ts`

Replace the `rendered: { headline, body }` shape with a composable `DeliveryRequest`:

```ts
export interface DeliveryRequest {
  channel: 'telegram';    // extensible to other channels later
  contentType: 'ambient_discovery' | 'daily_digest' | 'test_message' | 'negotiation_accept';
  content: string;        // free-form plain text from the evaluator
  idempotencyKey: string;
}
```

`dispatchDelivery` resolves the session key, reads the model, builds the prompt via `buildDispatcherPrompt`, and runs the delivery subagent with `deliver: true`.

### `delivery.prompt.ts`

New `buildDispatcherPrompt(request: DeliveryRequest): string` — composable from three layers:

1. **Base + temporal awareness** (all content types):
   > "You are delivering a message to the user via their active OpenClaw gateway. Before delivering, scan your conversation history. If the same or highly similar content was already sent recently, skip it or do not repeat it. Prioritize novelty — only deliver what adds new value to the user."

2. **Channel style block** (keyed on `channel`):
   - `telegram`: concise, chat-friendly, no markdown tables, bold for headlines where appropriate

3. **Content-type context block** (keyed on `contentType`):
   - `ambient_discovery`: real-time opportunity alert, surface only signal-rich matches
   - `daily_digest`: scheduled digest of ranked opportunities
   - `test_message`: delivery verification message — relay faithfully
   - `negotiation_accept`: negotiation outcome notification — one short natural sentence

4. **Content**: the plain evaluated text passed in

### Evaluator prompts

`opportunity-evaluator.prompt.ts` and `digest-evaluator.prompt.ts` — remove all formatting/styling language:
- Remove: "Telegram-friendly", "no markdown tables", "bold headline", "one paragraph per opportunity", "numbered entry", emoji headers (`📬 **Daily Digest**`)
- Keep: evaluation logic, candidate scoring, `confirm_opportunity_delivery` call ordering

### `ambient-discovery.poller.ts`

Refactored to two-phase:

```ts
// Phase 1 — evaluate
const { runId } = await api.runtime.subagent.run({
  sessionKey: `index:ambient-discovery:${config.agentId}`,
  idempotencyKey: `index:eval:opportunity-batch:${config.agentId}:${dateStr}:${batchHash}`,
  message: opportunityEvaluatorPrompt(candidates),
  deliver: false,
  model,
});
await api.runtime.subagent.waitForRun({ runId, timeoutMs: 120_000 });
const { messages } = await api.runtime.subagent.getSessionMessages({
  sessionKey: `index:ambient-discovery:${config.agentId}`,
  limit: 1,
});
const content = messages.at(-1)?.content ?? '';
if (!content) return false;

// Phase 2 — dispatch
await dispatchDelivery(api, {
  channel: 'telegram',
  contentType: 'ambient_discovery',
  content,
  idempotencyKey: `index:delivery:opportunity-batch:${config.agentId}:${dateStr}:${batchHash}`,
});
```

### `daily-digest.poller.ts`

Same two-phase pattern. Evaluator session key: `index:daily-digest:${agentId}:${dateStr}` (fresh session per day — no history carryover between digest runs).

### `test-message.poller.ts`

Updated to use the new `DeliveryRequest` shape:

```ts
await dispatchDelivery(api, {
  channel: 'telegram',
  contentType: 'test_message',
  content: body.content,
  idempotencyKey: `index:delivery:test:${body.id}:${body.reservationToken}`,
});
```

### `negotiator.poller.ts`

No changes. When personal agent permissions are re-enabled, the accepted-notification path will follow the same two-phase pattern with `contentType: 'negotiation_accept'`.

---

## Session Key Summary

| Session | Key | History |
|---|---|---|
| Ambient evaluator | `index:ambient-discovery:${agentId}` | Persistent across polls |
| Digest evaluator | `index:daily-digest:${agentId}:${dateStr}` | Fresh per day |
| Delivery (all types) | `agent:main:telegram:direct:${target}` | Shared, persistent — enables temporal awareness |

---

## Temporal Awareness

The delivery session accumulates the full history of everything sent to the user, regardless of content type. The base dispatcher prompt instructs the delivery subagent to consult this history before delivering, skipping content that was already sent recently. This prevents both within-session duplicates and cross-content-type spam (e.g., the same opportunity surfaced in both ambient-discovery and the next morning's digest).
