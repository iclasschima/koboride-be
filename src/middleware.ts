import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  // Local dev allows every origin. Production uses CORS_ORIGIN from the environment.
  if (process.env.NODE_ENV !== "production") return origin;
  const extra = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra.includes("*") || extra.includes(origin)) return origin;
  return null;
}

function withCors(headers: Headers, origin: string | null) {
  const allow = allowedOrigin(origin);
  if (allow) {
    headers.set("Access-Control-Allow-Origin", allow);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Expose-Headers", "X-Kobo-Refresh");
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
