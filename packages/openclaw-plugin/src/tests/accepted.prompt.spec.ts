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
