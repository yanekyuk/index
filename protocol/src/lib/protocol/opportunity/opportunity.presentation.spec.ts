/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect } from 'bun:test';
import { presentOpportunity } from './opportunity.presentation';
import type { Opportunity } from '../interfaces/database.interface';

describe('presentOpportunity', () => {
  const baseOpp: Opportunity = {
    id: 'opp-1',
    detection: { source: 'manual', timestamp: new Date().toISOString() },
    actors: [
      { role: 'agent', identityId: 'alice', intents: [], profile: true },
      { role: 'patient', identityId: 'bob', intents: [], profile: false },
    ],
    interpretation: {
      category: 'collaboration',
      summary: 'Alice can help Bob with React.',
      confidence: 0.85,
    },
    context: { indexId: 'idx-1' },
    indexId: 'idx-1',
    confidence: '0.85',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  };

  test('agent role: title and description for viewer as agent', () => {
    const result = presentOpportunity(
      baseOpp,
      'alice',
      { id: 'bob', name: 'Bob', avatar: null },
      null,
      'card'
    );
    expect(result.title).toBe('You can help Bob');
    expect(result.description).toContain('Bob might benefit from connecting with you');
    expect(result.callToAction).toBe('View Opportunity');
  });

  test('patient role: title and description for viewer as patient', () => {
    const result = presentOpportunity(
      baseOpp,
      'bob',
      { id: 'alice', name: 'Alice', avatar: null },
      null,
      'card'
    );
    expect(result.title).toBe('Alice might be able to help you');
    expect(result.description).toContain("Alice has skills that align");
  });

  test('throws when viewer is not an actor', () => {
    expect(() =>
      presentOpportunity(
        baseOpp,
        'charlie',
        { id: 'alice', name: 'Alice', avatar: null },
        null,
        'card'
      )
    ).toThrow('Viewer is not an actor in this opportunity');
  });

  test('notification format truncates long description', () => {
    const longSummary = 'A'.repeat(150);
    const opp: Opportunity = {
      ...baseOpp,
      interpretation: { ...baseOpp.interpretation, summary: longSummary },
    };
    const result = presentOpportunity(
      opp,
      'alice',
      { id: 'bob', name: 'Bob', avatar: null },
      null,
      'notification'
    );
    expect(result.description.length).toBeLessThanOrEqual(100);
    if (result.description.length >= 100) {
      expect(result.description.slice(-3)).toBe('...');
    }
  });
});
