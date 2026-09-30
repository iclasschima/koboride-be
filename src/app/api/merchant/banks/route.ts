import { api, json, options } from "@/lib/errors";
import { requireMerchant } from "@/lib/auth";
import { cachedBanks } from "@/lib/bankVerify";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  await requireMerchant(req);
  return json({ banks: await cachedBanks() });
});
