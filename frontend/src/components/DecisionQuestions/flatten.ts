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
