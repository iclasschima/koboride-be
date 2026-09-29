import { api, json, options } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { cachedBanks } from "@/lib/bankVerify";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  requireUser(req, ["admin"]);
  const banks = await cachedBanks();
  return json({ banks });
});
