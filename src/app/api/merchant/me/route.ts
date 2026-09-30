import { api, json, options } from "@/lib/errors";
import { requireMerchant } from "@/lib/auth";
import { parseBody, readJson } from "@/lib/validate";
import { listShopItems, presentMerchant, shopPatchSchema, shopReady, updateShop } from "@/lib/merchants";
import { notifyAdminShopPending } from "@/lib/push";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  const { merchant } = await requireMerchant(req);
  return json({ merchant: presentMerchant(merchant, await listShopItems(merchant.id)) });
});

export const PATCH = api(async (req) => {
  const { merchant } = await requireMerchant(req);
  const body = parseBody(shopPatchSchema, await readJson(req));
  const updated = await updateShop(merchant, body);
  if (!updated.approvedAt && !shopReady(merchant) && shopReady(updated)) {
    await notifyAdminShopPending(updated);
  }
  return json({ merchant: presentMerchant(updated, await listShopItems(merchant.id)) });
});
