import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { parseBody, readJson } from "@/lib/validate";
import { itemPatchSchema, presentItem, removeShopItem, updateShopItem } from "@/lib/merchants";

export const OPTIONS = () => options();

function ids(ctx: { params?: Record<string, string> }) {
  const id = ctx.params?.id;
  const itemId = ctx.params?.itemId;
  if (!id || !itemId) throw new AppError("Missing item", "VALIDATION_ERROR", 400);
  return { id, itemId };
}

export const PATCH = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const { id, itemId } = ids(ctx);
  const body = parseBody(itemPatchSchema, await readJson(req));
  const item = await updateShopItem(id, itemId, body);
  return json({ item: presentItem(item) });
});

export const DELETE = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const { id, itemId } = ids(ctx);
  await removeShopItem(id, itemId);
  return json({ ok: true });
});
