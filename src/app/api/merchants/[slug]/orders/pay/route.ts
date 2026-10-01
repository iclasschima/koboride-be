import { api, json, options, AppError } from "@/lib/errors";
import { shopCheckoutCustomer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseBody, readJson } from "@/lib/validate";
import { shopLive, shopOrderSchema, startShopCardPayment } from "@/lib/merchants";
import { assertServiceOpen } from "@/lib/settings";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const slug = ctx.params?.slug;
  if (!slug) throw new AppError("Missing shop", "VALIDATION_ERROR", 400);
  const merchant = await prisma.merchant.findUnique({ where: { slug } });
  if (!merchant || !shopLive(merchant)) {
    throw new AppError("This shop is not available", "NOT_FOUND", 404);
  }
  await assertServiceOpen();
  const body = parseBody(shopOrderSchema, await readJson(req));
  const { customer } = await shopCheckoutCustomer(req, body, merchant.id);
  return json(await startShopCardPayment(merchant, body, customer));
});
