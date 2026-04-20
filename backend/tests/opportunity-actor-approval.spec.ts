import { config } from 'dotenv';
config({ path: '.env.development' });

import { describe, it, expect } from 'bun:test';
import { OpportunityDatabaseAdapter } from '../src/adapters/database.adapter';

describe('updateOpportunityActorApproval', () => {
  const db = new OpportunityDatabaseAdapter();

  it('sets approved=true on the introducer actor without changing status', async () => {
    const opp = await db.createOpportunity({
      detection: { source: 'manual', createdBy: 'test', timestamp: new Date().toISOString() },
      actors: [
        { networkId: 'net-1' as any, userId: 'target-1' as any, role: 'patient' },
        { networkId: 'net-1' as any, userId: 'candidate-1' as any, role: 'agent' },
        { networkId: 'net-1' as any, userId: 'introducer-1' as any, role: 'introducer', approved: false },
      ],
      interpretation: { category: 'collaboration', reasoning: 'test', confidence: 0.8, signals: [] },
      context: { networkId: 'net-1' as any },
      confidence: '0.8',
      status: 'latent',
    });

    const updated = await db.updateOpportunityActorApproval(opp.id, 'introducer-1', true);

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('latent');
    const introducerActor = updated!.actors.find((a: any) => a.role === 'introducer');
    expect(introducerActor?.approved).toBe(true);

    const patientActor = updated!.actors.find((a: any) => a.role === 'patient');
    expect(patientActor?.approved).toBeUndefined();

    await db.updateOpportunityStatus(opp.id, 'expired');
  });
}, { timeout: 30000 });
