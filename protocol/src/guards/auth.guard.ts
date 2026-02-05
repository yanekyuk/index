
import { privyClient } from '../lib/privy';
import db from '../lib/drizzle/drizzle';
import { users } from '../schemas/database.schema';
import { eq } from 'drizzle-orm';

export interface AuthenticatedUser {
  id: string;
  privyId: string;
  email: string | null;
  name: string;
}

/**
 * AuthGuard: Validates the Request Authorization header against Privy.
 * Throws an error if validation fails.
 * Returns the authenticated user object.
 */
export const AuthGuard = async (req: Request): Promise<AuthenticatedUser> => {
  const authHeader = req.headers.get('Authorization');
  const accessToken = authHeader && authHeader.split(' ')[1];

  if (!accessToken) {
    throw new Error('Access token required');
  }

  let claims;
  try {
    claims = await privyClient.verifyAuthToken(accessToken);
  } catch (error) {
    throw new Error('Invalid or expired access token');
  }

  if (!claims || !claims.userId) {
    throw new Error('Invalid access token claims');
  }

  const user = await db.select({
    id: users.id,
    privyId: users.privyId,
    email: users.email,
    name: users.name,
    deletedAt: users.deletedAt
  }).from(users).where(eq(users.privyId, claims.userId)).limit(1);

  if (user.length === 0) {
    throw new Error('User not found');
  }

  const userData = user[0];
  if (userData.deletedAt) {
    throw new Error('Account deactivated');
  }

  return {
    id: userData.id,
    privyId: userData.privyId,
    email: userData.email,
    name: userData.name
  };
};
