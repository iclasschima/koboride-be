import { api, json, options } from "@/lib/errors";
import { loadRider } from "@/lib/auth";
import { cachedBanks } from "@/lib/bankVerify";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  await loadRider(req);
  const banks = await cachedBanks();
  return json({ banks });
});
