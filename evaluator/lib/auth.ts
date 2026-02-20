const PROTOCOL_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

export async function getUserIdFromRequest(req: Request): Promise<string | null> {
  try {
    const cookie = req.headers.get("cookie");
    if (!cookie) return null;

    const res = await fetch(`${PROTOCOL_API_URL}/auth/get-session`, {
      headers: { cookie },
    });
    if (!res.ok) return null;

    const data = await res.json();
    return data?.session?.userId ?? null;
  } catch {
    return null;
  }
}
