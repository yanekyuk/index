import { useId, useState } from 'react';
import { QuestionCard } from './QuestionCard';
import { flattenAnswers, type Answer } from './flatten';
import type { Question } from './types';

interface DecisionQuestionsProps {
  questions: Question[];
  submitted: boolean;
  onSubmit: (flattened: string) => void;
}

function isAnswered(a: Answer | null | undefined): boolean {
  if (!a) return false;
  if (a.kind === 'selection') return a.selectedLabels.length > 0;
  return a.text.trim().length > 0;
}

export function DecisionQuestions({
  questions,
  submitted,
  onSubmit,
}: DecisionQuestionsProps) {
  // Per-instance prefix prevents radio-group `name` collisions when multiple
  // DecisionQuestions render in the transcript at once.
  const baseId = useId();

  const [answers, setAnswers] = useState<(Answer | null)[]>(() =>
    questions.map(() => null),
  );

  const setAt = (idx: number, next: Answer) =>
    setAnswers((prev) => {
      // Pad to current questions length in case the prop grew via SSE multi-emit.
      const padded =
        prev.length >= questions.length
          ? prev
          : [...prev, ...new Array(questions.length - prev.length).fill(null)];
      return padded.map((a, i) => (i === idx ? next : a));
    });

  // Iterate `questions` (not `answers`) so a grown questions array marks
  // the new slots as unanswered rather than relying on `answers.every`,
  // which is vacuously true for an empty trailing range.
  const allAnswered =
    questions.length > 0 && questions.every((_, i) => isAnswered(answers[i]));

  return (
    <div className="mt-3 flex flex-col gap-3">
      {questions.map((q, i) => (
        <QuestionCard
          key={`${q.title}-${i}`}
          questionId={`${baseId}-${i}`}
          question={q}
          answer={answers[i] ?? null}
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
          onClick={() => {
            const padded = questions.map((_, i) => answers[i] ?? null);
            if (!padded.every(isAnswered)) return;
            onSubmit(flattenAnswers(questions, padded as Answer[]));
          }}
          className="self-end px-4 py-2 rounded-full bg-black text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Submit
        </button>
      )}
    </div>
  );
}
