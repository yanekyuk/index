# Slice 5 — MCP elicitation dispatch

**Status:** approved (brainstorm) — ready for plan
**Date:** 2026-05-14
**Parent:** [Discovery decision questions — master design](./2026-05-14-discovery-decision-questions-design.md)
**Depends on:** Slice 3 (`questions` in tool result)
**Blocks:** —

## Scope

After the MCP `discover_opportunities` tool result returns with a non-empty `questions[]`, dispatch 1–3 sequential `elicitation/create` requests to clients that declared `elicitation` capability in the MCP initialize handshake. For clients without elicitation capability, embed the `questions` payload in the tool-result `content` as a structured JSON envelope so the client's LLM can resurface them in prose.

User responses (`accept`) are flattened into a plain user message and posted into the session as the next chat turn. `decline` / `cancel` are no-ops.

This slice does **not** add new persistence, new endpoints, or new schemas. It only changes the MCP handler's behavior for one tool's post-result flow.

## Reference

MCP spec, elicitation:
- `elicitation/create` request with `message` and `requestedSchema` (primitives + enums).
- Server-initiated; can be sent any time after the session is initialized.
- Response is `{ action: "accept" | "decline" | "cancel", content?: object }`.

`requestedSchema` is JSON Schema restricted to primitive types — no nested objects, no arrays of objects. Strings with `enum` are the standard selection mechanism; arrays of enum-strings express multi-select.

## Capability detection

The MCP server already negotiates capabilities at session init. Add a check:

```ts
const supportsElicitation = !!session.clientCapabilities?.elicitation;
```

Stored once per session at init; cheap to read on each tool call.

## Tool-result content envelope (always)

Regardless of capability, the `discover_opportunities` tool result `content` array gains one final text block containing a JSON envelope with the questions:

```jsonc
{
  "type": "text",
  "text": "Decision questions (structured): { \"questions\": [...] }"
}
```

Format: plain text with a clear leading sentinel string (`Decision questions (structured):`) followed by JSON. The LLM client parses this when no native UI is offered. If the questions array is empty, no envelope is added.

## Elicitation dispatch (when supported)

After the tool result is fully returned, *if* `supportsElicitation` is true and `questions.length > 0`:

```ts
for (const question of result.questions) {
  const elicitation = buildElicitationCreate(question);
  let reply: ElicitResult;
  try {
    reply = await server.elicit(elicitation);
  } catch (err) {
    logger.warn("elicitation_failed", { sessionId, title: question.title, err });
    break;   // stop the loop; remaining questions still in JSON envelope
  }
  if (reply.action === "accept" && reply.content?.choice !== undefined) {
    await postAnswerAsUserMessage(sessionId, question, reply.content.choice);
  }
  // decline / cancel: no-op; move to next or stop
  if (reply.action === "cancel") break;   // user signalled "stop the whole thing"
}
```

Sequential — never parallel. Day-one rule.

### `buildElicitationCreate(question)`

Single-property schema, named `choice`:

```ts
function buildElicitationCreate(q: Question) {
  const propertyDescription = q.options
    .map((opt) => `${opt.label}: ${opt.description}`)
    .join(" | ");

  const choiceSchema = q.multiSelect
    ? {
        type: "array",
        items: { type: "string", enum: q.options.map((o) => o.label) },
        description: propertyDescription,
      }
    : {
        type: "string",
        enum: q.options.map((o) => o.label),
        description: propertyDescription,
      };

  return {
    message: `${q.title}: ${q.prompt}`,
    requestedSchema: {
      type: "object",
      properties: { choice: choiceSchema },
      required: ["choice"],
    },
  };
}
```

Notes:

- `title` is prefixed to `message` because MCP `requestedSchema` has no title slot.
- Per-option `description` text is packed into the property `description` joined by ` | `. Lossy compared to the native frontend's per-option rendering; documented and accepted.

### `postAnswerAsUserMessage`

Flatten the accepted answer into the same format Slice 4 produces for the frontend:

```
{title} ({prompt}): {label or comma-joined labels for multi-select}
```

Post via the existing chat-message insertion path the session already uses for inbound user messages. The chat agent picks it up on the next turn the same way it does any user message.

If the user's choice came from an "Other (free text)" — note: MCP elicitation has no built-in "Other" affordance since its enum is closed. Day-one MCP rendering accepts only the listed options. The free-text "Other" path is index.network-frontend-only (Slice 4). A user who wants to provide a custom answer in an MCP client can decline and reply via chat.

## Flag interaction

The `ENABLE_DISCOVERY_QUESTIONS` flag is checked in `opportunity.discover.ts` (Slice 3). When off, `questions` is absent from the tool result; the MCP path simply has nothing to dispatch. No extra flag at the MCP layer.

## Tests

`backend/src/controllers/tests/mcp.handler.elicitation.spec.ts`:

- Client capability includes `elicitation` + 2 questions in tool result → 2 sequential `elicitation/create` requests dispatched; correct `message` and `requestedSchema` shape; `multiSelect: true` produces `type: array`.
- Client without `elicitation` capability + 2 questions → 0 elicitation calls; tool-result `content` still includes the JSON envelope.
- Client accepts the first elicitation, declines the second → first answer posted as a flattened user message; second is a no-op; both elicitations attempted.
- Client returns `cancel` on first → no further elicitations dispatched; first answer (if any) not posted.
- Elicitation transport throws → loop stops; warn logged.
- `questions.length === 0` → no envelope, no elicitations.

Test harness uses a mocked MCP session that records dispatched elicitations and returns scripted replies.

## Acceptance criteria

- [ ] Connect via Claude Desktop (which supports elicitation) to the MCP server, run `discover_opportunities` with `ENABLE_DISCOVERY_QUESTIONS=true`; verify the native selection dialog appears for each question.
- [ ] Accepting an option results in a follow-up chat message in the session (visible on the next orchestrator turn).
- [ ] Decline/cancel are user-visible no-ops.
- [ ] Connect via an MCP client that does *not* declare elicitation (or a stub configured without the capability); verify the tool result contains the JSON envelope and the client's LLM resurfaces the questions in prose.
- [ ] `bun run lint` clean; `tsc --noEmit` clean.
- [ ] MCP test suite passes.

## Risks / open questions

- **Per-option description fidelity.** Joining descriptions with ` | ` in the property `description` produces a long string. Some MCP host UIs may truncate. Acceptable for v1; consider per-option emission of separate elicitations in a future iteration if user feedback warrants.
- **Sequential timing under slow users.** A user taking minutes to answer the first elicitation blocks the second. Sequential is the safer default UX-wise (one dialog at a time) and matches Claude Desktop's behavior. Parallel emission is a future iteration if needed.
- **"Other" affordance missing in MCP.** Enums are closed. v1 accepts only the listed options on MCP clients. Surface this clearly in any user-facing MCP docs we publish later.
- **Capability discovery edge cases.** If a session reports partial capability (e.g. `elicitation` declared but the host UI silently fails to render), we degrade to the JSON envelope on the *next* call only after observing failures. Day-one assumes capability declaration is honest.
