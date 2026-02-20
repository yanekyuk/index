const PROTOCOL_API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

interface SignUpResult {
  userId: string;
}

interface SignInResult {
  cookie: string;
  userId: string;
}

/**
 * Sign up a new user via Better Auth email/password.
 * Returns the created userId.
 */
export async function signUp(
  apiUrl: string | undefined,
  email: string,
  password: string,
  name: string
): Promise<SignUpResult> {
  const base = (apiUrl || PROTOCOL_API_URL).replace(/\/api\/?$/, "");
  const url = `${base}/api/auth/sign-up/email`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sign-up failed for ${email}: ${res.status} ${text}`);
  }

  const data = await res.json();
  const userId = data?.user?.id ?? data?.id;
  if (!userId) {
    throw new Error(`Sign-up response missing userId for ${email}`);
  }

  return { userId };
}

/**
 * Sign in via Better Auth email/password.
 * Returns the session cookie string for use in subsequent API calls.
 */
export async function signIn(
  apiUrl: string | undefined,
  email: string,
  password: string
): Promise<SignInResult> {
  const base = (apiUrl || PROTOCOL_API_URL).replace(/\/api\/?$/, "");
  const url = `${base}/api/auth/sign-in/email`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    redirect: "manual",
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok && res.status !== 302) {
    const text = await res.text();
    throw new Error(`Sign-in failed for ${email}: ${res.status} ${text}`);
  }

  const setCookieHeaders = res.headers.getSetCookie?.() ?? [];
  const cookieParts: string[] = [];
  for (const header of setCookieHeaders) {
    const part = header.split(";")[0];
    if (part) cookieParts.push(part);
  }

  if (cookieParts.length === 0) {
    const single = res.headers.get("set-cookie");
    if (single) {
      cookieParts.push(single.split(";")[0]);
    }
  }

  const cookie = cookieParts.join("; ");

  const data = await res.json().catch(() => null);
  const userId =
    data?.user?.id ?? data?.session?.userId ?? data?.id ?? "";

  return { cookie, userId };
}

/**
 * Sign up then sign in — returns a session cookie ready for chat API calls.
 */
export async function createAuthSession(
  apiUrl: string | undefined,
  email: string,
  password: string,
  name: string
): Promise<SignInResult> {
  await signUp(apiUrl, email, password, name);
  return signIn(apiUrl, email, password);
}
