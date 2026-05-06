import { config } from 'dotenv';
config({ path: '.env.development' });

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { signConnectToken, verifyConnectToken } from '../src/services/connect-token.service';

// ---------------------------------------------------------------------------
// Fake IDs
// ---------------------------------------------------------------------------
const OPP_ID = '00000000-0000-4000-8000-000000000001';
const INTRODUCER_ID = '00000000-0000-4000-8000-000000000002';
const NON_INTRODUCER_ID = '00000000-0000-4000-8000-000000000003';
const OTHER_OPP_ID = '00000000-0000-4000-8000-000000000099';

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------
describe('connect-token helpers', () => {
  it('signConnectToken produces a token verifiable by verifyConnectToken', async () => {
    const token = await signConnectToken(INTRODUCER_ID, OPP_ID);
    const payload = await verifyConnectToken(token);
    expect(payload.sub).toBe(INTRODUCER_ID);
    expect(payload.opp).toBe(OPP_ID);
  });

  it('verifyConnectToken rejects malformed tokens', async () => {
    await expect(verifyConnectToken('garbage.token.here')).rejects.toThrow();
  });

  it('token opp mismatch is detectable', async () => {
    const token = await signConnectToken(INTRODUCER_ID, OTHER_OPP_ID);
    const payload = await verifyConnectToken(token);
    expect(payload.opp).not.toBe(OPP_ID);
  });
});

// ---------------------------------------------------------------------------
// OpportunityService.approveIntroduction unit tests
// ---------------------------------------------------------------------------
describe('OpportunityService.approveIntroduction', () => {
  const makeDb = (overrides: Record<string, unknown> = {}) => ({
    getOpportunityActors: mock(async () => [
      { userId: INTRODUCER_ID, role: 'introducer', approved: false },
    ]),
    updateOpportunityActorApproval: mock(async () => true),
    ...overrides,
  });

  const makeService = (db: ReturnType<typeof makeDb>) => {
    // Dynamically import to avoid top-level env dependency
    const { OpportunityService } = require('../src/services/opportunity.service');
    const svc = new OpportunityService(db);
    // Stub out updateOpportunityStatus so it doesn't hit real DB
    svc.updateOpportunityStatus = mock(async () => null);
    return svc;
  };

  beforeEach(() => {
    mock.restore();
  });

  it('returns error when user is not an introducer', async () => {
    const db = makeDb({
      getOpportunityActors: mock(async () => [
        { userId: NON_INTRODUCER_ID, role: 'candidate', approved: false },
      ]),
    });
    const svc = makeService(db);
    const result = await svc.approveIntroduction(OPP_ID, NON_INTRODUCER_ID);
    expect(result).toHaveProperty('error');
    expect(result.status).toBe(403);
  });

  it('returns error when actor is already approved', async () => {
    const db = makeDb({
      getOpportunityActors: mock(async () => [
        { userId: INTRODUCER_ID, role: 'introducer', approved: true },
      ]),
    });
    const svc = makeService(db);
    const result = await svc.approveIntroduction(OPP_ID, INTRODUCER_ID);
    expect(result).toHaveProperty('error');
  });

  it('flips approved flag and returns success', async () => {
    const db = makeDb();
    const svc = makeService(db);
    const result = await svc.approveIntroduction(OPP_ID, INTRODUCER_ID);
    expect(db.updateOpportunityActorApproval).toHaveBeenCalledWith(OPP_ID, INTRODUCER_ID, true);
    expect(result).toEqual({ success: true });
  });

  it('returns error when DB approval update fails', async () => {
    const db = makeDb({
      updateOpportunityActorApproval: mock(async () => false),
    });
    const svc = makeService(db);
    const result = await svc.approveIntroduction(OPP_ID, INTRODUCER_ID);
    expect(result).toHaveProperty('error');
    expect(result.status).toBe(500);
  });

  it('returns error when status transition fails', async () => {
    const db = makeDb();
    const svc = makeService(db);
    svc.updateOpportunityStatus = mock(async () => ({ error: 'DB error', status: 500 }));
    const result = await svc.approveIntroduction(OPP_ID, INTRODUCER_ID);
    expect(result).toHaveProperty('error');
    expect(result.status).toBe(500);
  });
});
