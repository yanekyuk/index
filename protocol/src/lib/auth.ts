import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";

import db from "./drizzle/drizzle";
import * as schema from "../schemas/database.schema";
import { getTrustedOrigins } from "./cors";
import { sendMagicLinkEmail } from "./email/magic-link.handler";

// Use BETTER_AUTH_URL only when it's not localhost; otherwise infer from request.
// Fixes prod when env was copied from dev (localhost) - request host will be correct.
const authBaseUrl =
  process.env.PROTOCOL_URL?.includes("localhost")
    ? undefined
    : process.env.PROTOCOL_URL;

export const auth = betterAuth({
  baseURL: authBaseUrl,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      ...schema,
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
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
  ],
  advanced: {
    trustedProxyHeaders: true,
    defaultCookieAttributes: {
      sameSite: "lax",
    },
  },
});
