import { api, json, options } from "@/lib/errors";
import { requireMerchant } from "@/lib/auth";
import { parseBody, readJson } from "@/lib/validate";
import { addShopItem, itemCreateSchema, listShopItems, presentItem } from "@/lib/merchants";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  const { merchant } = await requireMerchant(req);
  const items = await listShopItems(merchant.id);
  return json({ items: items.map(presentItem) });
});

export const POST = api(async (req) => {
  const { merchant } = await requireMerchant(req);
  const body = parseBody(itemCreateSchema, await readJson(req));
  const item = await addShopItem(merchant.id, body);
  return json({ item: presentItem(item) }, 201);
});
