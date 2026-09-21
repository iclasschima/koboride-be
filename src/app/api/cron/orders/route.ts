import { api, json, options, AppError } from "@/lib/errors";
import { config } from "@/lib/config";
import { runOrderMaintenance } from "@/lib/dispatch";
import { autoConfirmStaleDeliveries } from "@/lib/orders";

export const OPTIONS = () => options();

function assertCron(req: Request) {
  const secret = config.cronSecret.trim();
  if (!secret) {
    throw new AppError("Cron is not configured", "CRON_NOT_CONFIGURED", 503);
  }
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : (req.headers.get("x-cron-secret") ?? "").trim();
  if (token !== secret) {
    throw new AppError("Unauthorized", "UNAUTHORIZED", 401);
  }
}

/** Scheduled-order activation + stale-search auto-cancel. Call every minute. */
export const POST = api(async (req) => {
  assertCron(req);
  await autoConfirmStaleDeliveries();
  const result = await runOrderMaintenance();
  return json({ ok: true, ...result });
});

export const GET = api(async (req) => {
  assertCron(req);
  await autoConfirmStaleDeliveries();
  const result = await runOrderMaintenance();
  return json({ ok: true, ...result });
});
