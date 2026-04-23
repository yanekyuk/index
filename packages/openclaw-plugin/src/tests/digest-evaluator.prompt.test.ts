import { describe, expect, it } from 'bun:test';
import { digestEvaluatorPrompt } from '../polling/daily-digest/digest-evaluator.prompt.js';

describe('digestEvaluatorPrompt', () => {
  it('includes max count in prompt', () => {
    const prompt = digestEvaluatorPrompt([], 10);
    expect(prompt).toContain('top 10');
  });

  it('formats candidates correctly', () => {
    const prompt = digestEvaluatorPrompt(
      [
        {
          opportunityId: 'opp-123',
          userId: 'user-123',
          headline: 'Test Headline',
          personalizedSummary: 'Test summary',
          suggestedAction: 'Take action',
          narratorRemark: '',
        },
      ],
      5,
    );
    expect(prompt).toContain('opportunityId: opp-123');
    expect(prompt).toContain('headline: Test Headline');
    expect(prompt).toContain('top 5');
  });

  it('includes allowed IDs list', () => {
    const prompt = digestEvaluatorPrompt(
      [
        {
          opportunityId: 'id-1',
          userId: 'user-1',
          headline: 'H1',
          personalizedSummary: 'S1',
          suggestedAction: 'A1',
          narratorRemark: '',
        },
        {
          opportunityId: 'id-2',
          userId: 'user-2',
          headline: 'H2',
          personalizedSummary: 'S2',
          suggestedAction: 'A2',
          narratorRemark: '',
        },
      ],
      10,
    );
    expect(prompt).toContain('id-1, id-2');
  });

  it('instructs to rank by value not pass/fail', () => {
    const prompt = digestEvaluatorPrompt([], 10);
    expect(prompt).toContain('rank');
    expect(prompt).not.toContain('Reject weak');
  });
});
