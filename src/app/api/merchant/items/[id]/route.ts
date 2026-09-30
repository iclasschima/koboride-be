import { api, json, options, AppError } from "@/lib/errors";
import { requireMerchant } from "@/lib/auth";
import { parseBody, readJson } from "@/lib/validate";
import { itemPatchSchema, presentItem, removeShopItem, updateShopItem } from "@/lib/merchants";

export const OPTIONS = () => options();

export const PATCH = api(async (req, ctx) => {
  const { merchant } = await requireMerchant(req);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing item", "VALIDATION_ERROR", 400);
  const body = parseBody(itemPatchSchema, await readJson(req));
  const item = await updateShopItem(merchant.id, id, body);
  return json({ item: presentItem(item) });
});

export const DELETE = api(async (req, ctx) => {
  const { merchant } = await requireMerchant(req);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing item", "VALIDATION_ERROR", 400);
  await removeShopItem(merchant.id, id);
  return json({ ok: true });
});
