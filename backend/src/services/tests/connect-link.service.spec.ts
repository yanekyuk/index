/** Config */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import { connectLinks, opportunities, users } from '../../schemas/database.schema';
import { mintConnectLink, resolveConnectLink } from '../connect-link.service';

const USER_ID = `cl-svc-user-${Date.now()}`;
const OPP_ID = `cl-svc-opp-${Date.now()}`;

describe('connect-link service', () => {
  beforeAll(async () => {
    await db.insert(users).values({
      id: USER_ID,
      email: `${USER_ID}@test`,
      name: 'CL Test User',
    });
    await db.insert(opportunities).values({
      id: OPP_ID,
      actors: [{ userId: USER_ID, networkId: 'n/a', role: 'seeker' }],
      detection: { source: 'test', timestamp: new Date().toISOString(), createdBy: USER_ID },
      interpretation: { category: 'test', reasoning: 'test', confidence: 0.9 },
      context: { networkId: 'n/a' },
      confidence: '0.9',
      status: 'pending',
    });
  });

  afterAll(async () => {
    await db.delete(connectLinks).where(eq(connectLinks.userId, USER_ID));
    await db.delete(opportunities).where(eq(opportunities.id, OPP_ID));
    await db.delete(users).where(eq(users.id, USER_ID));
  });

  test('mint produces a 10-char base62 code and persists greeting', async () => {
    const r = await mintConnectLink({
      userId: USER_ID,
      opportunityId: OPP_ID,
      kind: 'connect',
      greeting: 'Hi there.',
    });
    expect(r.code).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(r.greeting).toBe('Hi there.');
  });

  test('mint is idempotent per (opp, user, kind)', async () => {
    const a = await mintConnectLink({ userId: USER_ID, opportunityId: OPP_ID, kind: 'connect' });
    const b = await mintConnectLink({ userId: USER_ID, opportunityId: OPP_ID, kind: 'connect' });
    expect(a.code).toBe(b.code);
  });

  test('different kinds produce different codes for same recipient', async () => {
    const c1 = await mintConnectLink({ userId: USER_ID, opportunityId: OPP_ID, kind: 'connect' });
    const c2 = await mintConnectLink({ userId: USER_ID, opportunityId: OPP_ID, kind: 'outreach' });
    expect(c1.code).not.toBe(c2.code);
  });

  test('resolve returns the row for a valid code', async () => {
    const r = await mintConnectLink({ userId: USER_ID, opportunityId: OPP_ID, kind: 'connect' });
    const resolved = await resolveConnectLink(r.code);
    expect(resolved?.userId).toBe(USER_ID);
    expect(resolved?.kind).toBe('connect');
  });

  test('resolve returns null for unknown code', async () => {
    expect(await resolveConnectLink('NOPE000000')).toBeNull();
  });
});
