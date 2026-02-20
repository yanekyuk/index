"use client";

import { createAuthClient } from "better-auth/react";

// Use relative /api/auth so sign-in cookies are set on evaluator domain (fixes 401 on /api/eval/*)
export const authClient = createAuthClient({
  basePath: "/api/auth",
});

export function AuthProviderWrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
