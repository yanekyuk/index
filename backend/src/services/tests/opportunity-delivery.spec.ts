import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import { agents, opportunities, users } from '../../schemas/database.schema';
import { OpportunityDeliveryService } from '../opportunity-delivery.service';
import type { RenderedCard } from '../opportunity-delivery.service';

// ─────────────────────────────────────────────────────────────────────────────
// Stubs — never call LLM or real DB adapters
// ─────────────────────────────────────────────────────────────────────────────

const STUB_CARD: RenderedCard = {
  headline: 'H',
  personalizedSummary: 'S',
  suggestedAction: 'A',
  narratorRemark: 'N',
};

class StubPresenter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async presentHomeCard(_input: any): Promise<typeof STUB_CARD & { mutualIntentsLabel: string }> {
    return { ...STUB_CARD, mutualIntentsLabel: 'Shared interests' };
  }
}

const stubPresenterDb = {
  async getProfile(_userId: string) {
    return {
      identity: { name: 'Test User', bio: '', location: '' },
      attributes: { skills: [], interests: [] },
      narrative: { context: '' },
    } as unknown as Awaited<ReturnType<import('@indexnetwork/protocol').PresenterDatabase['getProfile']>>;
  },
  async getActiveIntents(_userId: string) {
    return [] as Awaited<ReturnType<import('@indexnetwork/protocol').PresenterDatabase['getActiveIntents']>>;
  },
  async getNetwork(_networkId: string) {
    return null;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function seedUser(): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email: `test-${randomUUID()}@example.com`, name: 'Test User' })
    .returning({ id: users.id });
  return user.id;
}

async function seedAgent(userId: string, notifyOnOpportunity = true): Promise<string> {
  const [agent] = await db
    .insert(agents)
    .values({ ownerId: userId, name: 'test-agent', type: 'personal', notifyOnOpportunity })
    .returning({ id: agents.id });
  return agent.id;
}

async function seedOpportunity(
  actorUserIds: string[],
  status: 'pending' | 'draft',
  createdByUserId?: string | null,
): Promise<string> {
  const actors = actorUserIds.map((userId) => ({ userId, role: 'peer' }));
  const detection: Record<string, unknown> = { kind: 'test', summary: 'test summary' };
  if (status === 'draft' && createdByUserId !== undefined) {
    detection.createdBy = createdByUserId;
  }
  const [opp] = await db
    .insert(opportunities)
    .values({
      detection: detection as never,
      actors: actors as never,
      interpretation: { reasoning: 'test reasoning', category: 'test' } as never,
      context: {} as never,
      confidence: '0.9',
      status,
    })
    .returning({ id: opportunities.id });
  return opp.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('OpportunityDeliveryService.pickupPending', () => {
  const service = new OpportunityDeliveryService(
    new StubPresenter() as never,
    stubPresenterDb as never,
  );

  beforeEach(async () => {
    // Full wipe: order matters (FK constraints)
    await db.execute(sql`DELETE FROM opportunity_deliveries`);
    await db.execute(sql`DELETE FROM opportunities`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM opportunity_deliveries`);
    await db.execute(sql`DELETE FROM opportunities`);
  });

  // ── 1. Pending opp with notify_on_opportunity = true ─────────────────────

  it('returns a pending opportunity when the agent owner is an actor and notify_on_opportunity is true', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId, true);
    const oppId = await seedOpportunity([userId], 'pending');

    const result = await service.pickupPending(agentId);

    expect(result).not.toBeNull();
    expect(result!.opportunityId).toBe(oppId);
  });

  // ── 2. notify_on_opportunity = false mutes all results ───────────────────

  it('returns null when the agent has notify_on_opportunity = false', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId, false);
    await seedOpportunity([userId], 'pending');

    const result = await service.pickupPending(agentId);

    expect(result).toBeNull();
  });

  // ── 3. Draft opp delivered to non-initiator actor ────────────────────────

  it('returns a draft opportunity to an actor who is NOT the initiator', async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const agentB = await seedAgent(userB, true);
    // userA is the initiator; userB is also an actor
    const oppId = await seedOpportunity([userA, userB], 'draft', userA);

    const result = await service.pickupPending(agentB);

    expect(result).not.toBeNull();
    expect(result!.opportunityId).toBe(oppId);
  });

  // ── 4. Draft opp NOT delivered to the initiator ─────────────────────────

  it('does NOT return a draft opportunity to the initiator', async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const agentA = await seedAgent(userA, true);
    // userA is the initiator
    await seedOpportunity([userA, userB], 'draft', userA);

    const result = await service.pickupPending(agentA);

    expect(result).toBeNull();
  });

  // ── 5. Draft opp with null detection.createdBy throws ───────────────────

  it('throws orchestrator_opp_missing_creator when a draft opp has null detection.createdBy', async () => {
    const userA = await seedUser();
    const agentA = await seedAgent(userA, true);
    // seed a draft opp with createdBy explicitly null (omit from detection)
    const [opp] = await db
      .insert(opportunities)
      .values({
        detection: { kind: 'test', summary: 'no creator' } as never,
        actors: [{ userId: userA, role: 'peer' }] as never,
        interpretation: { reasoning: 'test', category: 'test' } as never,
        context: {} as never,
        confidence: '0.9',
        status: 'draft',
      })
      .returning({ id: opportunities.id });
    expect(opp.id).toBeTruthy();

    await expect(service.pickupPending(agentA)).rejects.toThrow('orchestrator_opp_missing_creator');
  });
});
