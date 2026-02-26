# Chat Intent Proposal Broken Blocks — Root Cause and Fix

**Date:** 2026-02-26  
**Branch:** fix/chat-intent-proposals  
**Status:** Design + implementation

## 1. Symptom

The assistant sometimes returns intent proposal blocks that are **broken**: they contain only `description` and lack `proposalId` (and optionally `confidence`, `speechActType`, `indexId`). Example from export:

```json
{
  "description": "Connect with investors interested in AI-driven game development and linguistics technology."
}
```

The frontend expects `IntentProposalData`: `proposalId` (required), `description`, optional `indexId`, `confidence`, `speechActType`. Blocks without `proposalId` are treated as **plain text** (not rendered as a card), and Approve would fail because it relies on `proposalId`.

---

## 2. Root Cause (Phase 1)

**Evidence:**

- **Tool contract** (`protocol/src/lib/protocol/tools/intent.tools.ts`): `create_intent` returns `success({ proposed, count, message })` where `message` contains the full `\`\`\`intent_proposal\n{...}\n\`\`\`` block with `proposalId`, `description`, `confidence`, `speechActType`, and optional `indexId`. So the **only** source of a valid block is the tool.
- **Frontend** (`ChatContent.tsx`): `parseAllBlocks` only treats a block as `intent_proposal` when `data.proposalId` is truthy and description is string or absent. Otherwise it pushes the raw markdown as text.
- **Agent flow** (`chat.agent.ts`): Final assistant message is the **model's own text** (streamed then stored). When the model **does** call `create_intent`, it receives a ToolMessage whose content is the full JSON (including the block in `data.message`). The model is instructed to "include the block verbatim" in its reply. If the model **does not** call `create_intent` and instead writes a reply that includes a `\`\`\`intent_proposal` block, that block is **model-invented** and will only contain what the model chooses (typically just `description`).

**Conclusion:** Broken proposals occur when the **LLM emits an intent_proposal block without calling the create_intent tool** (or, less likely, calls the tool but does not copy the returned block verbatim and instead writes a shortened JSON). In both cases the stored message contains a block that lacks `proposalId` and is therefore invalid for the UI.

---

## 3. Pattern (Phase 2)

- **Working path:** User asks for a new priority → model calls `create_intent(description=...)` → tool returns JSON with `data.message` containing the full block → model includes that block verbatim in its reply → frontend parses `proposalId` and renders the card.
- **Broken path:** Model decides to "propose" an intent in natural language and **writes a `\`\`\`intent_proposal` block itself** (e.g. after "I couldn't find any investors") without ever calling `create_intent`. The block contains only `description` → no `proposalId` → frontend shows it as raw text or a broken card.

Difference: **tool call vs. model-generated block**. The fix must make the model consistently use the tool when proposing an intent and never fabricate the block.

---

## 4. Proposed Fix

### 4.1 Prompt (primary) — DONE

- **Explicit rule:** State that the model must **never** write a `\`\`\`intent_proposal` block on its own. To propose an intent it **must** call `create_intent` and then copy the exact block from the tool result into the reply.
- **Where:** Add/strengthen in `chat.prompt.ts`:
  - In the "create_intent" section (CRITICAL): "Never write a \`\`\`intent_proposal block yourself. To propose an intent you MUST call create_intent(description=...). The tool returns a \`\`\`intent_proposal code block (with proposalId and description). You MUST include that exact block verbatim in your response."
  - In the "Intent proposal cards" bullet under Output Format: "Never write a \`\`\`intent_proposal block yourself — always call create_intent first. When create_intent returns \`\`\`intent_proposal code blocks, include them exactly as-is."

### 4.2 Frontend (defensive, optional)

- **Current behavior:** Blocks without `proposalId` are already rendered as plain text (not as a card). No change strictly required.
- **Optional improvement:** When we detect a `\`\`\`intent_proposal` code fence that parses to JSON but lacks `proposalId`, we could render a short message like "This proposal couldn't be loaded as a card. Ask again to add this as a priority." instead of raw JSON. Low priority.

### 4.3 No server-side post-processing

- Injecting or rewriting blocks in the stored message would duplicate logic and complicate streaming/storage. Prefer fixing model behavior via prompt.

---

## 5. Implementation Checklist

- [x] In `protocol/src/lib/protocol/agents/chat.prompt.ts`: Add explicit "never write intent_proposal yourself; always call create_intent and copy the block" in CRITICAL and in Intent proposal cards bullet.
- [x] (Optional) In `frontend/src/components/ChatContent.tsx`: when we parse a block as `intent_proposal` but `!data.proposalId`, show a friendly fallback message instead of raw code block.
- [ ] Manual smoke test: ask "Any investors?" (or similar) and confirm the assistant calls `create_intent` and the reply contains a block with `proposalId` that renders as a card.

---

## 6. Testing

- **Unit:** No change to tool or graph logic; prompt-only change. Existing chat tool tests remain.
- **Manual:** Reproduce "Any investors?" flow; check export or UI that the stored message has an intent_proposal block with `proposalId` and that the card appears and Approve works.
- **Regression:** Ensure other flows (create_opportunities, read_intents, etc.) unchanged.

---

## 7. References

- `protocol/src/lib/protocol/tools/intent.tools.ts` — create_intent handler, builds block with proposalId
- `protocol/src/lib/protocol/agents/chat.prompt.ts` — system prompt, create_intent and intent_proposal instructions
- `frontend/src/components/ChatContent.tsx` — parseAllBlocks, IntentProposalData
- `frontend/src/components/chat/IntentProposalCard.tsx` — IntentProposalData interface
