# OpenClaw Personal Negotiator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `@indexnetwork/openclaw-plugin` from a bootstrap-only skill into an end-to-end personal negotiator that catches Index Network negotiation webhooks, runs silent background subagents via OpenClaw's SDK, and only posts a user-facing message when a negotiation is accepted.

**Architecture:** The plugin registers a single `api.registerHttpRoute` handler at `/index-network/webhook` with `auth: "plugin"` on the OpenClaw gateway. The handler reads the `X-Index-Event` header and dispatches: `negotiation.turn_received` verifies HMAC and launches a silent subagent (`deliver: false`) that calls `get_negotiation` + `respond_to_negotiation` via MCP; `negotiation.completed` verifies HMAC and surfaces only `outcome.hasOpportunity === true` completions as one short message via a `deliver: true` subagent. A single-route design is required because Index Network's `register_agent` MCP tool creates one agent with exactly one webhook transport (see Task 0 research note). Zero protocol-side changes — the negotiation graph, AgentDispatcher, AgentDeliveryService, and webhook worker are already wired.

**Tech Stack:** TypeScript (Node 22+), OpenClaw plugin SDK, Bun test runner, node:crypto for HMAC, Node HTTP IncomingMessage semantics in the route handlers. The design spec is at `docs/superpowers/specs/2026-04-11-openclaw-personal-negotiator-design.md` — read it before starting.

**Reference facts pinned from source:**
- Webhook delivery signs body `JSON.stringify({ event, payload, timestamp })` (wrapper, not just payload) and sends headers `X-Index-Signature: sha256=<hex>` and `X-Index-Event: <event>`. Source: `backend/src/queues/webhook.queue.ts:140-153`.
- Webhook worker request timeout is 5 seconds — the plugin handler must ACK within that window.
- Bootstrap skill template tokens are compiled by `scripts/build-skills.ts`. New tokens must be added to the `TOKENS` map for both `main` and `dev` environments or the build fails.
- Plugin IDs throughout the codebase: plugin id is `indexnetwork-openclaw-plugin`; OpenClaw config path for plugin config is `plugins.entries.indexnetwork-openclaw-plugin.config.*`.
- MCP instructions string lives in `packages/protocol/src/mcp/mcp.server.ts` — the exported `MCP_INSTRUCTIONS` constant.

---

## File Structure

### New files
- `packages/openclaw-plugin/src/webhook/verify.ts` — HMAC verifier + raw body reader.
- `packages/openclaw-plugin/src/webhook/types.ts` — Payload types for `negotiation.turn_received` and `negotiation.completed`.
- `packages/openclaw-plugin/src/prompts/turn.prompt.ts` — Turn-handling subagent prompt builder.
- `packages/openclaw-plugin/src/prompts/accepted.prompt.ts` — Accepted-notification subagent prompt builder.
- `packages/openclaw-plugin/src/plugin-api.ts` — Minimal type shape for the `OpenClawPluginApi` surface we depend on (decouples us from guessing the SDK import path until Task 0 resolves it).
- `packages/openclaw-plugin/src/tests/verify.spec.ts` — Verifier tests.
- `packages/openclaw-plugin/src/tests/turn.prompt.spec.ts` — Turn prompt snapshot tests.
- `packages/openclaw-plugin/src/tests/accepted.prompt.spec.ts` — Accepted prompt snapshot tests.
- `packages/openclaw-plugin/src/tests/index.spec.ts` — Plugin entry point behavior tests with a mocked api object.
- `packages/openclaw-plugin/src/tests/helpers/mock-http.ts` — Test helpers for faking Node HTTP req/res.
- `docs/superpowers/plans/2026-04-11-openclaw-personal-negotiator-research.md` — Research output from Task 0.

### Modified files
- `packages/openclaw-plugin/package.json` — Add scripts + dev deps.
- `packages/openclaw-plugin/openclaw.plugin.json` — Add `gatewayUrl`, `webhookSecret`, and `negotiationMode` to `configSchema.properties` so OpenClaw validates and exposes them via `api.pluginConfig`.
- `packages/openclaw-plugin/tsconfig.json` — Include tests directory.
- `packages/openclaw-plugin/src/index.ts` — Full rewrite from stub to real plugin entry point.
- `packages/openclaw-plugin/README.md` — Add negotiation subagent section.
- `packages/protocol/src/mcp/mcp.server.ts` — Add "Negotiation turn mode" paragraph to `MCP_INSTRUCTIONS`.
- `packages/protocol/skills/openclaw/SKILL.md.template` — Add webhook transport registration block.
- `packages/openclaw-plugin/skills/openclaw/SKILL.md` — Regenerated from template.
- `skills/openclaw/SKILL.md` — Regenerated from template (gitignored; regenerated for local dev).
- `scripts/build-skills.ts` — Add any new tokens to `TokenSet` interface + `TOKENS` map if the template introduces them.
- `scripts/tests/build-skills.test.ts` — Adjust tests if `TokenSet` shape changes.

### Architectural note — post Task 0 correction

Task 0's SDK discovery surfaced a constraint: Index Network's `register_agent` MCP tool creates **one agent with at most one webhook transport**. There is no `add_transport` tool, and `webhook_events` is a single array. This means the user's personal OpenClaw agent registers **one** transport with **both** events (`negotiation.turn_received` and `negotiation.completed`) pointing at **one** plugin URL. The plugin therefore exposes a **single HTTP route** — `/index-network/webhook` — and dispatches internally by reading the `X-Index-Event` header before running HMAC verification with the matching expected event. Tasks 8, 9, and 11 below reflect this single-route design; the HMAC verifier from Tasks 2–3 is unchanged.

---

## Task 0: SDK Discovery — Resolve Spec Open Questions

**Goal:** Before writing any code, resolve the load-bearing open questions from the spec's "Open questions to resolve during implementation" section. Document findings in a short research note. If any finding invalidates the design, STOP and escalate.

**Files:**
- Create: `docs/superpowers/plans/2026-04-11-openclaw-personal-negotiator-research.md`

- [ ] **Step 1: Find the published OpenClaw plugin SDK package**

Check on npm and in the OpenClaw docs (Context7 lookups are fine, or fetch `https://www.npmjs.com/search?q=openclaw` results if available). Record:
- Exact package name (likely something under `@openclaw/*`).
- Exported types for `OpenClawPluginApi`, `PluginRuntime`, `SubagentRuntime`, `RouteOptions`.
- Whether `register(api)` is the default export or a named export.

- [ ] **Step 2: Confirm subagent MCP tool inheritance (load-bearing)**

From the SDK docs or source: when `api.runtime.subagent.run({ sessionKey, message })` is invoked from a plugin, does the subagent have access to MCP tools registered on the parent OpenClaw instance?

Document one of:
- **CONFIRMED**: subagents inherit parent MCP tools with the same auth. Cite source.
- **CONDITIONAL**: they inherit with configuration X. Document X.
- **NOT SUPPORTED**: they do not. **STOP — escalate.** Design collapses, revisit the standalone-receiver fallback.

- [ ] **Step 3: Confirm `api.runtime.subagent.run` signature**

Document the actual type signature. Confirm:
- Does it accept `deliver: boolean`? Default?
- Does it accept a `channel` parameter? If not, how does `deliver: true` pick a channel?
- Does it return a promise? Resolves when the subagent is spawned, or when it finishes?
- Does it throw on spawn failure, or return an error result?

- [ ] **Step 4: Confirm `api.registerHttpRoute` semantics**

Document:
- Exact `RouteOptions` type (path, auth, match, handler signature).
- Whether the handler receives Node HTTP `IncomingMessage` / `ServerResponse`, Web Fetch `Request` / `Response`, or an OpenClaw-specific wrapper.
- Whether the handler must return `true` explicitly, and what return-value semantics mean.
- Whether `auth: "plugin"` gives us the raw request body stream or a pre-parsed body.

- [ ] **Step 5: Confirm tunnel / gateway public URL exposure**

Document:
- Is there a field on `api.config` or `api.runtime` that exposes the current public URL of the OpenClaw gateway (e.g. the ngrok URL)?
- If not, what does the bootstrap skill prompt the user for?

- [ ] **Step 6: Confirm Index Network `register_agent` transport shape**

From `packages/protocol/src/agent/agent.tools.ts` or the MCP tool registry, read the `register_agent` input schema. Document:
- Can one call register multiple transports, or must you call it once per transport?
- What are the exact field names for webhook transport (url, secret, events)?
- How is the `manage:negotiations` permission granted — as part of `register_agent`, or via a separate `grant_agent_permission` call?

- [ ] **Step 7: Write findings to the research note**

Create `docs/superpowers/plans/2026-04-11-openclaw-personal-negotiator-research.md` with one section per step above. Each section has: the question, the answer, the source (file path or URL), and the implication for this plan. If any answer changes how subsequent tasks should be written, note it explicitly.

- [ ] **Step 8: Commit the research note**

```bash
git add docs/superpowers/plans/2026-04-11-openclaw-personal-negotiator-research.md
git commit -m "docs(openclaw-plugin): record SDK discovery findings for personal negotiator"
```

**Gate:** Do not proceed to Task 1 unless Step 2 is CONFIRMED or CONDITIONAL. If NOT SUPPORTED, stop the plan and ask the user which fallback path they want.

---

## Task 1: Plugin Package Scaffolding

**Goal:** Add test runner, SDK typing dependency, and a test script to the plugin package so subsequent tasks can run tests.

**Files:**
- Modify: `packages/openclaw-plugin/package.json`
- Modify: `packages/openclaw-plugin/tsconfig.json`
- Create: `packages/openclaw-plugin/src/plugin-api.ts`

- [ ] **Step 1: Update `package.json` with test script and dev deps**

Open `packages/openclaw-plugin/package.json` and add/update:

```json
{
  "name": "@indexnetwork/openclaw-plugin",
  "version": "0.1.0",
  "description": "Index Network — OpenClaw plugin. Registers the Index Network MCP server and hands off to its guidance.",
  "license": "MIT",
  "private": false,
  "type": "module",
  "main": "./src/index.ts",
  "files": [
    "openclaw.plugin.json",
    "src",
    "skills",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "test": "bun test src/tests",
    "test:watch": "bun test --watch src/tests"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.5.0"
  },
  "openclaw": {
    "extensions": ["./src/index.ts"],
    "compat": {
      "openclaw": ">=0.1.0"
    }
  },
  "engines": {
    "node": ">=22"
  }
}
```

If Task 0 Step 1 surfaced a real SDK package name, add it to `devDependencies` (types only — the plugin does not bundle the SDK).

- [ ] **Step 2: Update `tsconfig.json` to include tests**

Current file has `"include": ["src/**/*", "openclaw.plugin.json"]` — this already covers `src/tests`, so no change needed. Verify by running:

```bash
cd packages/openclaw-plugin && bunx tsc --noEmit
```

Expected: no errors (empty project today).

- [ ] **Step 3: Create minimal `plugin-api.ts` type shape**

Create `packages/openclaw-plugin/src/plugin-api.ts`:

```ts
/**
 * Minimal type shape for the subset of OpenClawPluginApi we depend on.
 * If/when we import real types from @openclaw/plugin-sdk, replace these
 * with re-exports. Keeping this file thin lets us unit-test the plugin
 * without pulling in the SDK runtime.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface PluginLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface SubagentRunOptions {
  sessionKey: string;
  message: string;
  provider?: string;
  model?: string;
  deliver?: boolean;
}

export interface SubagentRunResult {
  runId: string;
}

export interface SubagentRuntime {
  run(options: SubagentRunOptions): Promise<SubagentRunResult>;
}

export interface PluginRuntime {
  subagent: SubagentRuntime;
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean> | boolean;

export interface RouteOptions {
  path: string;
  auth: 'gateway' | 'plugin';
  match?: 'exact' | 'prefix';
  replaceExisting?: boolean;
  handler: RouteHandler;
}

export interface OpenClawPluginApi {
  id: string;
  name: string;
  pluginConfig: Record<string, unknown>;
  runtime: PluginRuntime;
  logger: PluginLogger;
  registerHttpRoute(options: RouteOptions): void;
}
```

If Task 0 resolved the real SDK shape and it differs, reconcile here — either re-export from the SDK or adjust field names.

- [ ] **Step 4: Verify typecheck still passes**

```bash
cd packages/openclaw-plugin && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Update `openclaw.plugin.json` configSchema**

Open `packages/openclaw-plugin/openclaw.plugin.json`. Replace the empty `configSchema` with:

```json
{
  "id": "indexnetwork-openclaw-plugin",
  "name": "Index Network",
  "description": "Index Network — find the right people and let them find you. Registers the Index Network MCP server on first use and hands off to its guidance.",
  "version": "0.1.0",
  "configSchema": {
    "type": "object",
    "properties": {
      "gatewayUrl": {
        "type": "string",
        "format": "uri",
        "description": "Public URL of your OpenClaw gateway (e.g. your ngrok URL). Used as the base URL for webhook transports registered on your Index Network personal agent."
      },
      "webhookSecret": {
        "type": "string",
        "description": "Shared HMAC secret between Index Network and this plugin. Generated by the bootstrap skill when enabling automatic negotiations."
      },
      "negotiationMode": {
        "type": "string",
        "enum": ["enabled", "disabled"],
        "default": "enabled",
        "description": "When set to \"disabled\", turn webhooks are acknowledged without running a subagent — Index Network falls back to its system Index Negotiator. Accepted-notification messages still fire."
      }
    },
    "additionalProperties": false
  },
  "skills": ["./skills"]
}
```

Rationale: OpenClaw validates `plugins.entries.<id>.config` against `configSchema` before exposing it as `api.pluginConfig`. Without these entries, users can set the values but OpenClaw may strip them or refuse to load the plugin.

- [ ] **Step 6: Commit**

```bash
git add packages/openclaw-plugin/package.json packages/openclaw-plugin/openclaw.plugin.json packages/openclaw-plugin/src/plugin-api.ts
git commit -m "chore(openclaw-plugin): scaffold test script, plugin api types, and negotiator config schema"
```

---

## Task 2: HMAC Verifier — Write Failing Tests

**Goal:** Write the full test suite for the HMAC verifier before implementing it. Every edge case from the spec's "Auth and security" + "Error handling" sections is covered.

**Files:**
- Create: `packages/openclaw-plugin/src/tests/helpers/mock-http.ts`
- Create: `packages/openclaw-plugin/src/tests/verify.spec.ts`

- [ ] **Step 1: Create the mock HTTP helper**

Create `packages/openclaw-plugin/src/tests/helpers/mock-http.ts`:

```ts
/**
 * Minimal Node IncomingMessage simulator for unit-testing HTTP route handlers.
 * Real IncomingMessage extends Readable; the verifier only needs `headers` and
 * the ability to read the body via `req.on('data', ...)` + `req.on('end', ...)`.
 */

import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';

export function mockRequest(opts: {
  headers: Record<string, string>;
  body: string | Buffer;
}): IncomingMessage {
  const emitter = new EventEmitter() as EventEmitter & {
    headers: Record<string, string>;
  };
  emitter.headers = opts.headers;
  const bodyBuffer = typeof opts.body === 'string' ? Buffer.from(opts.body, 'utf8') : opts.body;

  queueMicrotask(() => {
    emitter.emit('data', bodyBuffer);
    emitter.emit('end');
  });

  return emitter as unknown as IncomingMessage;
}
```

- [ ] **Step 2: Write the verifier test suite**

Create `packages/openclaw-plugin/src/tests/verify.spec.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';

import { verifyAndParse } from '../webhook/verify.js';
import { mockRequest } from './helpers/mock-http.js';

const SECRET = 'test-secret-abcdefghijklmnopqrstuvwx';

function signBody(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function buildSignedRequest(event: string, payload: Record<string, unknown>, secret: string) {
  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  return mockRequest({
    headers: {
      'x-index-signature': signBody(body, secret),
      'x-index-event': event,
      'content-type': 'application/json',
    },
    body,
  });
}

describe('verifyAndParse', () => {
  test('returns parsed payload on valid signature and matching event', async () => {
    const req = buildSignedRequest('negotiation.turn_received', { negotiationId: 'neg-1', turnNumber: 1 }, SECRET);
    const result = await verifyAndParse<{ negotiationId: string; turnNumber: number }>(
      req,
      SECRET,
      'negotiation.turn_received',
    );
    expect(result).toEqual({ negotiationId: 'neg-1', turnNumber: 1 });
  });

  test('returns null on signature mismatch', async () => {
    const req = buildSignedRequest('negotiation.turn_received', { negotiationId: 'neg-1' }, 'wrong-secret');
    const result = await verifyAndParse(req, SECRET, 'negotiation.turn_received');
    expect(result).toBeNull();
  });

  test('returns null on missing signature header', async () => {
    const body = JSON.stringify({ event: 'negotiation.turn_received', payload: {}, timestamp: '' });
    const req = mockRequest({
      headers: { 'x-index-event': 'negotiation.turn_received' },
      body,
    });
    const result = await verifyAndParse(req, SECRET, 'negotiation.turn_received');
    expect(result).toBeNull();
  });

  test('returns null on missing event header', async () => {
    const body = JSON.stringify({ event: 'negotiation.turn_received', payload: {}, timestamp: '' });
    const req = mockRequest({
      headers: { 'x-index-signature': signBody(body, SECRET) },
      body,
    });
    const result = await verifyAndParse(req, SECRET, 'negotiation.turn_received');
    expect(result).toBeNull();
  });

  test('returns null when event header does not match expected', async () => {
    const req = buildSignedRequest('negotiation.completed', { negotiationId: 'neg-1' }, SECRET);
    const result = await verifyAndParse(req, SECRET, 'negotiation.turn_received');
    expect(result).toBeNull();
  });

  test('returns null on malformed JSON body', async () => {
    const body = 'not-json';
    const req = mockRequest({
      headers: {
        'x-index-signature': signBody(body, SECRET),
        'x-index-event': 'negotiation.turn_received',
      },
      body,
    });
    const result = await verifyAndParse(req, SECRET, 'negotiation.turn_received');
    expect(result).toBeNull();
  });

  test('returns null when secret is empty', async () => {
    const req = buildSignedRequest('negotiation.turn_received', {}, '');
    const result = await verifyAndParse(req, '', 'negotiation.turn_received');
    expect(result).toBeNull();
  });

  test('returns null when wrapper is missing payload field', async () => {
    const body = JSON.stringify({ event: 'negotiation.turn_received', timestamp: '' });
    const req = mockRequest({
      headers: {
        'x-index-signature': signBody(body, SECRET),
        'x-index-event': 'negotiation.turn_received',
      },
      body,
    });
    const result = await verifyAndParse(req, SECRET, 'negotiation.turn_received');
    expect(result).toBeNull();
  });

  test('uses timing-safe comparison (does not throw on length mismatch)', async () => {
    const body = JSON.stringify({ event: 'negotiation.turn_received', payload: {}, timestamp: '' });
    const req = mockRequest({
      headers: {
        'x-index-signature': 'sha256=short',
        'x-index-event': 'negotiation.turn_received',
      },
      body,
    });
    const result = await verifyAndParse(req, SECRET, 'negotiation.turn_received');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd packages/openclaw-plugin && bun test src/tests/verify.spec.ts
```

Expected: all tests FAIL with module-not-found or import error for `../webhook/verify.js`.

---

## Task 3: HMAC Verifier — Implementation

**Goal:** Implement `verify.ts` to pass every test in Task 2.

**Files:**
- Create: `packages/openclaw-plugin/src/webhook/types.ts`
- Create: `packages/openclaw-plugin/src/webhook/verify.ts`

- [ ] **Step 1: Create webhook payload types**

Create `packages/openclaw-plugin/src/webhook/types.ts`:

```ts
/**
 * Types for Index Network webhook payloads the plugin catches.
 * Keep these minimal — only the fields the plugin actually reads.
 */

export interface NegotiationTurnReceivedPayload {
  negotiationId: string;
  turnNumber: number;
  counterpartyAction: string;
  counterpartyMessage?: string | null;
  deadline: string;
}

export type NegotiationOutcomeReason = 'turn_cap' | 'timeout';

export interface NegotiationOutcome {
  hasOpportunity: boolean;
  agreedRoles?: { ownUser?: string; otherUser?: string };
  reasoning?: string;
  reason?: NegotiationOutcomeReason;
}

export interface NegotiationCompletedPayload {
  negotiationId: string;
  outcome: NegotiationOutcome;
  turnCount: number;
}
```

- [ ] **Step 2: Implement `verify.ts`**

Create `packages/openclaw-plugin/src/webhook/verify.ts`:

```ts
import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * Verifies an inbound Index Network webhook and returns the parsed payload.
 *
 * Expects:
 * - Body: JSON wrapper `{ event, payload, timestamp }` (signed as a single string)
 * - Header `x-index-signature: sha256=<hex>` — HMAC-SHA256 of the raw body
 * - Header `x-index-event: <event>` — must match `expectedEvent`
 *
 * Returns the inner `payload` on success, `null` on any verification failure.
 * Uses timing-safe comparison and never throws.
 */
export async function verifyAndParse<T = unknown>(
  req: IncomingMessage,
  secret: string,
  expectedEvent: string,
): Promise<T | null> {
  if (!secret) return null;

  const signatureHeader = headerValue(req, 'x-index-signature');
  const eventHeader = headerValue(req, 'x-index-event');
  if (!signatureHeader || !eventHeader) return null;
  if (eventHeader !== expectedEvent) return null;

  const rawBody = await readRawBody(req);

  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (!timingSafeEqualStrings(signatureHeader, expected)) return null;

  let wrapper: unknown;
  try {
    wrapper = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }

  if (
    typeof wrapper !== 'object' ||
    wrapper === null ||
    !('payload' in wrapper) ||
    !('event' in wrapper)
  ) {
    return null;
  }

  const w = wrapper as { event: unknown; payload: unknown };
  if (w.event !== expectedEvent) return null;

  return w.payload as T;
}

function headerValue(req: IncomingMessage, name: string): string | null {
  const raw = req.headers[name.toLowerCase()];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0] ?? null;
  return null;
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err: Error) => reject(err));
  });
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
cd packages/openclaw-plugin && bun test src/tests/verify.spec.ts
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/openclaw-plugin/src/webhook packages/openclaw-plugin/src/tests/verify.spec.ts packages/openclaw-plugin/src/tests/helpers/mock-http.ts
git commit -m "feat(openclaw-plugin): add HMAC verifier for Index Network webhooks"
```

---

## Task 4: Turn Prompt Builder — Tests

**Goal:** Snapshot-test the turn prompt so future prompt edits are explicit and reviewable.

**Files:**
- Create: `packages/openclaw-plugin/src/tests/turn.prompt.spec.ts`

- [ ] **Step 1: Write the test**

Create `packages/openclaw-plugin/src/tests/turn.prompt.spec.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { turnPrompt } from '../prompts/turn.prompt.js';

describe('turnPrompt', () => {
  test('produces stable output for a fixed payload', () => {
    const payload = {
      negotiationId: 'neg-abc-123',
      turnNumber: 2,
      counterpartyAction: 'counter',
      counterpartyMessage: 'Can you clarify the role?',
      deadline: '2026-04-12T00:00:00.000Z',
    };

    const output = turnPrompt(payload);

    expect(output).toContain('negotiationId="neg-abc-123"');
    expect(output).toContain('turnNumber: 2');
    expect(output).toContain('counterpartyAction: counter');
    expect(output).toContain('Can you clarify the role?');
    expect(output).toContain('2026-04-12T00:00:00.000Z');
    expect(output).toContain('get_negotiation');
    expect(output).toContain('respond_to_negotiation');
    expect(output).toContain('Do not produce any user-facing output');
  });

  test('handles null counterpartyMessage gracefully', () => {
    const payload = {
      negotiationId: 'neg-abc-123',
      turnNumber: 1,
      counterpartyAction: 'propose',
      counterpartyMessage: null,
      deadline: '2026-04-12T00:00:00.000Z',
    };

    const output = turnPrompt(payload);

    expect(output).toContain('counterpartyMessage: none');
  });

  test('omits propose-guidance wording when turnNumber > 1', () => {
    const payload = {
      negotiationId: 'neg-abc-123',
      turnNumber: 5,
      counterpartyAction: 'counter',
      counterpartyMessage: null,
      deadline: '2026-04-12T00:00:00.000Z',
    };

    const output = turnPrompt(payload);

    expect(output).toContain('turnNumber: 5');
    expect(output).toContain('counter:');
    expect(output).toContain('accept:');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/openclaw-plugin && bun test src/tests/turn.prompt.spec.ts
```

Expected: all tests FAIL with module-not-found for `../prompts/turn.prompt.js`.

---

## Task 5: Turn Prompt Builder — Implementation

**Files:**
- Create: `packages/openclaw-plugin/src/prompts/turn.prompt.ts`

- [ ] **Step 1: Implement the builder**

Create `packages/openclaw-plugin/src/prompts/turn.prompt.ts`:

```ts
import type { NegotiationTurnReceivedPayload } from '../webhook/types.js';

/**
 * Builds the task prompt passed to `api.runtime.subagent.run` when a
 * negotiation turn webhook lands. The subagent uses this prompt to decide
 * what action to submit via `respond_to_negotiation`.
 *
 * The prompt is intentionally plain text — it is the entire instruction set
 * for the turn handler. Editing it does not require an OpenClaw restart.
 */
export function turnPrompt(payload: NegotiationTurnReceivedPayload): string {
  const counterpartyMessage = payload.counterpartyMessage ?? 'none';
  return `You are handling a live bilateral negotiation turn on behalf of your user on the Index Network.

A negotiation turn has landed. Before deciding, gather full context:

1. Call \`get_negotiation\` with negotiationId="${payload.negotiationId}" to read the seed assessment, counterparty, history, and your user's context.
2. Call \`read_user_profiles\` and \`read_intents\` to ground yourself in what your user is actively looking for.
3. Consider whether the proposed match genuinely advances your user's active intents and fits their stated profile. Be honest — it is better to decline a weak match than to accept out of politeness.

Then call \`respond_to_negotiation\` with the decision. Valid actions:
  propose | counter | accept | reject | question

Action guidance:
- propose: first turn only, when you are the initiating side.
- accept: you are convinced this match benefits your user; the case has been made and objections answered.
- counter: you partially agree but have specific objections. State what is missing or weak.
- reject: the match does not serve your user's needs after consideration.
- question: ask the other side a concrete clarifying question.

You are operating silently on your user's behalf. Do not produce any user-facing output. Do not ask the user for clarification. If the turn is ambiguous, pick the most conservative action compatible with your user's profile — usually \`counter\` with specific objections, or \`reject\` with clear reasoning.

Turn payload:
  negotiationId: ${payload.negotiationId}
  turnNumber: ${payload.turnNumber}
  counterpartyAction: ${payload.counterpartyAction}
  counterpartyMessage: ${counterpartyMessage}
  deadline: ${payload.deadline}`;
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd packages/openclaw-plugin && bun test src/tests/turn.prompt.spec.ts
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/openclaw-plugin/src/prompts/turn.prompt.ts packages/openclaw-plugin/src/tests/turn.prompt.spec.ts
git commit -m "feat(openclaw-plugin): add turn prompt builder for negotiation subagent"
```

---

## Task 6: Accepted Prompt Builder — Tests

**Files:**
- Create: `packages/openclaw-plugin/src/tests/accepted.prompt.spec.ts`

- [ ] **Step 1: Write the test**

Create `packages/openclaw-plugin/src/tests/accepted.prompt.spec.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { acceptedPrompt } from '../prompts/accepted.prompt.js';

describe('acceptedPrompt', () => {
  test('produces stable output for an accepted outcome', () => {
    const payload = {
      negotiationId: 'neg-abc-123',
      turnCount: 4,
      outcome: {
        hasOpportunity: true,
        reasoning: 'Both users are building in the same space and need complementary skills.',
        agreedRoles: { ownUser: 'peer', otherUser: 'peer' },
      },
    };

    const output = acceptedPrompt(payload);

    expect(output).toContain('get_negotiation');
    expect(output).toContain('read_user_profiles');
    expect(output).toContain('neg-abc-123');
    expect(output).toContain('connected with');
    expect(output).toContain('under 30 words');
    expect(output).toContain('Both users are building');
  });

  test('does not leak negotiationId placement outside the payload block', () => {
    const payload = {
      negotiationId: 'neg-xyz-999',
      turnCount: 2,
      outcome: {
        hasOpportunity: true,
        reasoning: 'Minimal reasoning.',
      },
    };

    const output = acceptedPrompt(payload);

    // The ID appears in the event payload block — not in the instructional text
    // the subagent is told to write.
    expect(output).toContain('negotiationId: neg-xyz-999');
    expect(output).toContain('Do not expose');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/openclaw-plugin && bun test src/tests/accepted.prompt.spec.ts
```

Expected: all tests FAIL with module-not-found.

---

## Task 7: Accepted Prompt Builder — Implementation

**Files:**
- Create: `packages/openclaw-plugin/src/prompts/accepted.prompt.ts`

- [ ] **Step 1: Implement the builder**

Create `packages/openclaw-plugin/src/prompts/accepted.prompt.ts`:

```ts
import type { NegotiationCompletedPayload } from '../webhook/types.js';

/**
 * Builds the task prompt for the "we connected you with X" message that the
 * plugin posts to the user's channel when a negotiation is accepted. The
 * subagent receives this prompt and produces one short chat message.
 */
export function acceptedPrompt(payload: NegotiationCompletedPayload): string {
  const reasoning = payload.outcome.reasoning ?? 'no reasoning provided';
  return `A negotiation on the Index Network has ended with an accepted opportunity. Your job is to tell the user in one short, natural message.

Before writing:
1. Call \`get_negotiation\` to read the outcome's reasoning and the agreed roles.
2. Call \`read_user_profiles\` on the counterparty to get their name and a one-line context.

Then write one message to the user. Format:
  "You're now connected with <first name> — <one-line why>. <one-line counterparty context>."

Keep it under 30 words. No lists. No emojis. Do not expose negotiationId, UUIDs, role names, or internal vocabulary. Do not offer next steps unless the user's profile implies they want them.

Event payload:
  negotiationId: ${payload.negotiationId}
  outcome.hasOpportunity: true
  outcome.reasoning: ${reasoning}
  turnCount: ${payload.turnCount}`;
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd packages/openclaw-plugin && bun test src/tests/accepted.prompt.spec.ts
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/openclaw-plugin/src/prompts/accepted.prompt.ts packages/openclaw-plugin/src/tests/accepted.prompt.spec.ts
git commit -m "feat(openclaw-plugin): add accepted prompt builder for negotiation notifier"
```

---

## Task 8: Plugin Entry Point — Tests

**Goal:** Exercise `register(api)` with a mock `api` object so we can assert route registration, HMAC handling, and subagent invocation without any real OpenClaw SDK.

**Files:**
- Create: `packages/openclaw-plugin/src/tests/index.spec.ts`

- [ ] **Step 1: Write the test suite**

Create `packages/openclaw-plugin/src/tests/index.spec.ts`:

```ts
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import crypto from 'node:crypto';
import type { ServerResponse } from 'node:http';

import register from '../index.js';
import type {
  OpenClawPluginApi,
  RouteHandler,
  RouteOptions,
  SubagentRunOptions,
} from '../plugin-api.js';

import { mockRequest } from './helpers/mock-http.js';

const SECRET = 'unit-test-secret-abcdefghijklmnop';

interface FakeApi {
  api: OpenClawPluginApi;
  registered: Map<string, RouteOptions>;
  subagentCalls: SubagentRunOptions[];
  logger: { warn: ReturnType<typeof mock>; error: ReturnType<typeof mock>; info: ReturnType<typeof mock>; debug: ReturnType<typeof mock> };
}

function buildFakeApi(config: Record<string, unknown>): FakeApi {
  const registered = new Map<string, RouteOptions>();
  const subagentCalls: SubagentRunOptions[] = [];
  const logger = {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };

  const api: OpenClawPluginApi = {
    id: 'indexnetwork-openclaw-plugin',
    name: 'Index Network',
    pluginConfig: config,
    runtime: {
      subagent: {
        run: async (opts) => {
          subagentCalls.push(opts);
        },
      },
    },
    logger,
    registerHttpRoute: (opts) => {
      registered.set(opts.path, opts);
    },
  };

  return { api, registered, subagentCalls, logger };
}

function fakeResponse(): ServerResponse & { _status: number; _body: string } {
  const res = {
    statusCode: 0,
    _status: 0,
    _body: '',
    end(body?: string) {
      this._status = this.statusCode;
      this._body = body ?? '';
      return this as unknown as ServerResponse;
    },
  };
  return res as unknown as ServerResponse & { _status: number; _body: string };
}

function signBody(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function signedRequest(event: string, payload: Record<string, unknown>, secret: string) {
  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  return mockRequest({
    headers: {
      'x-index-signature': signBody(body, secret),
      'x-index-event': event,
    },
    body,
  });
}

async function callHandler(handler: RouteHandler, req: ReturnType<typeof signedRequest>) {
  const res = fakeResponse();
  await handler(req, res);
  return res;
}

const WEBHOOK_PATH = '/index-network/webhook';

function getHandler(fake: FakeApi): RouteHandler {
  const route = fake.registered.get(WEBHOOK_PATH);
  if (!route) throw new Error(`route ${WEBHOOK_PATH} not registered`);
  return route.handler;
}

describe('register(api)', () => {
  let fake: FakeApi;

  beforeEach(() => {
    fake = buildFakeApi({ webhookSecret: SECRET });
    register(fake.api);
  });

  test('registers exactly one HTTP route at /index-network/webhook', () => {
    expect(fake.registered.size).toBe(1);
    expect(fake.registered.has(WEBHOOK_PATH)).toBe(true);
  });

  test('registered route declares auth: plugin and match: exact', () => {
    const opts = fake.registered.get(WEBHOOK_PATH)!;
    expect(opts.auth).toBe('plugin');
    expect(opts.match).toBe('exact');
  });

  describe('negotiation.turn_received dispatch', () => {
    test('launches silent subagent on valid turn_received delivery', async () => {
      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.turn_received',
        {
          negotiationId: 'neg-1',
          turnNumber: 1,
          counterpartyAction: 'propose',
          counterpartyMessage: null,
          deadline: '2026-04-12T00:00:00.000Z',
        },
        SECRET,
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(202);
      expect(fake.subagentCalls).toHaveLength(1);
      expect(fake.subagentCalls[0].deliver).toBe(false);
      expect(fake.subagentCalls[0].sessionKey).toBe('index:negotiation:neg-1');
      expect(fake.subagentCalls[0].message).toContain('negotiationId="neg-1"');
    });

    test('returns 401 on bad signature and does not run subagent', async () => {
      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.turn_received',
        { negotiationId: 'neg-1', turnNumber: 1, counterpartyAction: 'propose', deadline: '' },
        'wrong-secret',
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(401);
      expect(fake.subagentCalls).toHaveLength(0);
    });
  });

  describe('negotiation.completed dispatch', () => {
    test('runs delivered subagent when outcome.hasOpportunity is true', async () => {
      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.completed',
        {
          negotiationId: 'neg-1',
          turnCount: 3,
          outcome: { hasOpportunity: true, reasoning: 'strong fit' },
        },
        SECRET,
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(202);
      expect(fake.subagentCalls).toHaveLength(1);
      expect(fake.subagentCalls[0].deliver).toBe(true);
      expect(fake.subagentCalls[0].sessionKey).toBe('index:event:neg-1');
      expect(fake.subagentCalls[0].message).toContain('connected with');
    });

    test('does NOT run subagent when outcome.hasOpportunity is false', async () => {
      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.completed',
        {
          negotiationId: 'neg-1',
          turnCount: 5,
          outcome: { hasOpportunity: false, reason: 'turn_cap' },
        },
        SECRET,
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(202);
      expect(fake.subagentCalls).toHaveLength(0);
    });

    test('does NOT run subagent when outcome is missing', async () => {
      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.completed',
        { negotiationId: 'neg-1', turnCount: 5 },
        SECRET,
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(202);
      expect(fake.subagentCalls).toHaveLength(0);
    });

    test('returns 401 on bad signature', async () => {
      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.completed',
        { negotiationId: 'neg-1', outcome: { hasOpportunity: true }, turnCount: 1 },
        'wrong',
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(401);
      expect(fake.subagentCalls).toHaveLength(0);
    });
  });

  describe('unknown event header', () => {
    test('returns 400 without invoking the subagent', async () => {
      const handler = getHandler(fake);
      const req = signedRequest('negotiation.unknown', { negotiationId: 'neg-1' }, SECRET);

      const res = await callHandler(handler, req);

      expect(res._status).toBe(400);
      expect(fake.subagentCalls).toHaveLength(0);
    });

    test('returns 400 when X-Index-Event header is missing', async () => {
      const handler = getHandler(fake);
      const body = JSON.stringify({
        event: 'negotiation.turn_received',
        payload: {},
        timestamp: '',
      });
      const req = mockRequest({
        headers: {
          'x-index-signature': 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex'),
        },
        body,
      });

      const res = await callHandler(handler, req);

      expect(res._status).toBe(400);
      expect(fake.subagentCalls).toHaveLength(0);
    });
  });

  describe('with missing webhookSecret', () => {
    test('logs a warning and rejects all requests', async () => {
      fake = buildFakeApi({});
      register(fake.api);

      expect(fake.logger.warn).toHaveBeenCalled();

      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.turn_received',
        { negotiationId: 'neg-1', turnNumber: 1, counterpartyAction: 'propose', deadline: '' },
        SECRET,
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(401);
      expect(fake.subagentCalls).toHaveLength(0);
    });
  });

  describe('with negotiationMode: disabled', () => {
    test('turn webhook returns 202 without running subagent', async () => {
      fake = buildFakeApi({ webhookSecret: SECRET, negotiationMode: 'disabled' });
      register(fake.api);

      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.turn_received',
        {
          negotiationId: 'neg-1',
          turnNumber: 1,
          counterpartyAction: 'propose',
          counterpartyMessage: null,
          deadline: '2026-04-12T00:00:00.000Z',
        },
        SECRET,
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(202);
      expect(fake.subagentCalls).toHaveLength(0);
    });

    test('completed webhook still posts accepted notification', async () => {
      fake = buildFakeApi({ webhookSecret: SECRET, negotiationMode: 'disabled' });
      register(fake.api);

      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.completed',
        {
          negotiationId: 'neg-1',
          turnCount: 3,
          outcome: { hasOpportunity: true, reasoning: 'strong fit' },
        },
        SECRET,
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(202);
      expect(fake.subagentCalls).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/openclaw-plugin && bun test src/tests/index.spec.ts
```

Expected: all tests FAIL because `src/index.ts` is still the stub.

---

## Task 9: Plugin Entry Point — Implementation

**Files:**
- Modify: `packages/openclaw-plugin/src/index.ts` (full rewrite)

- [ ] **Step 1: Replace stub with full plugin registration**

Replace the entire contents of `packages/openclaw-plugin/src/index.ts` with:

```ts
/**
 * Index Network — OpenClaw plugin entry point.
 *
 * Registers a single plugin-authed HTTP route on the OpenClaw gateway:
 *
 *   POST /index-network/webhook
 *
 * Index Network's agent registry creates one agent with at most one webhook
 * transport that subscribes to multiple event types. The plugin therefore
 * exposes one URL and dispatches internally by reading the `X-Index-Event`
 * header:
 *
 *   - negotiation.turn_received  → silent subagent (deliver: false) runs the
 *                                  turn handler prompt. The subagent calls
 *                                  `get_negotiation` + `respond_to_negotiation`
 *                                  on the parent's Index Network MCP pool.
 *   - negotiation.completed      → if outcome.hasOpportunity is true, a
 *                                  delivered subagent (deliver: true) posts
 *                                  one short message to the user's last
 *                                  active channel. Non-accepted outcomes are
 *                                  ACKed silently.
 *
 * HMAC verification uses the shared secret from
 * `plugins.entries.indexnetwork-openclaw-plugin.config.webhookSecret`,
 * stored by the bootstrap skill.
 *
 * The subagent inherits the parent OpenClaw instance's MCP connection to
 * the Index Network MCP server, so it can call `get_negotiation`,
 * `read_user_profiles`, `read_intents`, and `respond_to_negotiation` on
 * behalf of the user without re-authenticating.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { OpenClawPluginApi } from './plugin-api.js';
import { turnPrompt } from './prompts/turn.prompt.js';
import { acceptedPrompt } from './prompts/accepted.prompt.js';
import type {
  NegotiationCompletedPayload,
  NegotiationTurnReceivedPayload,
} from './webhook/types.js';
import { verifyAndParse } from './webhook/verify.js';

const WEBHOOK_PATH = '/index-network/webhook';
const TURN_EVENT = 'negotiation.turn_received';
const COMPLETED_EVENT = 'negotiation.completed';

export default function register(api: OpenClawPluginApi): void {
  const secret = typeof api.pluginConfig.webhookSecret === 'string'
    ? api.pluginConfig.webhookSecret
    : '';

  if (!secret) {
    api.logger.warn(
      'Index Network webhook secret is not configured — all inbound webhooks will be rejected until bootstrap completes.',
      { plugin: api.id },
    );
  }

  const negotiationMode = typeof api.pluginConfig.negotiationMode === 'string'
    ? api.pluginConfig.negotiationMode
    : 'enabled';

  api.registerHttpRoute({
    path: WEBHOOK_PATH,
    auth: 'plugin',
    match: 'exact',
    handler: async (req, res) => {
      const eventHeader = readHeader(req.headers['x-index-event']);

      if (eventHeader === TURN_EVENT) {
        return handleTurn(api, req, res, secret, negotiationMode);
      }
      if (eventHeader === COMPLETED_EVENT) {
        return handleCompleted(api, req, res, secret);
      }
      return badRequest(res);
    },
  });
}

async function handleTurn(
  api: OpenClawPluginApi,
  req: IncomingMessage,
  res: ServerResponse,
  secret: string,
  negotiationMode: string,
): Promise<boolean> {
  const payload = await verifyAndParse<NegotiationTurnReceivedPayload>(
    req,
    secret,
    TURN_EVENT,
  );
  if (!payload) return reject(res);

  if (negotiationMode === 'disabled') {
    return accept(res);
  }

  try {
    await api.runtime.subagent.run({
      sessionKey: `index:negotiation:${payload.negotiationId}`,
      message: turnPrompt(payload),
      deliver: false,
    });
  } catch (err) {
    api.logger.error('Failed to launch turn subagent', {
      plugin: api.id,
      negotiationId: payload.negotiationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail(res);
  }

  return accept(res);
}

async function handleCompleted(
  api: OpenClawPluginApi,
  req: IncomingMessage,
  res: ServerResponse,
  secret: string,
): Promise<boolean> {
  const payload = await verifyAndParse<NegotiationCompletedPayload>(
    req,
    secret,
    COMPLETED_EVENT,
  );
  if (!payload) return reject(res);

  if (payload.outcome?.hasOpportunity !== true) {
    return accept(res);
  }

  try {
    await api.runtime.subagent.run({
      sessionKey: `index:event:${payload.negotiationId}`,
      message: acceptedPrompt(payload),
      deliver: true,
    });
  } catch (err) {
    api.logger.error('Failed to launch accepted subagent', {
      plugin: api.id,
      negotiationId: payload.negotiationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail(res);
  }

  return accept(res);
}

function readHeader(raw: string | string[] | undefined): string | null {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0] ?? null;
  return null;
}

function accept(res: ServerResponse): boolean {
  res.statusCode = 202;
  res.end('accepted');
  return true;
}

function reject(res: ServerResponse): boolean {
  res.statusCode = 401;
  res.end('invalid signature');
  return true;
}

function badRequest(res: ServerResponse): boolean {
  res.statusCode = 400;
  res.end('unknown or missing x-index-event header');
  return true;
}

function fail(res: ServerResponse): boolean {
  res.statusCode = 500;
  res.end('internal error');
  return true;
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd packages/openclaw-plugin && bun test src/tests/index.spec.ts
```

Expected: all tests PASS.

- [ ] **Step 3: Run the full plugin test suite**

```bash
cd packages/openclaw-plugin && bun test
```

Expected: all tests PASS (verifier + both prompt builders + entry point).

- [ ] **Step 4: Typecheck**

```bash
cd packages/openclaw-plugin && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/index.ts packages/openclaw-plugin/src/tests/index.spec.ts
git commit -m "feat(openclaw-plugin): wire turn and event HTTP routes to negotiation subagent"
```

---

## Task 10: MCP Instructions — Add Negotiation Turn Mode Paragraph

**Goal:** Every MCP-connected agent that encounters an `index:negotiation:*` session key should behave consistently. Add the guidance to the canonical `MCP_INSTRUCTIONS` string.

**Files:**
- Modify: `packages/protocol/src/mcp/mcp.server.ts`

- [ ] **Step 1: Add the new section**

Open `packages/protocol/src/mcp/mcp.server.ts`. Locate the `MCP_INSTRUCTIONS` constant (starts around line 115). Find the block that ends with `# Personal-index scoping` and insert a new section immediately after it, before `# Output rules`:

Find:

```
# Personal-index scoping
"In my network" / "from my contacts" / "people I know" → pass the personal index ID (from memberships where \`isPersonal: true\`) as \`indexId\`.

# Output rules
```

Replace with:

```
# Personal-index scoping
"In my network" / "from my contacts" / "people I know" → pass the personal index ID (from memberships where \`isPersonal: true\`) as \`indexId\`.

# Negotiation turn mode
When invoked with a task prompt that describes a live negotiation turn (session key prefixed \`index:negotiation:\`), you are running as a silent background subagent representing your user in a bilateral negotiation. Fetch the full negotiation via \`get_negotiation\`, ground yourself in the user's profile and intents via \`read_user_profiles\` and \`read_intents\`, and submit a response via \`respond_to_negotiation\`. Do not produce user-facing output; do not ask clarifying questions. If the decision is ambiguous, pick the most conservative action — usually \`counter\` with specific objections, or \`reject\` with clear reasoning.

# Output rules
```

- [ ] **Step 2: Verify the protocol package still builds**

```bash
cd packages/protocol && bun run build
```

Expected: clean build.

- [ ] **Step 3: Run any MCP-related tests**

```bash
cd backend && bun test tests/mcp.test.ts
```

Expected: all tests PASS (no test asserts against the full instruction string, but if any does, update it to accommodate the new paragraph).

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/mcp/mcp.server.ts
git commit -m "feat(protocol/mcp): add negotiation turn mode instructions for subagents"
```

---

## Task 11: Bootstrap Skill Template — Webhook Transport Registration Block

**Goal:** Extend the OpenClaw bootstrap skill to register a single personal agent with both negotiation webhook events after API key setup. The user's OpenClaw instance must expose the gateway public URL before the skill can complete this step; if auto-detection fails, the skill prompts the user.

**Architectural note (post Task 0 correction):** Per Task 0 research findings, the Index Network `register_agent` MCP tool creates **one agent with at most one webhook transport**. The plugin therefore exposes a single route `/index-network/webhook` and the bootstrap skill registers a single agent with `webhook_events: ["negotiation.turn_received", "negotiation.completed"]` plus `permissions: ["manage:negotiations"]` inline in the same `register_agent` call. Do NOT attempt to register two transports.

**Files:**
- Modify: `packages/protocol/skills/openclaw/SKILL.md.template`

- [ ] **Step 1: Read the current template end-to-end**

```bash
cat packages/protocol/skills/openclaw/SKILL.md.template
```

Expected: you see the existing bootstrap flow (Detect → Register → Choose an auth mode → Handoff).

- [ ] **Step 2: Append a new section before Handoff**

Open `packages/protocol/skills/openclaw/SKILL.md.template`. Find:

```
## Handoff

Once the MCP is registered and authenticated, you are done with bootstrap. Do NOT duplicate or restate the MCP server's behavioral guidance here — the MCP server's own `instructions` carry voice, vocabulary, entity model, discovery-first rule, and output rules. Follow those.
```

Insert before it:

```
## Enable automatic negotiations (persistent session only)

If the user chose **Persistent session**, offer to turn on automatic background negotiations:

> Do you want me to handle negotiation matches automatically in the background? I'll only tell you when a match is accepted. (yes/no)

If they say no, skip to **Handoff**.

If they say yes, complete these steps in order:

### 1. Resolve the gateway public URL

The plugin registers HTTP routes under this URL. Check if OpenClaw exposes it on `api.config` (SDK-dependent). If not available, ask the user:

> What is the public URL of your OpenClaw gateway? (for example, your ngrok URL or reverse proxy hostname)

Store the value as `GATEWAY_URL`. Do not proceed without a value.

### 2. Generate a shared webhook secret

Generate 32 random bytes of hex. Save it as `WEBHOOK_SECRET`. Write it into the plugin config:

```bash
openclaw config set 'plugins.entries.indexnetwork-openclaw-plugin.config.webhookSecret' '<WEBHOOK_SECRET>'
```

Never display `WEBHOOK_SECRET` back to the user.

### 3. Register the personal agent with both negotiation events

Call the `register_agent` MCP tool **once**. The tool creates one agent, optionally attaches a single webhook transport, and grants initial permissions in the same call. Pass these fields:

- `name`: `"OpenClaw Personal Negotiator"` (or a name the user picks)
- `description`: `"Handles negotiation turns and accepted notifications for the user."`
- `webhook_url`: `<GATEWAY_URL>/index-network/webhook`
- `webhook_secret`: `<WEBHOOK_SECRET>`
- `webhook_events`: `["negotiation.turn_received", "negotiation.completed"]`
- `permissions`: `["manage:negotiations"]`

Both events land on the same route. The plugin dispatches internally based on the `X-Index-Event` header. Do **not** attempt to register a second agent or a second transport — `register_agent` creates exactly one transport, and the plugin only exposes one route.

If `register_agent` fails because an agent with the same name already exists, list existing agents with `list_agents` and either reuse the existing one (tell the user) or pick a new name.

### 4. Confirm to the user

> Automatic negotiations are on. I'll run them silently and only interrupt you when a match is accepted. You can turn this off any time by setting `plugins.entries.indexnetwork-openclaw-plugin.config.negotiationMode` to `disabled`.

### Troubleshooting

- **Negotiations never fire**: confirm the gateway tunnel is up and the plugin is enabled. Check OpenClaw logs for `401` responses on `/index-network/webhook` — that indicates a HMAC secret mismatch. Check the `list_agents` output to confirm the webhook URL matches `<GATEWAY_URL>/index-network/webhook`.
- **`register_agent` fails**: re-check the personal agent key; the user may need to regenerate it at {{FRONTEND_URL}}/agents.
- **Turn responses arrive past deadline**: the user's gateway or tunnel provider is slow. Recommend upgrading the tunnel or self-hosting with a stable reverse proxy.
```

- [ ] **Step 3: Rebuild the materialized skill**

```bash
bun scripts/build-skills.ts
```

Expected: writes `skills/openclaw/SKILL.md` and `packages/openclaw-plugin/skills/openclaw/SKILL.md` with the new section interpolated. No "Unreplaced tokens" error.

If the build fails because you introduced a new `{{TOKEN}}`, add it to the `TokenSet` interface and both `main` and `dev` entries in `TOKENS` inside `scripts/build-skills.ts`, then re-run. (The section above only uses `{{FRONTEND_URL}}` which already exists.)

- [ ] **Step 4: Run the build-skills tests**

```bash
bun test scripts/tests/build-skills.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/skills/openclaw/SKILL.md.template packages/openclaw-plugin/skills/openclaw/SKILL.md
git commit -m "feat(openclaw-plugin): teach bootstrap skill to enable automatic negotiations"
```

Note: `skills/openclaw/SKILL.md` at repo root is gitignored (regenerated per-environment). Do not stage it.

---

## Task 12: Plugin README — Negotiation Subagent Section

**Files:**
- Modify: `packages/openclaw-plugin/README.md`

- [ ] **Step 1: Add a new section after "How it works"**

Open `packages/openclaw-plugin/README.md`. Find the section heading `## How it works` and read through to the end of its body (ends before `## What it ships`).

Insert a new section before `## What it ships`:

```markdown
## Automatic negotiations

Once bootstrap is complete with a persistent session, the plugin can handle Index Network negotiation matches automatically in the background. When Index Network dispatches a negotiation turn to your personal agent, the plugin:

1. Verifies the HMAC signature on the incoming webhook.
2. Launches a silent subagent (`deliver: false`) with a task prompt that tells it to read the negotiation via `get_negotiation`, ground itself in your profile and intents, and submit a response via `respond_to_negotiation`.
3. Acknowledges the webhook with `202 accepted` within the 5-second delivery window.

You never see the turns. The subagent speaks on your behalf. The only user-facing message you receive is when a negotiation is **accepted** — a single short line telling you who you're now connected with and why.

### Configuration

The plugin reads three optional config keys under `plugins.entries.indexnetwork-openclaw-plugin.config`:

- `webhookSecret` (string, required for automatic negotiations) — shared HMAC secret between Index Network and the plugin. Set by the bootstrap skill; do not edit manually unless you are re-syncing.
- `negotiationMode` (`"enabled"` | `"disabled"`, default `"enabled"`) — when set to `"disabled"`, turn webhooks return `202` without running a subagent. Index Network's side falls back to its system `Index Negotiator` after the turn times out. Accepted-notification messages still fire.

### Pinning the subagent model

By default, the negotiation subagent uses your workspace's default model. If you want to pin a specific model for negotiation runs, set these operator-level keys in your OpenClaw config (not under `config`, under `subagent`):

```json
{
  "plugins": {
    "entries": {
      "indexnetwork-openclaw-plugin": {
        "subagent": {
          "allowModelOverride": true,
          "allowedModels": ["openrouter/anthropic/claude-sonnet-4.6"]
        }
      }
    }
  }
}
```

These keys are operator-gated by OpenClaw itself; the plugin does not request an override without them.

### Privacy note

Subagent runs are logged by OpenClaw's standard subagent logging. Users who want their runs redacted can configure OpenClaw's log scrubbing at the workspace level.
```

- [ ] **Step 2: Update the "What it ships" bullet list**

In the same file, find:

```markdown
## What it ships

- `openclaw.plugin.json` — plugin manifest
- `src/index.ts` — stub entry point (reserved for future extensions)
- `skills/openclaw/SKILL.md` — bootstrap skill (generated from the monorepo template)
```

Replace with:

```markdown
## What it ships

- `openclaw.plugin.json` — plugin manifest
- `src/index.ts` — plugin entry point: registers HTTP routes for negotiation webhooks
- `src/webhook/` — HMAC verifier and webhook payload types
- `src/prompts/` — canonical prompts for the turn-handler and accepted-notifier subagents
- `skills/openclaw/SKILL.md` — bootstrap skill (generated from the monorepo template)
```

- [ ] **Step 3: Update the troubleshooting section**

Find the existing `## Troubleshooting` section and add two entries. Replace:

```markdown
## Troubleshooting

**Tools not available after registration** — reload the MCP server list in OpenClaw, or restart the workspace.

**OAuth never opens a browser** — switch to persistent session mode.

**`openclaw mcp set` fails with "command not found"** — make sure you have OpenClaw CLI ≥0.1.0 installed.
```

with:

```markdown
## Troubleshooting

**Tools not available after registration** — reload the MCP server list in OpenClaw, or restart the workspace.

**OAuth never opens a browser** — switch to persistent session mode.

**`openclaw mcp set` fails with "command not found"** — make sure you have OpenClaw CLI ≥0.1.0 installed.

**Automatic negotiations never fire** — confirm your gateway tunnel is up, the plugin is enabled, and your personal agent is registered with both `negotiation.turn_received` and `negotiation.completed` events at https://index.network/agents. Check OpenClaw gateway logs for `401` responses on `/index-network/webhook` — that indicates a HMAC secret mismatch.

**Plugin logs "webhook secret is not configured"** — re-run the bootstrap skill's "Enable automatic negotiations" block, or set `plugins.entries.indexnetwork-openclaw-plugin.config.webhookSecret` manually.
```

- [ ] **Step 4: Commit**

```bash
git add packages/openclaw-plugin/README.md
git commit -m "docs(openclaw-plugin): document automatic negotiation configuration"
```

---

## Task 13: Full Cross-Package Verification

**Goal:** Run tests, typecheck, and lint across every package touched by this plan so the final commit is clean.

- [ ] **Step 1: Run plugin tests**

```bash
cd packages/openclaw-plugin && bun test
```

Expected: all tests PASS.

- [ ] **Step 2: Typecheck the plugin**

```bash
cd packages/openclaw-plugin && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Build the protocol package (MCP instructions change)**

```bash
cd packages/protocol && bun run build
```

Expected: clean build.

- [ ] **Step 4: Run MCP-adjacent backend tests**

```bash
cd backend && bun test tests/mcp.test.ts tests/agent.service.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run build-skills tests and rebuild skill outputs**

```bash
bun test scripts/tests/build-skills.test.ts
bun scripts/build-skills.ts
```

Expected: tests PASS, skill build succeeds, no unreplaced tokens.

- [ ] **Step 6: Lint affected workspaces**

```bash
cd packages/openclaw-plugin && bunx eslint src || true
cd backend && bun run lint
```

The plugin package may not have ESLint configured yet — do not introduce it in this plan; the `|| true` keeps the command non-fatal if there is no `.eslintrc`. The backend lint must pass.

- [ ] **Step 7: Review the diff end-to-end**

```bash
git status
git diff --stat dev...HEAD
```

Confirm:
- No stray `.env` or credential files staged.
- Only the paths listed in this plan's "File Structure" section are modified or created (plus the research note from Task 0).
- `skills/openclaw/SKILL.md` at the repo root is NOT staged (it is gitignored).
- `packages/openclaw-plugin/skills/openclaw/SKILL.md` IS staged with the new content (it is committed for subtree push).

If anything is off, fix and re-stage before proceeding.

- [ ] **Step 8: Verify the commit history is clean**

```bash
git log --oneline dev..HEAD
```

Expected: a linear history matching the commit messages from Tasks 0–12. No fixup or WIP commits.

---

## Self-Review Checklist (for the plan author, not the implementer)

**Spec coverage:**
- HMAC verifier → Task 3
- Turn prompt → Task 5
- Accepted prompt → Task 7
- Plugin entry point (single `/index-network/webhook` route dispatched by `X-Index-Event` header, auth: plugin, match: exact, silent-by-default, only-accepted notification, missing-secret warning, negotiationMode disable flag) → Task 9
- MCP instructions update → Task 10
- Bootstrap skill update (resolve gateway URL, generate secret, register one agent with both events + `manage:negotiations` permission inline, troubleshooting) → Task 11
- README update (automatic negotiations, config keys, model pinning, privacy note, troubleshooting) → Task 12
- Spec "Testing strategy" unit tests → Tasks 2, 4, 6, 8
- Spec "Open questions to resolve during implementation" → Task 0
- No protocol-side wiring changes (spec says zero) → confirmed; only MCP instructions prose is touched

**Placeholder scan:** no "TBD"/"TODO"/"similar to"/"implement later" survived the review.

**Type consistency:**
- `NegotiationTurnReceivedPayload` defined in Task 3, referenced in Tasks 4, 5, 9 — fields match.
- `NegotiationCompletedPayload` defined in Task 3, referenced in Tasks 6, 7, 9 — fields match.
- `OpenClawPluginApi` defined in Task 1, referenced in Tasks 8, 9 — shape is consistent.
- `verifyAndParse` signature defined in Task 3, called in Task 9 with the exact same generic + arguments.
- `turnPrompt` / `acceptedPrompt` signatures defined in Tasks 5 / 7, called in Task 9 with matching payload shapes.
- Session key prefixes `index:negotiation:` / `index:event:` used consistently in Tasks 8, 9, and spec.
- Single route path `/index-network/webhook` used consistently across Tasks 8, 9, 11, 12 (the spec's two-route design was superseded post Task 0 — see the architectural note at line ~48).

**Scope:** single implementation plan, single PR. No decomposition needed.

---

## Notes for the Implementer

- **Task 0 is a gate, not busywork.** If Step 2 (subagent MCP inheritance) returns NOT SUPPORTED, stop and escalate — the design collapses and the team needs to pick a fallback before code is written. Do not guess.
- **Commits are per-task**, not per-step. Each task ends with exactly one commit. Tests and implementation land together.
- **Do not auto-merge to `dev`** when this plan is done. Per project policy, the user decides what happens to the branch. Push to your origin fork, open a PR into `upstream/dev`, and stop there.
- **GPG signing + sandbox**: if commits or pushes fail due to GPG, rerun with `dangerouslyDisableSandbox: true` and `gpgconf --launch keyboxd` before the git command. This is a pre-known quirk of this machine.
- **The bootstrap skill `register_agent` call in Task 11 is prose, not code.** The skill is an instruction file read by an LLM — it tells the LLM which MCP tools to call in which order. Do not try to hard-code MCP tool invocation inside the skill; describe the intent and let the model use the tools it already has.
- **If the real OpenClaw SDK type shapes differ from `plugin-api.ts`** (Task 1 Step 3), adjust that file to match the SDK rather than patching every call site. The rest of the plugin imports types from this single file.
