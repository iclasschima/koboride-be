import { api, json, options } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { lookupAccountName } from "@/lib/bankVerify";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  requireUser(req, ["admin"]);
  const url = new URL(req.url);
  const accountName = await lookupAccountName(
    url.searchParams.get("bankCode") ?? "",
    url.searchParams.get("accountNumber") ?? "",
  );
  return json({ accountName });
});
