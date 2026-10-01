import { api, json, options } from "@/lib/errors";
import { requireMerchant } from "@/lib/auth";
import { parseBody, readJson } from "@/lib/validate";
import { listShopItems, presentMerchant, setShopBank, shopBankSchema } from "@/lib/merchants";
import { shopSettlement } from "@/lib/shopPayouts";

export const OPTIONS = () => options();

export const PUT = api(async (req) => {
  const { merchant } = await requireMerchant(req);
  const body = parseBody(shopBankSchema, await readJson(req));
  const updated = await setShopBank(merchant.id, body);
  return json({
    merchant: presentMerchant(updated, await listShopItems(merchant.id)),
    settlement: await shopSettlement(merchant.id),
  });
});
