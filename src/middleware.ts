import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const extra = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra.includes(origin)) return origin;
  try {
    const { hostname } = new URL(origin);
    if (hostname === "localhost" || hostname === "127.0.0.1") return origin;
  } catch {
    return null;
  }
  return null;
}

function withCors(headers: Headers, origin: string | null) {
  const allow = allowedOrigin(origin);
  if (allow) {
    headers.set("Access-Control-Allow-Origin", allow);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400");
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    const headers = new Headers();
    withCors(headers, origin);
    return new NextResponse(null, { status: 204, headers });
  }

  const res = NextResponse.next();
  withCors(res.headers, origin);
  return res;
}

export const config = {
  matcher: "/api/:path*",
};
