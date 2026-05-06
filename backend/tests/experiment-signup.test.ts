import '../src/startup.env';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';

import db from '../src/lib/drizzle/drizzle';
import { agents, apikeys, networkMembers, networks, personalNetworks, users } from '../src/schemas/database.schema';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

// ─────────────────────────────────────────────────────────────────────────────
// State shared across tests
// ─────────────────────────────────────────────────────────────────────────────

let authJwt = '';
let testOwnerId = '';
let testNetworkId = '';
let masterKey = '';
let signedUpEmail = '';
let signedUpUserId = '';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function api(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const { method = 'GET', body, headers = {} } = opts;
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authJwt ? { Authorization: `Bearer ${authJwt}` } : {}),
      ...headers,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return fetch(`${BASE_URL}${path}`, init);
}

/** Sign up a fresh test owner and return a JWT for API auth. */
async function createTestSession(): Promise<{ jwt: string; userId: string }> {
  const email = `test-owner-${randomUUID()}@example.com`;
  const password = `Test${randomUUID().replace(/-/g, '')}!`;

  const signupRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    body: JSON.stringify({ email, password, name: 'Test Owner' }),
  });

  if (!signupRes.ok) {
    const text = await signupRes.text();
    throw new Error(`Failed to sign up test user: ${signupRes.status} ${text}`);
  }

  const data = await signupRes.json() as { user?: { id: string } };
  const userId = data?.user?.id ?? '';

  // Extract session cookie
  const setCookies = signupRes.headers.getSetCookie();
  const cookie = setCookies.map((c) => c.split(';')[0].trim()).join('; ');

  // Exchange session cookie for JWT
  const tokenRes = await fetch(`${BASE_URL}/api/auth/token`, {
    headers: { Cookie: cookie, Origin: BASE_URL },
  });
  if (!tokenRes.ok) {
    throw new Error(`Failed to get JWT: ${tokenRes.status}`);
  }
  const tokenData = await tokenRes.json() as { token: string };

  return { jwt: tokenData.token, userId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup / Teardown
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Verify the dev server is reachable; skip suite gracefully if not
  try {
    await fetch(`${BASE_URL}/api/networks`, { signal: AbortSignal.timeout(3000) });
  } catch (err) {
    console.warn(`[experiment-signup] Dev server not reachable at ${BASE_URL} — skipping suite.`);
    return;
  }

  const session = await createTestSession();
  authJwt = session.jwt;
  testOwnerId = session.userId;

  signedUpEmail = `signup-${randomUUID()}@example.com`;
}, 30_000);

async function cleanupUser(userId: string) {
  await db.delete(apikeys).where(eq(apikeys.userId, userId));
  await db.delete(agents).where(eq(agents.ownerId, userId));
  await db.delete(networkMembers).where(eq(networkMembers.userId, userId));
  const pn = await db
    .select({ networkId: personalNetworks.networkId })
    .from(personalNetworks)
    .where(eq(personalNetworks.userId, userId));
  await db.delete(personalNetworks).where(eq(personalNetworks.userId, userId));
  for (const p of pn) {
    await db.delete(networks).where(eq(networks.id, p.networkId));
  }
  await db.delete(users).where(eq(users.id, userId));
}

afterAll(async () => {
  try {
    if (testNetworkId) {
      const experimentUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.experimentNetworkId, testNetworkId));

      for (const u of experimentUsers) {
        await cleanupUser(u.id);
      }

      await db.delete(networkMembers).where(eq(networkMembers.networkId, testNetworkId));
      await db.delete(networks).where(eq(networks.id, testNetworkId));
    }

    if (testOwnerId) {
      await cleanupUser(testOwnerId);
    }
  } catch (err) {
    console.warn('[experiment-signup] Cleanup error (non-fatal):', err);
  }
}, 30_000);

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('Experiment network headless signup', () => {
  // ── 1. Create experiment network ────────────────────────────────────────────

  it('creates an experiment network and returns masterKey', async () => {
    if (!authJwt) return;

    const res = await api('/api/networks', {
      method: 'POST',
      body: {
        title: `Test Experiment ${randomUUID().slice(0, 8)}`,
        isExperiment: true,
      },
    });

    expect(res.status).toBe(201);

    const data = await res.json() as { network: { id: string }; masterKey: string };
    expect(data).toHaveProperty('network');
    expect(data).toHaveProperty('masterKey');
    expect(typeof data.masterKey).toBe('string');
    expect(data.masterKey.length).toBe(64);
    expect(typeof data.network.id).toBe('string');

    // Store for subsequent tests
    testNetworkId = data.network.id;
    masterKey = data.masterKey;
  });

  // ── 2. Signup rejects without x-api-key ─────────────────────────────────────

  it('rejects signup without x-api-key header (401)', async () => {
    if (!testNetworkId) return;

    const res = await fetch(`${BASE_URL}/api/networks/${testNetworkId}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: signedUpEmail }),
    });

    expect(res.status).toBe(401);
  });

  // ── 3. Signup rejects wrong master key ──────────────────────────────────────

  it('rejects signup with wrong master key (403)', async () => {
    if (!testNetworkId) return;

    const res = await fetch(`${BASE_URL}/api/networks/${testNetworkId}/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'wrong-key-that-is-definitely-not-correct-xxxxxxxxxxxxxx',
      },
      body: JSON.stringify({ email: signedUpEmail }),
    });

    expect(res.status).toBe(403);
  });

  // ── 4. Signup rejects non-experiment (nonexistent) network ──────────────────

  it('rejects signup for a non-experiment / nonexistent network (403)', async () => {
    const fakeNetworkId = randomUUID();
    const res = await fetch(`${BASE_URL}/api/networks/${fakeNetworkId}/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': masterKey || 'some-key',
      },
      body: JSON.stringify({ email: signedUpEmail }),
    });

    expect(res.status).toBe(403);
  });

  // ── 5. Signup creates new user (201) ─────────────────────────────────────────

  it('creates a new experiment user and returns 201 with user and apiKey', async () => {
    if (!testNetworkId || !masterKey) return;

    const res = await fetch(`${BASE_URL}/api/networks/${testNetworkId}/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': masterKey,
      },
      body: JSON.stringify({ email: signedUpEmail }),
    });

    expect(res.status).toBe(201);

    const data = await res.json() as { user: { id: string; email: string }; apiKey: string; agentId: string; connectCommand: string };
    expect(data).toHaveProperty('user');
    expect(data).toHaveProperty('apiKey');
    expect(data.user.email).toBe(signedUpEmail);
    expect(typeof data.user.id).toBe('string');
    expect(typeof data.apiKey).toBe('string');
    expect(data.apiKey.length).toBeGreaterThan(0);
    expect(typeof data.agentId).toBe('string');
    expect(data.agentId.length).toBeGreaterThan(0);
    expect(data.connectCommand).toContain('openclaw index connect --api-key');

    signedUpUserId = data.user.id;
  }, 15_000);

  // ── 6. Signup returns existing user with new key (200) ──────────────────────

  it('returns 200 with same user.id but a new apiKey for repeated signup', async () => {
    if (!testNetworkId || !masterKey || !signedUpUserId) return;

    const res = await fetch(`${BASE_URL}/api/networks/${testNetworkId}/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': masterKey,
      },
      body: JSON.stringify({ email: signedUpEmail }),
    });

    expect(res.status).toBe(200);

    const data = await res.json() as { user: { id: string; email: string }; apiKey: string };
    expect(data.user.id).toBe(signedUpUserId);
    // A fresh API key is issued each time
    expect(typeof data.apiKey).toBe('string');
    expect(data.apiKey.length).toBeGreaterThan(0);
  }, 15_000);

  // ── 7. Signup rejects invalid email ─────────────────────────────────────────

  it('rejects signup with invalid email format (400)', async () => {
    if (!testNetworkId || !masterKey) return;

    const res = await fetch(`${BASE_URL}/api/networks/${testNetworkId}/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': masterKey,
      },
      body: JSON.stringify({ email: 'not-an-email' }),
    });

    expect(res.status).toBe(400);
  });

  // ── 8. Experiment user isolated from normal auth flow ───────────────────────

  it('experiment user does not appear in the regular users scope (experimentNetworkId IS NULL)', async () => {
    if (!signedUpUserId) return;

    const normalUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(
        eq(users.id, signedUpUserId),
        isNull(users.experimentNetworkId),
      ));

    // The experiment user should NOT appear in a query filtered to non-experiment users
    expect(normalUsers).toHaveLength(0);
  });

  // ── 9. Immutability: cannot set isExperiment=false via PATCH ────────────────

  it('rejects PATCH /api/networks/:id with isExperiment in the body (400)', async () => {
    if (!testNetworkId || !authJwt) return;

    const res = await api(`/api/networks/${testNetworkId}/permissions`, {
      method: 'PATCH',
      body: { isExperiment: false },
    });

    expect(res.status).toBe(400);

    const data = await res.json() as { error?: string };
    expect(data.error).toContain('Cannot modify experiment settings after creation');
  });
}, { timeout: 30_000 });
