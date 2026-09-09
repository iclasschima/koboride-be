import { NextResponse } from "next/server";

export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(error: string, code: string, status = 400): NextResponse {
  return NextResponse.json({ error, code }, { status });
}

export function options(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) return fail(err.message, err.code, err.status);
  console.error("[unhandled]", err);
  return fail("Internal server error", "INTERNAL", 500);
}

type Ctx = { params?: Record<string, string> };

export function api(handler: (req: Request, ctx: Ctx) => Promise<NextResponse>) {
  return async (req: Request, ctx: Ctx = {}) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}
