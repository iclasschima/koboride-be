import { api, json, options, AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { presentItem, shopLive } from "@/lib/merchants";

export const OPTIONS = () => options();

export const GET = api(async (_req, ctx) => {
  const slug = ctx.params?.slug;
  if (!slug) throw new AppError("Missing shop", "VALIDATION_ERROR", 400);
  const merchant = await prisma.merchant.findUnique({ where: { slug } });
  if (!merchant || !shopLive(merchant)) {
    throw new AppError("This shop is not available", "NOT_FOUND", 404);
  }
  const items = await prisma.menuItem.findMany({
    where: { merchantId: merchant.id, available: true },
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
  });
  return json({
    shop: {
      name: merchant.name,
      slug: merchant.slug,
      address: merchant.address,
      deliveryPayer: merchant.deliveryPayer,
      items: items.map(presentItem),
    },
  });
});
