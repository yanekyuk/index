
import { privyClient } from '../lib/privy';
import db from '../lib/drizzle/drizzle';
import { users, userNotificationSettings } from '../schemas/database.schema';
import { eq } from 'drizzle-orm';

export interface AuthenticatedUser {
  id: string;
  privyId: string;
  email: string | null;
  name: string;
}

/**
 * AuthGuard: Validates the Request Authorization header against Privy.
 * Auto-creates user on first login.
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

  const existing = await db.select({
    id: users.id,
    privyId: users.privyId,
    email: users.email,
    name: users.name,
    deletedAt: users.deletedAt
  }).from(users).where(eq(users.privyId, claims.userId)).limit(1);

  let userData = existing[0];

  if (!userData) {
    // First login — fetch identity from Privy and create user
    const privyUser = await privyClient.getUserById(claims.userId);
    const email = privyUser?.email?.address ?? null;
    const name = email?.split('@')[0] ?? 'User';

    const [created] = await db.insert(users)
      .values({ privyId: claims.userId, email, name })
      .returning({ id: users.id, privyId: users.privyId, email: users.email, name: users.name, deletedAt: users.deletedAt });

    if (!created) {
      throw new Error('Failed to create user');
    }

    // Set up default notification preferences
    await db.insert(userNotificationSettings)
      .values({ userId: created.id, preferences: { connectionUpdates: true, weeklyNewsletter: true } })
      .onConflictDoNothing();

    userData = created;
  }

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
