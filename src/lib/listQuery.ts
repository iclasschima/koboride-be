import { z } from "zod";
import { parseBody } from "@/lib/validate";

/** West Africa Time, no daylight saving. Day filters follow the Lagos calendar. */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date").optional();

export type ListQuery = { page: number; pageSize: number; from?: string; to?: string; q?: string };

/** Reads `page`, `pageSize`, `from`, `to` (Lagos days, both included) and `q` from the URL. */
export function readListQuery(req: Request, defaultPageSize: number, maxPageSize = 500): ListQuery {
  const params = new URL(req.url).searchParams;
  return parseBody(
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(maxPageSize).default(defaultPageSize),
      from: day,
      to: day,
      q: z.string().trim().max(100).optional(),
    }),
    {
      page: params.get("page") || undefined,
      pageSize: params.get("pageSize") || undefined,
      from: params.get("from") || undefined,
      to: params.get("to") || undefined,
      q: params.get("q")?.trim() || undefined,
    },
  );
}

/** Start of a Lagos calendar day (YYYY-MM-DD) as a UTC instant. */
function lagosDayStart(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date) - LAGOS_OFFSET_MS);
}

/** A date filter for `from`..`to` (both Lagos days, both included), or undefined when neither is set. */
export function betweenDays(range: { from?: string; to?: string }): { gte?: Date; lt?: Date } | undefined {
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: lagosDayStart(range.from) } : {}),
    ...(range.to ? { lt: new Date(lagosDayStart(range.to).getTime() + DAY_MS) } : {}),
  };
}

/** Phone search terms: what was typed, plus the digits without a leading 0 so "0803…" finds "+234803…". */
export function phoneTerms(q: string): string[] {
  const digits = q.replace(/\D/g, "").replace(/^0/, "");
  return digits.length >= 3 && digits !== q ? [q, digits] : [q];
}

export function pageInfo(total: number, query: ListQuery) {
  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}
