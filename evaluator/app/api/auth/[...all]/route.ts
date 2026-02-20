import { NextRequest } from "next/server";

const PROTOCOL_API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";
const PROTOCOL_BASE = PROTOCOL_API_URL.replace(/\/api\/?$/, "");

/** Proxies auth to protocol so cookies get set on evaluator domain (fixes 401 on /api/eval/*) */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ all: string[] }> }
) {
  return proxy(req, context);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ all: string[] }> }
) {
  return proxy(req, context);
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ all: string[] }> }
) {
  return proxy(req, context);
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ all: string[] }> }
) {
  return proxy(req, context);
}

async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ all: string[] }> }
) {
  try {
    const { all } = await params;
    const segments = all === undefined ? [] : Array.isArray(all) ? all : [all];
    const path = segments.length ? segments.join("/") : "";
    const target = `${PROTOCOL_BASE}/api/auth${path ? `/${path}` : ""}`;
    const url = new URL(req.url);
    const query = url.search ? url.search : "";

    const headers = new Headers(req.headers);
    headers.delete("host");

    const hasBody = req.method !== "GET";
    const res = await fetch(`${target}${query}`, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      ...(hasBody && { duplex: "half" as const }),
    });

    const newHeaders = new Headers(res.headers);
    const cookies =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : [];
    newHeaders.delete("set-cookie");
    for (const raw of cookies) {
      const withoutDomain = raw.replace(/;\s*Domain=[^;]+/gi, "");
      newHeaders.append("set-cookie", withoutDomain);
    }

    return new Response(res.body, {
      status: res.status,
      headers: newHeaders,
    });
  } catch (err) {
    console.error("Auth proxy error:", err);
    return Response.json(
      {
        error: "Auth proxy failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
