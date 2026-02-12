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
    status: 'latent',
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
  });
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
