import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseBody, readJson } from "@/lib/validate";
import { addShopItem, itemCreateSchema, presentItem } from "@/lib/merchants";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing shop id", "VALIDATION_ERROR", 400);
  const shop = await prisma.merchant.findUnique({ where: { id }, select: { id: true } });
  if (!shop) throw new AppError("Shop not found", "NOT_FOUND", 404);
  const body = parseBody(itemCreateSchema, await readJson(req));
  const item = await addShopItem(shop.id, body);
  return json({ item: presentItem(item) }, 201);
});
