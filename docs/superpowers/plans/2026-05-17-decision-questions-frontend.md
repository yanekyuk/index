# Decision-questions frontend renderer — Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consume the new `decision_questions` SSE event in the index.network chat UI and render an interactive `DecisionQuestions` component modeled on Claude Code's `AskUserQuestion`. On submit, post a deterministic flattened user message via the existing composer path.

**Architecture:** Slice 3 already emits `decision_questions` events (and a `decisionQuestions` field on the `done` event) from the orchestrator chat agent. We add (1) a new event branch in the existing SSE switch in `AIChatContext.tsx` that attaches `decisionQuestions` to the assistant message, (2) a new `DecisionQuestions` component family under `frontend/src/components/DecisionQuestions/`, (3) a render branch in `ChatContent.tsx`'s `messages.map` similar to the existing `streamingDrafts` block, and (4) a submit handler that calls the existing `sendMessage` from `useAIChat()`.

The `Question` type is **copied locally** into `frontend/src/components/DecisionQuestions/types.ts` rather than adding `@indexnetwork/protocol` as a frontend dependency — the frontend currently has no protocol imports, and the spec says "pick the lighter-touch path." The local type is one zod-schema-shaped object literal; if it ever drifts from the protocol type, the SSE handler will surface obvious render breaks.

**Tech Stack:** React 19, TypeScript, Tailwind 4, Vitest (`happy-dom`), `@testing-library/react`. No new dependencies.

---

## File map

- **Create**: `frontend/src/components/DecisionQuestions/types.ts` — frontend-local `Question` / `QuestionOption` types
- **Create**: `frontend/src/components/DecisionQuestions/flatten.ts` — pure flattening helper (testable in isolation)
- **Create**: `frontend/src/components/DecisionQuestions/OptionRow.tsx` — one radio/checkbox row with label + description
- **Create**: `frontend/src/components/DecisionQuestions/QuestionCard.tsx` — one question card (title chip, prompt, options, "Other" reveal)
- **Create**: `frontend/src/components/DecisionQuestions/DecisionQuestions.tsx` — container managing answer state + submit
- **Create**: `frontend/src/components/DecisionQuestions/index.tsx` — barrel re-export
- **Create**: `frontend/src/components/DecisionQuestions/__tests__/flatten.test.ts` — flatten unit tests
- **Create**: `frontend/src/components/DecisionQuestions/__tests__/DecisionQuestions.test.tsx` — component tests
- **Modify**: `frontend/src/contexts/AIChatContext.tsx` — add `decisionQuestions?: Question[]` and `decisionQuestionsSubmitted?: boolean` to `ChatMessage`; add `decision_questions` event branch; persist in `done` payload's `decisionQuestions` for cold-load (Slice 3 already attaches it to `done.decisionQuestions`); load on session rehydrate from `loadSession`.
- **Modify**: `frontend/src/components/ChatContent.tsx` — render `<DecisionQuestions>` block after the `streamingDrafts` block when `msg.decisionQuestions?.length > 0`; wire `onSubmit` to call `sendMessage(flattened)` then mark `decisionQuestionsSubmitted: true` for that message id.

> Note: Vitest config (`frontend/vitest.config.ts`) includes `src/**/*.test.{ts,tsx}` only — so use `.test.tsx`, **not** `.spec.tsx` (the spec uses `.spec.tsx` informally — we follow the repo convention from `frontend/src/components/chat/timeline.test.ts`).

---

## Task 1: Frontend-local Question type

**Files:**
- Create: `frontend/src/components/DecisionQuestions/types.ts`

- [ ] **Step 1: Write the type module**

```ts
// frontend/src/components/DecisionQuestions/types.ts

export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  title: string;
  prompt: string;
  options: QuestionOption[];
  multiSelect: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/DecisionQuestions/types.ts
git -c commit.gpgsign=false commit -m "feat(frontend): add DecisionQuestions type module"
```

---

## Task 2: Flattening helper (TDD)

**Files:**
- Create: `frontend/src/components/DecisionQuestions/flatten.ts`
- Test: `frontend/src/components/DecisionQuestions/__tests__/flatten.test.ts`

`flattenAnswers(questions, answers)` returns the deterministic multi-line user-message string described in the spec. Pure function — easy to test in isolation.

Internal `Answer` shape (used by the container, exported for the test):

```ts
export type Answer =
  | { kind: "selection"; selectedLabels: string[] }
  | { kind: "other"; text: string };
```

- [ ] **Step 1: Write failing test**

```tsx
// frontend/src/components/DecisionQuestions/__tests__/flatten.test.ts
import { describe, it, expect } from 'vitest';
import { flattenAnswers, type Answer } from '../flatten';
import type { Question } from '../types';

const stageQ: Question = {
  title: 'Stage',
  prompt: 'Are you pre- or post-revenue?',
  options: [
    { label: 'Pre-revenue (Recommended)', description: 'No paying customers yet.' },
    { label: 'Post-revenue', description: 'At least one paying customer.' },
  ],
  multiSelect: false,
};

const timingQ: Question = {
  title: 'Timing',
  prompt: 'When do you need a co-founder in place?',
  options: [
    { label: 'In the next month', description: 'Urgent.' },
    { label: 'In the next quarter', description: 'Soon.' },
  ],
  multiSelect: false,
};

const prioritiesQ: Question = {
  title: 'Priority',
  prompt: 'Which traits matter most?',
  options: [
    { label: 'Technical depth', description: '...' },
    { label: 'Domain expertise', description: '...' },
    { label: 'Network reach', description: '...' },
  ],
  multiSelect: true,
};

describe('flattenAnswers', () => {
  it('flattens a single-select selection', () => {
    const answers: Answer[] = [
      { kind: 'selection', selectedLabels: ['Pre-revenue (Recommended)'] },
    ];
    expect(flattenAnswers([stageQ], answers)).toBe(
      'Stage (Are you pre- or post-revenue?): Pre-revenue (Recommended)',
    );
  });

  it('flattens an Other answer', () => {
    const answers: Answer[] = [
      { kind: 'other', text: 'in the next 6 weeks' },
    ];
    expect(flattenAnswers([timingQ], answers)).toBe(
      'Timing (When do you need a co-founder in place?): Other: in the next 6 weeks',
    );
  });

  it('joins multi-select labels with comma', () => {
    const answers: Answer[] = [
      { kind: 'selection', selectedLabels: ['Technical depth', 'Domain expertise'] },
    ];
    expect(flattenAnswers([prioritiesQ], answers)).toBe(
      'Priority (Which traits matter most?): Technical depth, Domain expertise',
    );
  });

  it('joins multiple questions with newlines, in order', () => {
    const answers: Answer[] = [
      { kind: 'selection', selectedLabels: ['Pre-revenue (Recommended)'] },
      { kind: 'other', text: 'in the next 6 weeks' },
    ];
    expect(flattenAnswers([stageQ, timingQ], answers)).toBe(
      [
        'Stage (Are you pre- or post-revenue?): Pre-revenue (Recommended)',
        'Timing (When do you need a co-founder in place?): Other: in the next 6 weeks',
      ].join('\n'),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && bun run test src/components/DecisionQuestions/__tests__/flatten.test.ts
```

Expected: FAIL with "Cannot find module '../flatten'".

- [ ] **Step 3: Write the helper**

```ts
// frontend/src/components/DecisionQuestions/flatten.ts
import type { Question } from './types';

export type Answer =
  | { kind: 'selection'; selectedLabels: string[] }
  | { kind: 'other'; text: string };

export function flattenAnswers(questions: Question[], answers: Answer[]): string {
  return questions
    .map((q, i) => {
      const a = answers[i];
      const prefix = `${q.title} (${q.prompt})`;
      if (a.kind === 'other') return `${prefix}: Other: ${a.text}`;
      return `${prefix}: ${a.selectedLabels.join(', ')}`;
    })
    .join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && bun run test src/components/DecisionQuestions/__tests__/flatten.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DecisionQuestions/flatten.ts \
        frontend/src/components/DecisionQuestions/__tests__/flatten.test.ts
git -c commit.gpgsign=false commit -m "feat(frontend): add DecisionQuestions answer flattener"
```

---

## Task 3: `OptionRow` presentational component

**Files:**
- Create: `frontend/src/components/DecisionQuestions/OptionRow.tsx`

A single option row. Native `input type="radio"` or `input type="checkbox"` for accessibility (we have no Radix RadioGroup / Checkbox primitive yet, and the spec explicitly accepts native semantic HTML). Label bold, description muted on second line.

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/DecisionQuestions/OptionRow.tsx
import { cn } from '@/lib/utils';

interface OptionRowProps {
  name: string;
  value: string;
  /** "radio" for single-select, "checkbox" for multi-select. */
  type: 'radio' | 'checkbox';
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

export function OptionRow({
  name,
  value,
  type,
  label,
  description,
  checked,
  disabled,
  onChange,
}: OptionRowProps) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 px-3 py-2 rounded-lg border border-[#E8E8E8] cursor-pointer',
        'hover:bg-[#FAFAFA] transition-colors',
        checked && 'bg-[#FAFAFA] border-[#3D3D3D]',
        disabled && 'opacity-50 cursor-not-allowed hover:bg-transparent',
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 accent-black"
      />
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-gray-900">{label}</span>
        <span className="text-xs text-gray-500">{description}</span>
      </span>
    </label>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/DecisionQuestions/OptionRow.tsx
git -c commit.gpgsign=false commit -m "feat(frontend): add DecisionQuestions OptionRow"
```

---

## Task 4: `QuestionCard` component (single-question rendering, TDD)

**Files:**
- Create: `frontend/src/components/DecisionQuestions/QuestionCard.tsx`
- Test: `frontend/src/components/DecisionQuestions/__tests__/QuestionCard.test.tsx`

`QuestionCard` renders title chip, prompt, options, and an "Other (specify)" final option. Fully controlled — receives an `Answer` and an `onAnswerChange`. Disabled (post-submit) state mutes the card.

- [ ] **Step 1: Write failing test**

```tsx
// frontend/src/components/DecisionQuestions/__tests__/QuestionCard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuestionCard } from '../QuestionCard';
import type { Question } from '../types';
import type { Answer } from '../flatten';

const q: Question = {
  title: 'Stage',
  prompt: 'Are you pre- or post-revenue?',
  options: [
    { label: 'Pre-revenue (Recommended)', description: 'No paying customers yet.' },
    { label: 'Post-revenue', description: 'At least one paying customer.' },
  ],
  multiSelect: false,
};

describe('QuestionCard', () => {
  it('renders title chip, prompt, options, and Other row', () => {
    render(
      <QuestionCard
        questionId="q0"
        question={q}
        answer={null}
        disabled={false}
        onAnswerChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Stage')).toBeInTheDocument();
    expect(screen.getByText('Are you pre- or post-revenue?')).toBeInTheDocument();
    expect(screen.getByLabelText(/Pre-revenue \(Recommended\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Post-revenue/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Other \(specify\)/)).toBeInTheDocument();
  });

  it('single-select: clicking a radio emits a selection answer with that single label', () => {
    const onChange = vi.fn();
    render(
      <QuestionCard
        questionId="q0"
        question={q}
        answer={null}
        disabled={false}
        onAnswerChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Pre-revenue \(Recommended\)/));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'selection',
      selectedLabels: ['Pre-revenue (Recommended)'],
    } satisfies Answer);
  });

  it('multi-select: clicking a checkbox toggles that label in selectedLabels', () => {
    const multi: Question = { ...q, multiSelect: true };
    const onChange = vi.fn();
    render(
      <QuestionCard
        questionId="q0"
        question={multi}
        answer={{ kind: 'selection', selectedLabels: ['Pre-revenue (Recommended)'] }}
        disabled={false}
        onAnswerChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Post-revenue/));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'selection',
      selectedLabels: ['Pre-revenue (Recommended)', 'Post-revenue'],
    } satisfies Answer);
  });

  it('selecting Other reveals a text input and emits an other answer when typed', () => {
    const onChange = vi.fn();
    render(
      <QuestionCard
        questionId="q0"
        question={q}
        answer={null}
        disabled={false}
        onAnswerChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Other \(specify\)/));
    const input = screen.getByPlaceholderText('Specify...');
    fireEvent.change(input, { target: { value: 'somewhere else' } });
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'other',
      text: 'somewhere else',
    } satisfies Answer);
  });

  it('disabled: inputs are not interactive', () => {
    render(
      <QuestionCard
        questionId="q0"
        question={q}
        answer={{ kind: 'selection', selectedLabels: ['Pre-revenue (Recommended)'] }}
        disabled
        onAnswerChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Pre-revenue \(Recommended\)/)).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && bun run test src/components/DecisionQuestions/__tests__/QuestionCard.test.tsx
```

Expected: FAIL with "Cannot find module '../QuestionCard'".

- [ ] **Step 3: Write the component**

```tsx
// frontend/src/components/DecisionQuestions/QuestionCard.tsx
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { OptionRow } from './OptionRow';
import type { Question } from './types';
import type { Answer } from './flatten';

interface QuestionCardProps {
  questionId: string;
  question: Question;
  answer: Answer | null;
  disabled: boolean;
  onAnswerChange: (next: Answer) => void;
}

const OTHER_VALUE = '__other__';

export function QuestionCard({
  questionId,
  question,
  answer,
  disabled,
  onAnswerChange,
}: QuestionCardProps) {
  const isOther = answer?.kind === 'other';
  const selectedLabels =
    answer?.kind === 'selection' ? answer.selectedLabels : [];

  // Local mirror so typing into the Other input doesn't lose focus
  // between re-renders of the controlled parent.
  const [otherText, setOtherText] = useState(isOther ? answer.text : '');
  useEffect(() => {
    if (isOther) setOtherText(answer.text);
  }, [isOther, answer]);

  const toggleSelection = (label: string, nextChecked: boolean) => {
    if (question.multiSelect) {
      const next = nextChecked
        ? [...selectedLabels, label]
        : selectedLabels.filter((l) => l !== label);
      onAnswerChange({ kind: 'selection', selectedLabels: next });
    } else if (nextChecked) {
      onAnswerChange({ kind: 'selection', selectedLabels: [label] });
    }
  };

  const selectOther = () => {
    onAnswerChange({ kind: 'other', text: otherText });
  };

  return (
    <div
      className={cn(
        'rounded-2xl border border-[#E8E8E8] p-4 flex flex-col gap-3 bg-white',
        disabled && 'opacity-60',
      )}
    >
      <span className="inline-block self-start text-[10px] uppercase tracking-wider font-bold bg-[#FAFAFA] border border-[#E8E8E8] rounded-md px-2 py-0.5 text-gray-900">
        {question.title}
      </span>
      <p className="text-sm text-gray-900">{question.prompt}</p>

      <div className="flex flex-col gap-2">
        {question.options.map((opt) => (
          <OptionRow
            key={opt.label}
            name={questionId}
            value={opt.label}
            type={question.multiSelect ? 'checkbox' : 'radio'}
            label={opt.label}
            description={opt.description}
            checked={selectedLabels.includes(opt.label)}
            disabled={disabled}
            onChange={(checked) => toggleSelection(opt.label, checked)}
          />
        ))}

        <OptionRow
          name={questionId}
          value={OTHER_VALUE}
          type={question.multiSelect ? 'checkbox' : 'radio'}
          label="Other (specify)"
          description="Type your own answer."
          checked={isOther}
          disabled={disabled}
          onChange={(checked) => {
            if (checked) selectOther();
          }}
        />

        {isOther && (
          <input
            type="text"
            placeholder="Specify..."
            value={otherText}
            disabled={disabled}
            onChange={(e) => {
              setOtherText(e.target.value);
              onAnswerChange({ kind: 'other', text: e.target.value });
            }}
            className="text-sm border border-[#E8E8E8] rounded-lg px-3 py-2"
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && bun run test src/components/DecisionQuestions/__tests__/QuestionCard.test.tsx
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DecisionQuestions/QuestionCard.tsx \
        frontend/src/components/DecisionQuestions/__tests__/QuestionCard.test.tsx
git -c commit.gpgsign=false commit -m "feat(frontend): add DecisionQuestions QuestionCard"
```

---

## Task 5: `DecisionQuestions` container (TDD)

**Files:**
- Create: `frontend/src/components/DecisionQuestions/DecisionQuestions.tsx`
- Create: `frontend/src/components/DecisionQuestions/index.tsx`
- Test: `frontend/src/components/DecisionQuestions/__tests__/DecisionQuestions.test.tsx`

Container holds the answers state, computes "is everything answered?", renders the stack + submit button, and flattens on click. Receives `submitted` from the parent so post-submit state is owned upstream (chat message metadata, survives re-mount).

- [ ] **Step 1: Write failing test**

```tsx
// frontend/src/components/DecisionQuestions/__tests__/DecisionQuestions.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DecisionQuestions } from '../DecisionQuestions';
import type { Question } from '../types';

const questions: Question[] = [
  {
    title: 'Stage',
    prompt: 'Are you pre- or post-revenue?',
    options: [
      { label: 'Pre-revenue (Recommended)', description: 'No paying customers yet.' },
      { label: 'Post-revenue', description: 'At least one paying customer.' },
    ],
    multiSelect: false,
  },
  {
    title: 'Timing',
    prompt: 'When do you need a co-founder in place?',
    options: [
      { label: 'In the next month', description: 'Urgent.' },
      { label: 'In the next quarter', description: 'Soon.' },
    ],
    multiSelect: false,
  },
];

describe('DecisionQuestions', () => {
  it('renders all questions stacked and disables submit until all answered', () => {
    render(
      <DecisionQuestions
        questions={questions}
        submitted={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText('Stage')).toBeInTheDocument();
    expect(screen.getByText('Timing')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: /submit/i });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getAllByLabelText(/Pre-revenue \(Recommended\)/)[0]);
    expect(submit).toBeDisabled(); // 1 of 2 answered

    fireEvent.click(screen.getAllByLabelText(/In the next month/)[0]);
    expect(submit).toBeEnabled();
  });

  it('submit flattens answers and calls onSubmit', () => {
    const onSubmit = vi.fn();
    render(
      <DecisionQuestions
        questions={questions}
        submitted={false}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getAllByLabelText(/Pre-revenue \(Recommended\)/)[0]);
    fireEvent.click(screen.getAllByLabelText(/In the next month/)[0]);
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      'Stage (Are you pre- or post-revenue?): Pre-revenue (Recommended)\n' +
        'Timing (When do you need a co-founder in place?): In the next month',
    );
  });

  it('empty Other counts as unanswered', () => {
    render(
      <DecisionQuestions
        questions={[questions[0]]}
        submitted={false}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Other \(specify\)/));
    const submit = screen.getByRole('button', { name: /submit/i });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Specify...'), {
      target: { value: 'somewhere else' },
    });
    expect(submit).toBeEnabled();
  });

  it('when submitted, shows "Submitted." caption and disables inputs', () => {
    render(
      <DecisionQuestions
        questions={questions}
        submitted
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/submitted\./i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/Pre-revenue \(Recommended\)/)[0]).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && bun run test src/components/DecisionQuestions/__tests__/DecisionQuestions.test.tsx
```

Expected: FAIL with "Cannot find module '../DecisionQuestions'".

- [ ] **Step 3: Write the container**

```tsx
// frontend/src/components/DecisionQuestions/DecisionQuestions.tsx
import { useState } from 'react';
import { QuestionCard } from './QuestionCard';
import { flattenAnswers, type Answer } from './flatten';
import type { Question } from './types';

interface DecisionQuestionsProps {
  questions: Question[];
  submitted: boolean;
  onSubmit: (flattened: string) => void;
}

function isAnswered(a: Answer | null): boolean {
  if (!a) return false;
  if (a.kind === 'selection') return a.selectedLabels.length > 0;
  return a.text.trim().length > 0;
}

export function DecisionQuestions({
  questions,
  submitted,
  onSubmit,
}: DecisionQuestionsProps) {
  const [answers, setAnswers] = useState<(Answer | null)[]>(() =>
    questions.map(() => null),
  );

  const setAt = (idx: number, next: Answer) =>
    setAnswers((prev) => prev.map((a, i) => (i === idx ? next : a)));

  const allAnswered = answers.every(isAnswered);

  return (
    <div className="mt-3 flex flex-col gap-3">
      {questions.map((q, i) => (
        <QuestionCard
          key={`${q.title}-${i}`}
          questionId={`dq-${i}`}
          question={q}
          answer={answers[i]}
          disabled={submitted}
          onAnswerChange={(next) => setAt(i, next)}
        />
      ))}
      {submitted ? (
        <span className="text-xs text-gray-500 self-end">Submitted.</span>
      ) : (
        <button
          type="button"
          disabled={!allAnswered}
          onClick={() =>
            onSubmit(flattenAnswers(questions, answers as Answer[]))
          }
          className="self-end px-4 py-2 rounded-full bg-black text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Submit
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the barrel**

```tsx
// frontend/src/components/DecisionQuestions/index.tsx
export { DecisionQuestions } from './DecisionQuestions';
export type { Question, QuestionOption } from './types';
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd frontend && bun run test src/components/DecisionQuestions/__tests__/
```

Expected: all suites pass (flatten 4, QuestionCard 5, DecisionQuestions 4 = 13 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/DecisionQuestions/DecisionQuestions.tsx \
        frontend/src/components/DecisionQuestions/index.tsx \
        frontend/src/components/DecisionQuestions/__tests__/DecisionQuestions.test.tsx
git -c commit.gpgsign=false commit -m "feat(frontend): add DecisionQuestions container"
```

---

## Task 6: SSE wiring in `AIChatContext`

**Files:**
- Modify: `frontend/src/contexts/AIChatContext.tsx`

Three changes:

1. Import the local `Question` type.
2. Extend `ChatMessage`: add `decisionQuestions?: Question[]` and `decisionQuestionsSubmitted?: boolean`.
3. Add a `case "decision_questions":` branch in the SSE switch that appends `event.questions` to the assistant message's `decisionQuestions` (handle multi-emit by concatenating — the Slice 3 chat agent emits once per orchestrator turn but be tolerant).
4. In the `case "done":` branch, **also** read `event.decisionQuestions` (Slice 3 attaches it to `done`) — use it if present and the message has no `decisionQuestions` yet. This is the cold-load path: when the SSE stream collapses to just the `done` event on session rehydrate, we still get the questions.
5. In `loadSession`, hydrate `decisionQuestions` and `decisionQuestionsSubmitted` from message metadata if present.

> The Slice 3 protocol code stores `done.decisionQuestions` on the assistant message via the chat agent path — confirm by searching `backend/src/services/chat-session.service.ts` or the chat controller for how `done.decisionQuestions` is persisted onto the assistant message row. If it is not yet persisted, that is fine for v1 — fresh-stream rendering still works; rehydration after reload will be empty until a separate persistence change lands.

- [ ] **Step 1: Add the type import and ChatMessage fields**

Find the imports block at top of `frontend/src/contexts/AIChatContext.tsx` and add:

```ts
import type { Question } from '@/components/DecisionQuestions/types';
```

Then extend `interface ChatMessage` (around line 105). Add these two fields:

```ts
  /** Decision questions to render below this assistant message (orchestrator path). */
  decisionQuestions?: Question[];
  /** True once the user has submitted answers; disables/mutes the renderer. */
  decisionQuestionsSubmitted?: boolean;
```

- [ ] **Step 2: Add the `decision_questions` case in the SSE switch**

Find the SSE switch (`switch (event.type)` near line 361). Add this case before `"done":`:

```ts
                  case "decision_questions": {
                    const incoming = (event.questions ?? []) as Question[];
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;
                        const existing = msg.decisionQuestions ?? [];
                        return {
                          ...msg,
                          decisionQuestions: [...existing, ...incoming],
                        };
                      }),
                    );
                    break;
                  }
```

- [ ] **Step 3: In the `done` case, hydrate `decisionQuestions` from the done payload**

Find `case "done":` (around line 652). Inside the `setMessages` updater, currently:

```ts
                        return {
                          ...msg,
                          content: finalContent,
                          isStreaming: false,
                        };
```

Replace with:

```ts
                        const fromDone = Array.isArray(event.decisionQuestions)
                          ? (event.decisionQuestions as Question[])
                          : undefined;
                        const decisionQuestions =
                          msg.decisionQuestions && msg.decisionQuestions.length > 0
                            ? msg.decisionQuestions
                            : fromDone;
                        return {
                          ...msg,
                          content: finalContent,
                          isStreaming: false,
                          ...(decisionQuestions ? { decisionQuestions } : {}),
                        };
```

- [ ] **Step 4: In `loadSession`, hydrate persisted decisionQuestions**

Find `loadSession` (around line 796). The `data.messages` shape currently includes `traceEvents`, `streamingDrafts`, `debugMeta`. Add `decisionQuestions?` to the inline type:

```ts
          traceEvents?: TraceEvent[];
          streamingDrafts?: StreamingDraft[] | null;
          decisionQuestions?: Question[] | null;
          decisionQuestionsSubmitted?: boolean | null;
          debugMeta?: {
```

And in the `data.messages.map(...)` body, spread these in alongside `streamingDrafts`:

```ts
          ...(Array.isArray(m.decisionQuestions) && m.decisionQuestions.length > 0
            ? { decisionQuestions: m.decisionQuestions }
            : {}),
          ...(m.decisionQuestionsSubmitted
            ? { decisionQuestionsSubmitted: true }
            : {}),
```

> Server-side persistence of these fields is **out of scope** for Slice 4 per the spec. If the backend does not yet return them, this loadSession code is a no-op until a future slice persists them. Wiring it now means no follow-up frontend change later.

- [ ] **Step 5: Run lint and timeline test (smoke check the file still compiles)**

```bash
cd frontend && bun run lint
cd frontend && bun run test src/components/chat/timeline.test.ts
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/contexts/AIChatContext.tsx
git -c commit.gpgsign=false commit -m "feat(frontend): route decision_questions SSE event onto assistant message"
```

---

## Task 7: Render block in `ChatContent`

**Files:**
- Modify: `frontend/src/components/ChatContent.tsx`

Add a render branch after the existing `streamingDrafts` block (around line 1779, right before the closing `</div>` of the per-message wrapper). It mounts `<DecisionQuestions>` and wires `onSubmit` to call `sendMessage(flattened)` from `useAIChat()`, then marks the message as submitted in local component state so subsequent renders pass `submitted={true}`.

The "submitted" flag uses a per-message-id `Set<string>` in component state — keeps it client-only without needing a context API change.

- [ ] **Step 1: Add the submitted-ids state near the top of `ChatContent`**

Find the existing state hooks at the top of the `ChatContent` component body. Add:

```tsx
  const [decisionQuestionsSubmittedIds, setDecisionQuestionsSubmittedIds] = useState<
    Set<string>
  >(() => new Set());
```

(Add `useState` to the existing `react` import if it is not already imported — most components in this file already use `useState`.)

- [ ] **Step 2: Add the render block**

Inside `messages.map((msg) => (...))`, locate the `streamingDrafts` block (`msg.role === "assistant" && msg.streamingDrafts && ...`) ending around line 1779. Immediately after the closing `)}` of that block (still inside the per-message `<div>` keyed by `msg.id`), insert:

```tsx
                {msg.role === "assistant" &&
                  msg.decisionQuestions &&
                  msg.decisionQuestions.length > 0 && (
                    <DecisionQuestions
                      questions={msg.decisionQuestions}
                      submitted={
                        msg.decisionQuestionsSubmitted ??
                        decisionQuestionsSubmittedIds.has(msg.id)
                      }
                      onSubmit={(flattened) => {
                        setDecisionQuestionsSubmittedIds((prev) => {
                          const next = new Set(prev);
                          next.add(msg.id);
                          return next;
                        });
                        sendMessage(flattened);
                      }}
                    />
                  )}
```

- [ ] **Step 3: Add the import**

At the top of `frontend/src/components/ChatContent.tsx`, add (near the other component imports — e.g. after `OpportunityDivider` / `InlineDiscoveryCard` / `OpportunityCardInChat`):

```ts
import { DecisionQuestions } from '@/components/DecisionQuestions';
```

- [ ] **Step 4: Verify `sendMessage` is in scope**

Search the file for `sendMessage` — it should already be destructured from `useAIChat()` near the top of the `ChatContent` body. If it is not, add it.

```bash
grep -n "sendMessage" frontend/src/components/ChatContent.tsx | head
```

Expected: at least one match showing it destructured from `useAIChat()`.

- [ ] **Step 5: Lint**

```bash
cd frontend && bun run lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ChatContent.tsx
git -c commit.gpgsign=false commit -m "feat(frontend): render DecisionQuestions in chat message stream"
```

---

## Task 8: Manual smoke test

- [ ] **Step 1: Start backend and frontend**

In two terminals (from the worktree root):

```bash
cd backend && ENABLE_DISCOVERY_QUESTIONS=true bun run dev
cd frontend && bun run dev
```

- [ ] **Step 2: Trigger orchestrator discovery**

In the chat UI on `http://localhost:5173/`, send a discovery-style intent prompt that routes to the orchestrator (anything that produces opportunity cards). After the cards stream in, verify:
- A stack of question cards renders below the opportunity cards.
- Each card has the title chip, prompt, options with descriptions, and an "Other (specify)" row.
- Submit button is disabled until every question has a selection (or non-empty Other).
- Clicking Submit posts the flattened multi-line user message as the next turn and the orchestrator responds normally.
- After submit, the questions block shows "Submitted." and the inputs are visually muted.

- [ ] **Step 3: If anything is wrong, fix and re-commit before proceeding to Task 9.**

---

## Task 9: Final checks & finishing

- [ ] **Step 1: Run all DecisionQuestions tests**

```bash
cd frontend && bun run test src/components/DecisionQuestions/__tests__/
```

Expected: all green.

- [ ] **Step 2: Run frontend lint**

```bash
cd frontend && bun run lint
```

Expected: clean.

- [ ] **Step 3: Stop. Hand back to the user.**

Per project memory (`feedback_finishing_branch.md`), do **not** auto-merge or auto-push. Report PR-ready status and let the user decide the merge path.

---

## Risks / Open Questions (carried from spec)

- **`done.decisionQuestions` persistence path.** Slice 3 emits the field on the `done` event but may not yet persist it to the assistant-message row. Frontend handles this gracefully — fresh streams render correctly; the `loadSession` hydration is a no-op until backend persistence lands. No blocker.
- **Flattening format.** Plain text is simple but loses multi-question structure for the chat agent. Acceptable for v1 per the spec; iterate if observed problems.
- **Resubmission.** Not supported in v1; user re-asks the orchestrator.
