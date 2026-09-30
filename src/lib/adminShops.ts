import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { orderInclude, presentTrip } from "@/lib/orders";
import { adminShopBank, listShopItems, presentMerchant, shopSettlement } from "@/lib/merchants";

export async function findShop(id: string | undefined) {
  if (!id) throw new AppError("Missing shop id", "VALIDATION_ERROR", 400);
  const merchant = await prisma.merchant.findUnique({ where: { id } });
  if (!merchant) throw new AppError("Shop not found", "NOT_FOUND", 404);
  return merchant;
}

export async function presentAdminShop(id: string | undefined) {
  const merchant = await findShop(id);
  const [items, orders, settlement] = await Promise.all([
    listShopItems(merchant.id),
    prisma.order.findMany({
      where: { merchantId: merchant.id },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    shopSettlement(merchant.id),
  ]);
  const completed = orders.filter((order) => order.status === "completed");
  return {
    merchant: {
      ...presentMerchant(merchant, items),
      createdAt: merchant.createdAt.toISOString(),
      approvedAt: merchant.approvedAt?.toISOString() ?? null,
      ordersCount: orders.length,
      liveCount: orders.filter((order) => order.status === "dispatching" || order.status === "in_progress").length,
      deliveredCount: completed.length,
      deliveryNgn: completed.reduce((sum, order) => sum + order.feeNgn, 0),
      shopPaidNgn: completed
        .filter((order) => order.farePayer === "sender")
        .reduce((sum, order) => sum + order.feeNgn, 0),
      itemsNgn: completed.reduce((sum, order) => sum + order.goodsNgn, 0),
      bank: adminShopBank(merchant),
      settlement,
    },
    trips: orders.map(presentTrip),
  };
}
