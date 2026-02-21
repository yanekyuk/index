"use client";

import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

const PROTOCOL_URL = process.env.NEXT_PUBLIC_PROTOCOL_URL || "http://localhost:3001";

export const authClient = createAuthClient({
  baseURL: PROTOCOL_URL,
  plugins: [magicLinkClient()],
  fetchOptions: {
    auth: {
      type: "Bearer",
      token: () => {
        if (typeof window === "undefined") return "";
        return localStorage.getItem("bearer_token") || "";
      },
    },
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get("set-auth-token");
      if (token && typeof window !== "undefined") {
        localStorage.setItem("bearer_token", token);
      }
    },
  },
});

export function signOut() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("bearer_token");
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("bearer_token");
}

export function AuthProviderWrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
