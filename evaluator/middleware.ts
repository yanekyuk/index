import { NextRequest, NextResponse } from "next/server";

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get("origin");
  const allowOrigin = origin ?? "*";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (origin) {
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

export function middleware(req: NextRequest) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }

  const res = NextResponse.next();
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value);
  }
  return res;
}

export const config = {
  matcher: "/api/:path*",
};
