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
