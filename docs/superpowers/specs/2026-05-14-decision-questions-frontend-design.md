# Slice 4 — Frontend decision-questions renderer

**Status:** approved (brainstorm) — ready for plan
**Date:** 2026-05-14
**Parent:** [Discovery decision questions — master design](./2026-05-14-discovery-decision-questions-design.md)
**Depends on:** Slice 3 (`decisionQuestions` streamed block + `Question` schema)
**Blocks:** —

## Scope

Consume the new `decisionQuestions` streamed block in the chat UI and render an interactive component modeled on Claude Code's brainstorming `AskUserQuestion` skill (selection + free-text "Other"). On submission, flatten answers into a plain user message posted as the next chat turn.

Delivers:

1. Stream block consumer in the chat-event handling code.
2. `DecisionQuestions` React component.
3. Submission handler that posts a flattened user message.
4. Component tests.

This slice is index.network frontend only. MCP elicitation rendering is Slice 5 and lives in third-party MCP clients we do not own.

## Stream-side wiring

`frontend/src/services/` (or wherever chat-event types live) — add `decisionQuestions` to the existing union of stream block kinds. Payload mirrors the protocol type:

```ts
type DecisionQuestionsBlock = {
  kind: "decisionQuestions";
  questions: Question[];   // shape from packages/protocol/src/shared/schemas/question.schema.ts
};
```

`Question` type is imported either by copying the inferred type into a frontend-local declaration or by adding `@indexnetwork/protocol` (already a workspace package) as a frontend import. Pick the lighter-touch path; if the existing chat-event types already import from protocol, follow suit.

## Component

New directory `frontend/src/components/DecisionQuestions/`:

```
DecisionQuestions/
├── index.tsx                 ← exports
├── DecisionQuestions.tsx     ← container
├── QuestionCard.tsx          ← one question
├── OptionRow.tsx             ← one option (label + description)
└── __tests__/
    └── DecisionQuestions.spec.tsx
```

### Visual contract

- One stacked column of question cards (matches AskUserQuestion's vertical stack).
- Each card:
  - Title chip at top-left (the ≤12-char `title`).
  - Prompt as a paragraph below.
  - Options as radio buttons (when `multiSelect: false`) or checkboxes (when `multiSelect: true`).
  - Each option renders `label` bold and `description` muted on the second line.
  - "Other (specify)" as the final option, when selected reveals a text input.
- A single "Submit" button at the bottom of the stack — answers all questions in one submission.
- Submit disabled until every question has at least one selection (or an "Other" text).
- Submit emits an opaque event consumed by the chat composer; component itself stays presentational.

### Submission flattening

User selections become a deterministic plain-text user message:

```
{title} ({prompt}): {selected option label, or "Other: <text>"}
{title} ({prompt}): {...}
```

Example:

```
Stage (Are you pre- or post-revenue?): Pre-revenue (Recommended)
Timing (When do you need a co-founder in place?): Other: in the next 6 weeks
```

The flattened string is posted to the chat as the next user message via the existing chat-composer submit path. No new API endpoint.

Multi-select picks: comma-separated labels in a single line.

### Component props

```tsx
interface DecisionQuestionsProps {
  questions: Question[];
  onSubmit: (flattened: string) => void;   // wired to the chat composer's submit
}
```

The component is fully controlled by `questions`; once submitted, it remains visible but disabled (visual treatment: muted, "Submitted." caption). It does not retry, edit, or re-submit. Re-asking is the orchestrator's job (it can produce a new `decisionQuestions` block in a later turn).

## Routing into the chat stream

`frontend/src/app/<chat page>/...` (or wherever stream blocks are routed) — add a branch that renders `<DecisionQuestions>` when a `decisionQuestions` block arrives. Wire `onSubmit` to the same handler that sends user messages.

## Tests

Vitest at `frontend/src/components/DecisionQuestions/__tests__/DecisionQuestions.spec.tsx`:

- Renders one question correctly: title chip, prompt, options with descriptions, "Other" row.
- Renders multiple questions stacked; submit is disabled until all answered.
- `multiSelect: false` enforces single selection per question.
- `multiSelect: true` allows multiple selections.
- "Other" radio reveals a text input; empty Other counts as unanswered.
- Submit produces the expected flattened string (snapshot or explicit assertion).
- After submit, component disables and shows "Submitted." caption.

A small Storybook-style visual fixture is nice-to-have but not required for v1.

## Acceptance criteria

- [ ] Manually trigger an orchestrator discovery with `ENABLE_DISCOVERY_QUESTIONS=true` in dev; verify the component renders below the opportunity cards.
- [ ] Submit a question set; verify the next user message in the chat is the flattened string and the chat agent responds normally.
- [ ] `bun run lint` clean in `frontend/`.
- [ ] Vitest component suite passes.
- [ ] Visual review: matches Claude Code's AskUserQuestion-style affordance (stacked cards, title chip, option rows with descriptions).

## Risks / open questions

- **Visual library alignment.** Existing frontend uses Radix + Tailwind. The component should reuse existing button/input primitives, not introduce a new dependency. If a `RadioGroup` / `Checkbox` primitive is missing in the design system, fall back to native semantic HTML with Tailwind styling.
- **Flattening format.** Plain text is simple but loses the multi-question structure for the chat agent. The chat agent should treat the flattened message as a normal user reply — no special parsing on its side. If the agent struggles with multi-question replies, we can iterate the format (e.g. add a YAML-ish prefix), but defer until observed.
- **Resubmission.** Currently no edit-and-resubmit. If a user mis-clicks, they have to ask the orchestrator to re-ask. Acceptable for v1.
