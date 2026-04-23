import { describe, expect, test } from 'bun:test';

import { turnPrompt } from '../polling/negotiator/negotiation-turn.prompt.js';

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

  test('renders full action guidance for mid-negotiation turns', () => {
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
