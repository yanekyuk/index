import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, bearer, jwt } from "better-auth/plugins";

import db from "./drizzle/drizzle";
import * as schema from "../schemas/database.schema";
import { getTrustedOrigins } from "./cors";
import { sendMagicLinkEmail } from "./email/magic-link.handler";

let _ensureWallet: ((userId: string) => Promise<void>) | null = null;

/** Register the wallet-creation hook (called from main.ts after messaging store is ready). */
export function setWalletHook(fn: (userId: string) => Promise<void>) {
  _ensureWallet = fn;
}

export const PROTOCOL_URL =
  process.env.PROTOCOL_URL || `http://localhost:${process.env.PORT || 3001}`;

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
        after: async (user) => {
          try {
            if (_ensureWallet) await _ensureWallet(user.id);
          } catch (_) { /* wallet generation failure shouldn't block registration */ }
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
