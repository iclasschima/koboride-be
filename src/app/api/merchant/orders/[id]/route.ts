import { api, json, options, AppError } from "@/lib/errors";
import { requireMerchant } from "@/lib/auth";
import { ownOrder, presentMerchantOrder } from "@/lib/merchants";

export const OPTIONS = () => options();

export const GET = api(async (req, ctx) => {
  const { merchant } = await requireMerchant(req);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order", "VALIDATION_ERROR", 400);
  const order = await ownOrder(merchant.id, id);
  return json({ order: presentMerchantOrder(order) });
});
