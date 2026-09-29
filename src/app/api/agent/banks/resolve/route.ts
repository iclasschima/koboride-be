import { api, json, options } from "@/lib/errors";
import { requireAgent } from "@/lib/auth";
import { lookupAccountName } from "@/lib/bankVerify";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  await requireAgent(req);
  const url = new URL(req.url);
  const accountName = await lookupAccountName(
    url.searchParams.get("bankCode") ?? "",
    url.searchParams.get("accountNumber") ?? "",
  );
  return json({ accountName });
});
