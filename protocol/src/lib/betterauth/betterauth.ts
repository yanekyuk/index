import { betterAuth } from "better-auth";
import { magicLink, bearer, jwt } from "better-auth/plugins";

import { log } from "../log";

const logger = log.server.from("betterauth");

export const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

/** Contract for the auth database adapter injected into createAuth. */
export interface AuthDbContract {
  /** Returns a configured adapter object for Better Auth's `database` option. */
  createDrizzleAdapter(): unknown;
  ensurePersonalIndex(userId: string): Promise<string>;
}

/**
 * Dependencies injected into the Better Auth factory.
 * Keeps this lib module free of direct adapter/infrastructure imports.
 */
export interface AuthDeps {
  authDb: AuthDbContract;
  getTrustedOrigins: (req?: Request) => Promise<string[]> | string[];
  sendMagicLinkEmail: (email: string, url: string) => Promise<void>;
}

/**
 * Creates a configured Better Auth instance.
 * All infrastructure access is provided through `deps` so this module
 * follows the project layering rules (lib receives adapters via injection).
 *
 * @remarks Ghost user claiming is handled at the adapter level via ON CONFLICT
 * in the Drizzle adapter's create method — no hooks needed.
 */
export function createAuth(deps: AuthDeps) {
  const { authDb, getTrustedOrigins, sendMagicLinkEmail } = deps;

  return betterAuth({
    baseURL: BASE_URL,
    database: authDb.createDrizzleAdapter(),
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            try {
              await authDb.ensurePersonalIndex(session.userId);
            } catch (err) {
              logger.error('Failed to ensure personal index on sign-in', { userId: session.userId, error: err });
            }
          },
        },
      },
      user: {
        create: {
          after: async (user) => {
            try {
              await authDb.ensurePersonalIndex(user.id);
            } catch (err) {
              logger.error('Failed to create personal index on registration', { userId: user.id, error: err });
            }
          },
        },
      },
    },
    basePath: "/api/auth",
    emailAndPassword: { enabled: true },
    user: {
      fields: {
        image: "avatar",
      },
    },
    socialProviders: {
      ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },
    trustedOrigins: getTrustedOrigins,
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendMagicLinkEmail(email, url);
        },
        expiresIn: 600,
      }),
      bearer(),
      jwt({
        jwt: {
          issuer: BASE_URL,
          expirationTime: "1h",
          definePayload: ({ user }) => ({
            id: user.id,
            email: user.email,
            name: user.name,
          }),
        },
      }),
    ],
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
      },
      database: {
        generateId: () => crypto.randomUUID(),
      },
    },
  });
}
