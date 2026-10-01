import { api, json, options } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { cachedBanks } from "@/lib/bankVerify";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  await requireAdmin(req);
  const banks = await cachedBanks();
  return json({ banks });
});
