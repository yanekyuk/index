const PROTOCOL_URL = process.env.NEXT_PUBLIC_PROTOCOL_URL || "http://localhost:3001";

export async function getUserIdFromRequest(req: Request): Promise<string | null> {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;

    const res = await fetch(`${PROTOCOL_URL}/api/auth/get-session`, {
      headers: { authorization: authHeader },
    });
    if (!res.ok) return null;

    const data = await res.json();
    return data?.session?.userId ?? null;
  } catch {
    return null;
  }
}
