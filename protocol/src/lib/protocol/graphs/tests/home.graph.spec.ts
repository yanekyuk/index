/**
 * Home Graph: tests for load → cards → categorize → sections.
 */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, test, expect } from 'bun:test';
import { HomeGraphFactory } from '../home.graph';
import type { HomeGraphDatabase } from '../../interfaces/database.interface';
import type { Opportunity } from '../../interfaces/database.interface';
import { resolveHomeSectionIcon, DEFAULT_HOME_SECTION_ICON, getIconNamesForPrompt } from '../../support/lucide.icon-catalog';

function createMockDb(opportunities: Opportunity[] = []): HomeGraphDatabase {
  return {
    getOpportunitiesForUser: () => Promise.resolve(opportunities),
    getOpportunity: () => Promise.resolve(null),
    getProfile: () => Promise.resolve(null),
    getActiveIntents: () => Promise.resolve([]),
    getIndex: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
    getUser: (id: string) => Promise.resolve({ id, name: 'User ' + id, email: '', avatar: null }),
  };
}

/** Minimal opportunity so visibility allows viewer and gatherPresenterContext can run. */
function minimalOpportunity(viewerId: string, otherId: string): Opportunity {
  return {
    id: 'opp-minimal',
    detection: { source: 'manual', timestamp: new Date().toISOString() },
    actors: [
      { userId: viewerId, role: 'patient', indexId: 'idx-1' },
      { userId: otherId, role: 'agent', indexId: 'idx-1' },
    ],
    interpretation: { reasoning: 'Test match.', category: 'connection', confidence: 0.8 },
    context: { indexId: 'idx-1' },
    confidence: '0.8',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  };
}

function minimalOpportunityWithId(viewerId: string, otherId: string, id: string, reasoning: string): Opportunity {
  return {
    id,
    detection: { source: 'manual', timestamp: new Date().toISOString() },
    actors: [
      { userId: viewerId, role: 'patient', indexId: 'idx-1' },
      { userId: otherId, role: 'agent', indexId: 'idx-1' },
    ],
    interpretation: { reasoning, category: 'connection', confidence: 0.8 },
    context: { indexId: 'idx-1' },
    confidence: '0.8',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  };
}

describe('HomeGraph', () => {
  test('no opportunities returns empty sections and meta', async () => {
    const db = createMockDb([]);
    const factory = new HomeGraphFactory(db);
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId: 'user-1', limit: 50 });
    expect(result.error).toBeUndefined();
    expect(result.sections).toEqual([]);
    expect(result.meta).toEqual({ totalOpportunities: 0, totalSections: 0 });
  });

  test('missing userId returns error', async () => {
    const db = createMockDb([]);
    const factory = new HomeGraphFactory(db);
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId: '', limit: 50 });
    expect(result.error).toBe('userId is required');
  });

  test('with one opportunity, sections items have presenter-driven fields', async () => {
    const viewerId = 'viewer-1';
    const otherId = 'other-1';
    const opp = minimalOpportunity(viewerId, otherId);
    const db = createMockDb([opp]);
    const factory = new HomeGraphFactory(db);
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId: viewerId, limit: 50 });
    expect(result.error).toBeUndefined();
    expect(result.sections.length).toBeGreaterThanOrEqual(1);
    const firstSection = result.sections[0];
    expect(firstSection.items.length).toBeGreaterThanOrEqual(1);
    const firstItem = firstSection.items[0];
    expect(firstItem).toHaveProperty('primaryActionLabel');
    expect(firstItem).toHaveProperty('secondaryActionLabel');
    expect(firstItem).toHaveProperty('mutualIntentsLabel');
    expect(typeof firstItem.primaryActionLabel).toBe('string');
    expect(typeof firstItem.secondaryActionLabel).toBe('string');
    expect(typeof firstItem.mutualIntentsLabel).toBe('string');
    expect(resolveHomeSectionIcon(firstSection.iconName)).toBeDefined();
  }, 30000);

  test('groups multiple opportunities between same actors into one card', async () => {
    const viewerId = 'viewer-1';
    const otherId = 'other-1';
    const opp1 = minimalOpportunityWithId(
      viewerId,
      otherId,
      'opp-1',
      'You both want to collaborate on recommendation systems.'
    );
    const opp2 = minimalOpportunityWithId(
      viewerId,
      otherId,
      'opp-2',
      'You could also collaborate on early startup team formation.'
    );
    const db = createMockDb([opp1, opp2]);
    const graph = new HomeGraphFactory(db).createGraph();

    const result = await graph.invoke({ userId: viewerId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(2);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(1);
    const firstItem = result.sections[0]?.items[0];
    expect(firstItem).toBeDefined();
    expect(firstItem?.name).toBe('User other-1');
    expect(firstItem?.mainText).toContain('2 opportunities between you and User other-1');
  }, 30000);

  test('groups opportunities by displayed counterpart even across actor sets', async () => {
    const viewerId = 'viewer-1';
    const otherId = 'other-1';
    const introducerA = 'intro-a';
    const introducerB = 'intro-b';
    const now = new Date();

    const withIntroducerA: Opportunity = {
      id: 'opp-intro-a',
      detection: { source: 'manual', timestamp: now.toISOString() },
      actors: [
        { userId: viewerId, role: 'patient', indexId: 'idx-1', intent: 'intent-1' },
        { userId: otherId, role: 'agent', indexId: 'idx-1', intent: 'intent-2' },
        { userId: introducerA, role: 'introducer', indexId: 'idx-1' },
      ],
      interpretation: { reasoning: 'First match for same counterpart via introducer A.', category: 'connection', confidence: 0.8 },
      context: { indexId: 'idx-1' },
      confidence: '0.8',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
    };

    const withIntroducerB: Opportunity = {
      id: 'opp-intro-b',
      detection: { source: 'manual', timestamp: now.toISOString() },
      actors: [
        { userId: viewerId, role: 'patient', indexId: 'idx-1', intent: 'intent-3' },
        { userId: otherId, role: 'agent', indexId: 'idx-1', intent: 'intent-4' },
        { userId: introducerB, role: 'introducer', indexId: 'idx-1' },
      ],
      interpretation: { reasoning: 'Second match for same counterpart via introducer B.', category: 'connection', confidence: 0.9 },
      context: { indexId: 'idx-1' },
      confidence: '0.9',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
    };

    const db = createMockDb([withIntroducerA, withIntroducerB]);
    const result = await new HomeGraphFactory(db).createGraph().invoke({ userId: viewerId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(2);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(1);
    const firstItem = result.sections[0]?.items[0];
    expect(firstItem?.userId).toBe(otherId);
    expect(firstItem?.mainText).toContain(`2 opportunities between you and User ${otherId}`);
  }, 30000);

  test('includes tier-2 visible opportunities per lifecycle visibility rules', async () => {
    const viewerId = 'viewer-1';
    const otherId = 'other-1';
    const acceptedOpp: Opportunity = {
      id: 'opp-accepted',
      detection: { source: 'manual', timestamp: new Date().toISOString() },
      actors: [
        { userId: viewerId, role: 'patient', indexId: 'idx-1' },
        { userId: otherId, role: 'agent', indexId: 'idx-1' },
      ],
      interpretation: { reasoning: 'Accepted opportunities remain visible to all actors.', category: 'connection', confidence: 0.8 },
      context: { indexId: 'idx-1' },
      confidence: '0.8',
      status: 'accepted',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const db = createMockDb([acceptedOpp]);
    const result = await new HomeGraphFactory(db).createGraph().invoke({ userId: viewerId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(1);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(1);
    expect(result.sections[0]?.items[0]?.opportunityId).toBe('opp-accepted');
  }, 30000);
});

describe('Lucide icon catalog', () => {
  test('resolveHomeSectionIcon returns default for unknown name', () => {
    expect(resolveHomeSectionIcon('unknown-icon')).toBe(DEFAULT_HOME_SECTION_ICON);
    expect(resolveHomeSectionIcon('')).toBe(DEFAULT_HOME_SECTION_ICON);
    expect(resolveHomeSectionIcon(null)).toBe(DEFAULT_HOME_SECTION_ICON);
  });

  test('resolveHomeSectionIcon returns valid name for allowed icon', () => {
    expect(resolveHomeSectionIcon('hourglass')).toBe('hourglass');
    expect(resolveHomeSectionIcon('telescope')).toBe('telescope');
    expect(resolveHomeSectionIcon('HOURGLASS')).toBe('hourglass');
  });

  test('getIconNamesForPrompt returns non-empty string', () => {
    const list = getIconNamesForPrompt();
    expect(typeof list).toBe('string');
    expect(list.length).toBeGreaterThan(0);
    expect(list).toContain('hourglass');
  });
});
