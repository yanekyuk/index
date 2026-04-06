import { jwtVerify, createRemoteJWKSet } from 'jose';

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
  let token: string | null = null;

  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    const url = new URL(req.url, 'http://localhost');
    token = url.searchParams.get('token');
  }

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
