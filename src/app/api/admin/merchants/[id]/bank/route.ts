import { api, json, options } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { parseBody, readJson } from "@/lib/validate";
import { setShopBank, shopBankSchema } from "@/lib/merchants";
import { findShop, presentAdminShop } from "@/lib/adminShops";

export const OPTIONS = () => options();

export const PUT = api(async (req, ctx) => {
  await requireAdmin(req, "shops");
  const merchant = await findShop(ctx.params?.id);
  const body = parseBody(shopBankSchema, await readJson(req));
  await setShopBank(merchant.id, body);
  return json(await presentAdminShop(merchant.id));
});
