import { api, json, options, AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { presentItem, shopCardPayments, shopLive } from "@/lib/merchants";
import { shopHours, shopOpenAt } from "@/lib/shopHours";

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
      phone: merchant.callPhone ?? merchant.phone,
      whatsapp: merchant.whatsappPhone,
      hours: shopHours(merchant),
      openNow: shopOpenAt(shopHours(merchant)),
      cardPayments: await shopCardPayments(),
      items: items.map(presentItem),
    },
  });
});
