import { api, json, options } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { listPayments } from "@/lib/adminPayments";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  await requireAdmin(req, "payments");
  const page = Math.max(1, Math.trunc(Number(new URL(req.url).searchParams.get("page")) || 1));
  return json(await listPayments(page));
});
