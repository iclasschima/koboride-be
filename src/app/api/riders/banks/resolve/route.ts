import { api, json, options } from "@/lib/errors";
import { loadRider } from "@/lib/auth";
import { lookupAccountName } from "@/lib/bankVerify";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  await loadRider(req);
  const url = new URL(req.url);
  const accountName = await lookupAccountName(
    url.searchParams.get("bankCode") ?? "",
    url.searchParams.get("accountNumber") ?? "",
  );
  return json({ accountName });
});
