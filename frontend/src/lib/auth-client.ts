import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
const serverBase = apiUrl.startsWith('/') ? '' : (apiUrl.replace(/\/api\/?$/, '') || 'http://localhost:3001');

export const authClient = createAuthClient({
  baseURL: serverBase,
  basePath: "/api/auth",
  plugins: [magicLinkClient()],
});
