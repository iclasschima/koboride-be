import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { requireSuperAdmin } from "@/lib/adminAuth";
import { parseBody } from "@/lib/validate";
import { businessMetrics } from "@/lib/metrics";

export const OPTIONS = () => options();

const PERIODS_SHOWN = 12;

export const GET = api(async (req) => {
  await requireSuperAdmin(req);
  const { period } = parseBody(
    z.object({ period: z.enum(["week", "month"]).default("week") }),
    { period: new URL(req.url).searchParams.get("period") || undefined },
  );
  return json(await businessMetrics(period, PERIODS_SHOWN));
});
