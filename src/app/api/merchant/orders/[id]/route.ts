import { api, json, options, AppError } from "@/lib/errors";
import { requireMerchant } from "@/lib/auth";
import { ownOrder, presentMerchantOrder } from "@/lib/merchants";
import { shopLedger } from "@/lib/shopPayouts";

export const OPTIONS = () => options();

export const GET = api(async (req, ctx) => {
  const { merchant } = await requireMerchant(req);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order", "VALIDATION_ERROR", 400);
  const [order, { paidAt }] = await Promise.all([ownOrder(merchant.id, id), shopLedger(merchant.id)]);
  return json({ order: presentMerchantOrder(order, paidAt.get(order.id)) });
});
