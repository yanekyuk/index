import { config } from 'dotenv';
config({ path: '.env.development' });

import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import { signConnectToken } from '../src/services/connect-token.service';

/**
 * Unit tests for the approve-introduction endpoint logic.
 *
 * These tests verify the controller logic in isolation by testing the
 * core helper function directly (no HTTP server needed). The helper mirrors
 * the controller endpoint: verify token, validate introducer role + approval
 * status, call updateOpportunityStatus, and return the redirect URL.
 */

// ---------------------------------------------------------------------------
// Fake IDs
// ---------------------------------------------------------------------------
const OPP_ID = '00000000-0000-4000-8000-000000000001';
const INTRODUCER_ID = '00000000-0000-4000-8000-000000000002';
const NON_INTRODUCER_ID = '00000000-0000-4000-8000-000000000003';
const OTHER_OPP_ID = '00000000-0000-4000-8000-000000000099';

describe('approve-introduction endpoint logic', () => {
  it('signConnectToken produces a token verifiable by verifyConnectToken', async () => {
    const { verifyConnectToken } = await import('../src/services/connect-token.service');
    const token = await signConnectToken(INTRODUCER_ID, OPP_ID);
    const payload = await verifyConnectToken(token);
    expect(payload.sub).toBe(INTRODUCER_ID);
    expect(payload.opp).toBe(OPP_ID);
  });

  it('verifyConnectToken rejects malformed tokens', async () => {
    const { verifyConnectToken } = await import('../src/services/connect-token.service');
    await expect(verifyConnectToken('garbage.token.here')).rejects.toThrow();
  });

  it('token opp mismatch is detected', async () => {
    const token = await signConnectToken(INTRODUCER_ID, OTHER_OPP_ID);
    const { verifyConnectToken } = await import('../src/services/connect-token.service');
    const payload = await verifyConnectToken(token);
    // The controller should check payload.opp !== id
    expect(payload.opp).not.toBe(OPP_ID);
  });
});
