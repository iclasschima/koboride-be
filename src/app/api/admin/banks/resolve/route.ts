import { api, json, options } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { lookupAccountName } from "@/lib/bankVerify";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  await requireAdmin(req);
  const url = new URL(req.url);
  const accountName = await lookupAccountName(
    url.searchParams.get("bankCode") ?? "",
    url.searchParams.get("accountNumber") ?? "",
  );
  return json({ accountName });
});
