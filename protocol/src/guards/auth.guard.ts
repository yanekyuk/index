import { auth } from '../lib/auth';

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  name: string;
}

/**
 * AuthGuard: Validates the request against Better Auth session.
 * session.user.id IS the domain user ID (unified table).
 */
export const AuthGuard = async (req: Request): Promise<AuthenticatedUser> => {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session || !session.user) {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Access token required');
    }
    throw new Error('Invalid or expired access token');
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
};
