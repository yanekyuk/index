import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

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
    // So magic-link verify URL in email points to evaluator; cookie then set on evaluator domain
    const fwdHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const fwdProto = req.headers.get("x-forwarded-proto") ?? (req.url.startsWith("https") ? "https" : "http");
    if (fwdHost) {
      headers.set("x-forwarded-host", fwdHost);
      headers.set("x-forwarded-proto", fwdProto);
    }

    const hasBody = req.method !== "GET";
    const res = await fetch(`${target}${query}`, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      cache: "no-store",
      ...(hasBody && { duplex: "half" as const }),
    });

    const newHeaders = new Headers(res.headers);
    newHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
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
    console.error("Auth proxy error:", { target: PROTOCOL_BASE, err });
    return Response.json(
      {
        error: "Auth proxy failed",
        detail: err instanceof Error ? err.message : String(err),
        hint:
          !process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_URL.includes("localhost")
            ? "Set NEXT_PUBLIC_API_URL to protocol's public URL (e.g. https://protocol-dev.up.railway.app/api)"
            : undefined,
      },
      { status: 500 }
    );
  }
}
