import { createAuthClient } from "better-auth/react";

const serverBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/?$/, '') || "http://localhost:3001";

export const authClient = createAuthClient({
  baseURL: serverBase,
  basePath: "/api/auth",
});
