import { createAuthClient } from "better-auth/react";
import { magicLinkClient, jwtClient } from "better-auth/client/plugins";

// Same origin - auth routes proxied via Next.js to /api/auth/*
export const authClient = createAuthClient({
  baseURL: '',
  basePath: "/api/auth",
  plugins: [magicLinkClient(), jwtClient()],
});

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/** Returns a cached JWT, refreshing if within 60s of expiry. */
export async function getJwtToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }
  const { data, error } = await authClient.token();
  if (error || !data?.token) throw new Error('Failed to obtain JWT');
  cachedToken = data.token;
  const payload = JSON.parse(atob(data.token.split('.')[1]));
  tokenExpiresAt = payload.exp * 1000;
  return cachedToken;
}

export function clearJwtToken() {
  cachedToken = null;
  tokenExpiresAt = 0;
}
