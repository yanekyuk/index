import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, bearer, jwt } from "better-auth/plugins";

import db from "../drizzle/drizzle";
import * as schema from "../../schemas/database.schema";
import { getTrustedOrigins } from "../cors";
import { sendMagicLinkEmail } from "../email/magic-link.handler";
import { ChatDatabaseAdapter } from "../../adapters/database.adapter";
import { log } from "../log";

const logger = log.server.from("betterauth");

let _ensureWallet: ((userId: string) => Promise<void>) | null = null;

/** Register the wallet-creation hook (called from main.ts after messaging store is ready). */
export function setWalletHook(fn: (userId: string) => Promise<void>) {
  _ensureWallet = fn;
}

export const PROTOCOL_URL =
  process.env.PROTOCOL_URL || `http://localhost:${process.env.PORT || 3001}`;

const chatDb = new ChatDatabaseAdapter();

/**
 * Tracks ghost IDs that were freed in `create.before` so `create.after` can claim them.
 * Keyed by the new real user's ID to avoid races between concurrent signups.
 */
const pendingGhostClaims = new Map<string, string>();

export const auth = betterAuth({
  baseURL: PROTOCOL_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      ...schema,
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      jwks: schema.jwks,
    },
  }),
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Free the ghost's email before Better Auth inserts the real user,
          // otherwise the unique constraint on users.email blocks signup.
          try {
            const ghostId = await chatDb.prepareGhostClaim(user.email);
            if (ghostId) {
              pendingGhostClaims.set(user.id, ghostId);
            }
          } catch (err) {
            logger.error('Failed to prepare ghost claim', { email: user.email.replace(/(.{2}).+(@.+)/, '$1***$2'), error: err });
          }
          return { data: user };
        },
        after: async (user) => {
          try {
            if (_ensureWallet) await _ensureWallet(user.id);
          } catch (_) { /* wallet generation failure shouldn't block registration */ }

          const ghostId = pendingGhostClaims.get(user.id);
          if (ghostId) {
            try {
              await chatDb.claimGhostUser(user.id, ghostId);
              pendingGhostClaims.delete(user.id);
            } catch (err) {
              // Restore ghost email so the ghost row isn't orphaned with a placeholder email
              try {
                await chatDb.restoreGhostEmail(ghostId, user.email);
              } catch (restoreErr) {
                logger.error('Failed to restore ghost email after claim failure', { ghostId, error: restoreErr });
              }
              pendingGhostClaims.delete(user.id);
              logger.error('Ghost claiming failed', { userId: user.id, ghostId, error: err });
            }
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
        issuer: PROTOCOL_URL,
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
  },
});
