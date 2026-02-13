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

/** Minimal opportunity: viewer as patient, other as agent, pending. Use when viewer should be patient (e.g. with introducer). */
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

/** Pending opportunity with viewer as agent (actionable for agent without introducer). */
function minimalOpportunityAgentViewer(viewerId: string, otherId: string, id = 'opp-minimal'): Opportunity {
  return {
    id,
    detection: { source: 'manual', timestamp: new Date().toISOString() },
    actors: [
      { userId: viewerId, role: 'agent', indexId: 'idx-1' },
      { userId: otherId, role: 'patient', indexId: 'idx-1' },
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
    const opp = minimalOpportunityAgentViewer(viewerId, otherId);
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
    expect(firstItem.opportunityId).toBe(opp.id);
    expect(typeof firstItem.primaryActionLabel).toBe('string');
    expect(typeof firstItem.secondaryActionLabel).toBe('string');
    expect(typeof firstItem.mutualIntentsLabel).toBe('string');
    expect(resolveHomeSectionIcon(firstSection.iconName)).toBeDefined();
  }, 30000);

  test('actor-dedupes multiple opportunities between same actors to one card', async () => {
    const viewerId = 'viewer-1';
    const otherId = 'other-1';
    const opp1 = minimalOpportunityAgentViewer(viewerId, otherId, 'opp-1');
    const opp2 = minimalOpportunityAgentViewer(viewerId, otherId, 'opp-2');
    opp2.interpretation = { reasoning: 'You could also collaborate on early startup team formation.', category: 'connection', confidence: 0.8 };
    const db = createMockDb([opp1, opp2]);
    const graph = new HomeGraphFactory(db).createGraph();

    const result = await graph.invoke({ userId: viewerId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(1);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(1);
    const firstItem = result.sections[0]?.items[0];
    expect(firstItem).toBeDefined();
    expect(firstItem?.name).toBe('User other-1');
    expect(firstItem?.opportunityId).toBeDefined();
    expect(['opp-1', 'opp-2']).toContain(firstItem?.opportunityId);
  }, 30000);

  test('actor-dedupes opportunities with same non-introducer actors to one card', async () => {
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
    expect(result.meta.totalOpportunities).toBe(1);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(1);
    const firstItem = result.sections[0]?.items[0];
    expect(firstItem?.userId).toBe(otherId);
    expect(firstItem?.opportunityId).toBeDefined();
    expect(['opp-intro-a', 'opp-intro-b']).toContain(firstItem?.opportunityId);
  }, 30000);

  test('shows transitional card for agent-with-introducer at accepted', async () => {
    const introducerId = 'intro-1';
    const patientId = 'patient-1';
    const agentId = 'agent-1';
    const acceptedWithIntroducer: Opportunity = {
      id: 'opp-accepted-intro',
      detection: { source: 'manual', timestamp: new Date().toISOString() },
      actors: [
        { userId: introducerId, role: 'introducer', indexId: 'idx-1' },
        { userId: patientId, role: 'patient', indexId: 'idx-1' },
        { userId: agentId, role: 'agent', indexId: 'idx-1' },
      ],
      interpretation: { reasoning: 'Agent sees this for the first time at accepted.', category: 'connection', confidence: 0.8 },
      context: { indexId: 'idx-1' },
      confidence: '0.8',
      status: 'accepted',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const db = createMockDb([acceptedWithIntroducer]);
    const result = await new HomeGraphFactory(db).createGraph().invoke({ userId: agentId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(1);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(1);
    expect(result.sections[0]?.items[0]?.opportunityId).toBe('opp-accepted-intro');
  }, 30000);

  test('excludes accepted opportunities for patient role', async () => {
    const viewerId = 'viewer-1';
    const otherId = 'other-1';
    const acceptedOpp: Opportunity = {
      id: 'opp-accepted',
      detection: { source: 'manual', timestamp: new Date().toISOString() },
      actors: [
        { userId: viewerId, role: 'patient', indexId: 'idx-1' },
        { userId: otherId, role: 'agent', indexId: 'idx-1' },
      ],
      interpretation: { reasoning: 'Accepted.', category: 'connection', confidence: 0.8 },
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
    expect(result.meta.totalOpportunities).toBe(0);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(0);
  }, 30000);

  test('shows latent opportunity for introducer but not pending', async () => {
    const viewerId = 'intro-1';
    const memberA = 'member-a';
    const memberB = 'member-b';
    const latentOpportunity: Opportunity = {
      id: 'opp-introducer-latent',
      detection: { source: 'manual', timestamp: new Date().toISOString() },
      actors: [
        { userId: viewerId, role: 'introducer', indexId: 'idx-1' },
        { userId: memberA, role: 'patient', indexId: 'idx-1' },
        { userId: memberB, role: 'agent', indexId: 'idx-1' },
      ],
      interpretation: {
        reasoning: 'These two members should meet based on aligned goals.',
        category: 'connection',
        confidence: 0.9,
      },
      context: { indexId: 'idx-1' },
      confidence: '0.9',
      status: 'latent',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const db = createMockDb([latentOpportunity]);
    const result = await new HomeGraphFactory(db).createGraph().invoke({ userId: viewerId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(1);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(1);
    expect(result.sections[0]?.items[0]?.opportunityId).toBe('opp-introducer-latent');
  }, 70000);

  test('introducer does not see pending opportunity in feed', async () => {
    const viewerId = 'intro-1';
    const memberA = 'member-a';
    const memberB = 'member-b';
    const pendingOpportunity: Opportunity = {
      id: 'opp-introducer-pending',
      detection: { source: 'manual', timestamp: new Date().toISOString() },
      actors: [
        { userId: viewerId, role: 'introducer', indexId: 'idx-1' },
        { userId: memberA, role: 'patient', indexId: 'idx-1' },
        { userId: memberB, role: 'agent', indexId: 'idx-1' },
      ],
      interpretation: { reasoning: 'Pending.', category: 'connection', confidence: 0.9 },
      context: { indexId: 'idx-1' },
      confidence: '0.9',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const db = createMockDb([pendingOpportunity]);
    const result = await new HomeGraphFactory(db).createGraph().invoke({ userId: viewerId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(0);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(0);
  }, 30000);

  test('agent without introducer sees pending but not latent', async () => {
    const patientId = 'patient-1';
    const agentId = 'agent-1';
    const pendingOpp: Opportunity = {
      id: 'opp-pending-no-intro',
      detection: { source: 'manual', timestamp: new Date().toISOString() },
      actors: [
        { userId: patientId, role: 'patient', indexId: 'idx-1' },
        { userId: agentId, role: 'agent', indexId: 'idx-1' },
      ],
      interpretation: { reasoning: 'Patient sent; agent can accept.', category: 'connection', confidence: 0.8 },
      context: { indexId: 'idx-1' },
      confidence: '0.8',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const db = createMockDb([pendingOpp]);
    const result = await new HomeGraphFactory(db).createGraph().invoke({ userId: agentId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(1);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(1);
    expect(result.sections[0]?.items[0]?.opportunityId).toBe('opp-pending-no-intro');
  }, 30000);

  test('agent without introducer does not see latent opportunity', async () => {
    const patientId = 'patient-1';
    const agentId = 'agent-1';
    const latentOpp: Opportunity = {
      id: 'opp-latent-no-intro',
      detection: { source: 'manual', timestamp: new Date().toISOString() },
      actors: [
        { userId: patientId, role: 'patient', indexId: 'idx-1' },
        { userId: agentId, role: 'agent', indexId: 'idx-1' },
      ],
      interpretation: { reasoning: 'Latent.', category: 'connection', confidence: 0.8 },
      context: { indexId: 'idx-1' },
      confidence: '0.8',
      status: 'latent',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const db = createMockDb([latentOpp]);
    const result = await new HomeGraphFactory(db).createGraph().invoke({ userId: agentId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(0);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(0);
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
