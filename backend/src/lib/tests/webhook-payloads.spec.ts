import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, expect, it } from 'bun:test';
import {
  buildOpportunityCreatedPayload,
  buildNegotiationTurnReceivedPayload,
} from '../webhook-payloads';

describe('buildOpportunityCreatedPayload', () => {
  const baseOpportunity = {
    id: 'opp-42',
    status: 'draft' as const,
    confidence: '0.87',
    actors: [
      { networkId: 'net-1', userId: 'user-a', role: 'source' },
      { networkId: 'net-1', userId: 'user-b', role: 'candidate' },
    ],
    detection: {
      source: 'intent_match',
      createdByName: 'Alice',
      timestamp: '2026-04-10T10:00:00.000Z',
    },
    interpretation: {
      category: 'collaboration',
      reasoning: 'Both parties want to co-build a developer tool.',
      confidence: 0.87,
      signals: ['shared_skill:typescript', 'shared_intent:dev_tools'],
    },
    context: { networkId: 'net-1' },
    createdAt: new Date('2026-04-10T10:00:00.000Z'),
    updatedAt: new Date('2026-04-10T10:00:00.000Z'),
    expiresAt: null,
  };

  it('maps the full opportunity into a Hermes-friendly shape', () => {
    const payload = buildOpportunityCreatedPayload({
      opportunity: baseOpportunity,
      appUrl: 'https://index.network',
    });

    expect(payload.opportunity_id).toBe('opp-42');
    expect(payload.status).toBe('draft');
    expect(payload.url).toBe('https://index.network/opportunities/opp-42');
    expect(payload.category).toBe('collaboration');
    expect(payload.reasoning).toBe('Both parties want to co-build a developer tool.');
    expect(payload.confidence).toBe(0.87);
    expect(payload.signals).toEqual(['shared_skill:typescript', 'shared_intent:dev_tools']);
    expect(payload.actors).toHaveLength(2);
    expect(payload.actors[0]).toEqual({ user_id: 'user-a', network_id: 'net-1', role: 'source' });
    expect(payload.source).toBe('intent_match');
    expect(payload.created_at).toBe('2026-04-10T10:00:00.000Z');
    expect(payload.expires_at).toBeNull();
  });

  it('tolerates missing interpretation signals and expires_at', () => {
    const payload = buildOpportunityCreatedPayload({
      opportunity: {
        ...baseOpportunity,
        interpretation: {
          category: 'intro',
          reasoning: 'Reason.',
          confidence: 0.5,
        },
      },
      appUrl: 'https://index.network',
    });
    expect(payload.signals).toEqual([]);
    expect(payload.expires_at).toBeNull();
  });

  it('parses confidence string via interpretation.confidence (already numeric)', () => {
    const payload = buildOpportunityCreatedPayload({
      opportunity: { ...baseOpportunity, interpretation: { ...baseOpportunity.interpretation, confidence: 0.42 } },
      appUrl: 'https://index.network',
    });
    expect(payload.confidence).toBe(0.42);
  });
});

describe('buildNegotiationTurnReceivedPayload', () => {
  const sampleTurn = (action: string, message: string | null, reasoning: string) => ({
    action: action as 'propose' | 'accept' | 'reject' | 'counter' | 'question',
    assessment: {
      reasoning,
      suggestedRoles: { ownUser: 'peer' as const, otherUser: 'peer' as const },
    },
    message,
  });

  const basePayload = {
    negotiationId: 'neg-99',
    ownUser: {
      id: 'user-yanki',
      intents: [{ id: 'i1', title: 'Build developer tools', description: 'Looking for collaborators', confidence: 0.9 }],
      profile: { name: 'Yanki', bio: 'Creative technologist', skills: ['ts', 'react'] },
    },
    otherUser: {
      id: 'user-alice',
      intents: [{ id: 'i2', title: 'Co-build CLI', description: 'Looking for a co-founder', confidence: 0.85 }],
      profile: { name: 'Alice', bio: 'CLI hacker', skills: ['rust', 'bash'] },
    },
    indexContext: { networkId: 'net-1', prompt: 'Developer tools network' },
    seedAssessment: {
      reasoning: 'Both build CLI tools.',
      valencyRole: 'peer' as const,
    },
    history: [
      sampleTurn('propose', 'Want to collab on a CLI?', 'Opening with a clear proposal.'),
      sampleTurn('counter', 'Sure, but I want equity.', 'Wants terms beyond scope.'),
      sampleTurn('question', 'What equity split?', 'Probing for specifics.'),
    ],
    isFinalTurn: false,
    isDiscoverer: true,
    discoveryQuery: 'CLI co-builder',
  };

  it('maps the full turn payload with digest and recent turns', () => {
    const payload = buildNegotiationTurnReceivedPayload({
      turnPayload: basePayload,
      userId: 'user-yanki',
      turnNumber: 4,
      deadlineIso: '2026-04-10T11:00:00.000Z',
      appUrl: 'https://index.network',
    });

    expect(payload.negotiation_id).toBe('neg-99');
    expect(payload.url).toBe('https://index.network/negotiations/neg-99');
    expect(payload.turn_number).toBe(4);
    expect(payload.deadline).toBe('2026-04-10T11:00:00.000Z');
    expect(payload.counterparty_action).toBe('question');
    expect(payload.counterparty_message).toBe('What equity split?');
    expect(payload.counterparty_reasoning).toBe('Probing for specifics.');
    expect(payload.sender).toEqual({ user_id: 'user-alice', name: 'Alice', role: 'peer' });
    expect(payload.own_user).toEqual({ user_id: 'user-yanki', name: 'Yanki', role: 'peer' });
    expect(payload.objective).toBe('Both build CLI tools.');
    expect(payload.index_context).toEqual({ network_id: 'net-1', prompt: 'Developer tools network' });
    expect(payload.discovery_query).toBe('CLI co-builder');

    expect(payload.recent_turns).toHaveLength(3);
    expect(payload.recent_turns[0].action).toBe('propose');
    expect(payload.recent_turns[0].message).toBe('Want to collab on a CLI?');
    expect(payload.recent_turns[2].action).toBe('question');

    expect(payload.history_digest.total_turns).toBe(3);
    expect(payload.history_digest.actions_so_far).toEqual(['propose', 'counter', 'question']);
    expect(payload.history_digest.own_intents).toEqual([
      { id: 'i1', title: 'Build developer tools', description: 'Looking for collaborators' },
    ]);
    expect(payload.history_digest.other_intents).toEqual([
      { id: 'i2', title: 'Co-build CLI', description: 'Looking for a co-founder' },
    ]);
  });

  it('tolerates empty history (first turn case)', () => {
    const payload = buildNegotiationTurnReceivedPayload({
      turnPayload: { ...basePayload, history: [] },
      userId: 'user-yanki',
      turnNumber: 1,
      deadlineIso: '2026-04-10T11:00:00.000Z',
      appUrl: 'https://index.network',
    });

    expect(payload.recent_turns).toEqual([]);
    expect(payload.counterparty_action).toBeNull();
    expect(payload.counterparty_message).toBeNull();
    expect(payload.counterparty_reasoning).toBeNull();
    expect(payload.history_digest.total_turns).toBe(0);
    expect(payload.history_digest.actions_so_far).toEqual([]);
  });

  it('truncates recent_turns to the configured window (last 3)', () => {
    const longHistory = Array.from({ length: 7 }, (_, i) =>
      sampleTurn('counter', `msg-${i}`, `reason-${i}`),
    );
    const payload = buildNegotiationTurnReceivedPayload({
      turnPayload: { ...basePayload, history: longHistory },
      userId: 'user-yanki',
      turnNumber: 8,
      deadlineIso: '2026-04-10T11:00:00.000Z',
      appUrl: 'https://index.network',
    });
    expect(payload.recent_turns).toHaveLength(3);
    expect(payload.recent_turns[0].message).toBe('msg-4');
    expect(payload.recent_turns[2].message).toBe('msg-6');
    expect(payload.history_digest.total_turns).toBe(7);
  });
});
