"use client";

import { createAuthClient } from "better-auth/react";

const serverBase = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api").replace(/\/api\/?$/, '');

export const authClient = createAuthClient({
  baseURL: serverBase,
  basePath: "/api/auth",
});

export function AuthProviderWrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
