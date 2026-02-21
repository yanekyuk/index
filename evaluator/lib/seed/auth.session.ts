import https from "node:https";
import http from "node:http";

const PROTOCOL_API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

/** Origin for server-side auth fetch (Better Auth requires it; evaluator runs on 3002 locally) */
const EVALUATOR_ORIGIN =
  process.env.EVALUATOR_ORIGIN || "http://localhost:3002";

interface SignUpResult {
  userId: string;
}

interface SignInResult {
  cookie: string;
  userId: string;
}

/** Node fetch strips Origin (forbidden header). Use http(s).request so Origin is sent. */
async function authFetch(
  urlStr: string,
  method: string,
  body: string
): Promise<{ status: number; body: string; headers: Record<string, string | string[]> }> {
  const u = new URL(urlStr);
  const isHttps = u.protocol === "https:";
  const bodyBuf = Buffer.from(body, "utf8");
  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request(
      urlStr,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": bodyBuf.length,
          Origin: EVALUATOR_ORIGIN,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const headers: Record<string, string | string[]> = {};
          for (const [k, v] of Object.entries(res.headers))
            if (v !== undefined) headers[k.toLowerCase()] = v;
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers,
          });
        });
      }
    );
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
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

  const { status, body } = await authFetch(
    url,
    "POST",
    JSON.stringify({ email, password, name })
  );

  if (status < 200 || status >= 300) {
    throw new Error(`Sign-up failed for ${email}: ${status} ${body}`);
  }

  const data = JSON.parse(body);
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

  const { status, body, headers } = await authFetch(
    url,
    "POST",
    JSON.stringify({ email, password })
  );

  if (status !== 302 && (status < 200 || status >= 300)) {
    throw new Error(`Sign-in failed for ${email}: ${status} ${body}`);
  }

  const setCookieRaw = headers["set-cookie"];
  const cookieParts: string[] = Array.isArray(setCookieRaw)
    ? setCookieRaw.map((h) => h.split(";")[0]).filter(Boolean)
    : setCookieRaw
      ? [setCookieRaw.split(";")[0]]
      : [];
  const cookie = cookieParts.join("; ");

  let data: Record<string, unknown> | null = null;
  if (body) {
    try {
      data = JSON.parse(body);
    } catch {
      /* redirect may return non-JSON */
    }
  }
  const d = data as { user?: { id?: string }; session?: { userId?: string }; id?: string } | null;
  const userId = d?.user?.id ?? d?.session?.userId ?? d?.id ?? "";

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
