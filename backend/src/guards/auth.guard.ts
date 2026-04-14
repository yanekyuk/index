import { jwtVerify, createRemoteJWKSet } from 'jose';
import { eq } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { apikeys, users } from '../schemas/database.schema';

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  name: string;
}

const JWKS = createRemoteJWKSet(
  new URL(`http://localhost:${process.env.PORT || 3001}/api/auth/jwks`)
);

/**
 * AuthGuard: Verifies JWT tokens statelessly via the local JWKS endpoint.
 * Expects `Authorization: Bearer <jwt>` header.
 */
export const AuthGuard = async (req: Request): Promise<AuthenticatedUser> => {
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : new URL(req.url, 'http://localhost').searchParams.get('token');

  if (!token) {
    throw new Error('Access token required');
  }
  try {
    const { payload } = await jwtVerify(token, JWKS);
    return {
      id: payload.id as string,
      email: (payload.email as string) ?? null,
      name: payload.name as string,
    };
  } catch {
    throw new Error('Invalid or expired access token');
  }
};

/**
 * AuthOrApiKeyGuard: Tries JWT first, falls back to API key (`x-api-key` header).
 * API key is SHA-256 hashed and looked up in the `apikeys` table, then the
 * owning user is loaded from `users` to build the same AuthenticatedUser shape.
 */
export const AuthOrApiKeyGuard = async (req: Request): Promise<AuthenticatedUser> => {
  // Try JWT first
  const authHeader = req.headers.get('Authorization');
  const url = new URL(req.url, 'http://localhost');
  const queryToken = url.searchParams.get('token');

  if (authHeader?.startsWith('Bearer ') || queryToken) {
    return AuthGuard(req);
  }

  // Fall back to API key
  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    throw new Error('Access token or API key required');
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
  const hashed = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const [row] = await db
    .select({
      referenceId: apikeys.referenceId,
      userId: apikeys.userId,
      enabled: apikeys.enabled,
      expiresAt: apikeys.expiresAt,
    })
    .from(apikeys)
    .where(eq(apikeys.key, hashed))
    .limit(1);

  if (!row || !row.enabled) {
    throw new Error('Invalid API key');
  }
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    throw new Error('Invalid API key');
  }

  const userId = row.referenceId ?? row.userId;
  if (!userId) {
    throw new Error('Invalid API key');
  }

  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new Error('Invalid API key');
  }

  return {
    id: user.id,
    email: user.email ?? null,
    name: user.name,
  };
};
