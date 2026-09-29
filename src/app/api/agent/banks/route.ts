import { api, json, options } from "@/lib/errors";
import { requireAgent } from "@/lib/auth";
import { cachedBanks } from "@/lib/bankVerify";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  await requireAgent(req);
  const banks = await cachedBanks();
  return json({ banks });
});
