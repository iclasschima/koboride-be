import { api, json, options } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { presentMerchant } from "@/lib/merchants";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  requireUser(req, ["admin"]);
  const [merchants, totals, delivered] = await Promise.all([
    prisma.merchant.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { orders: true, items: true } },
        orders: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      },
    }),
    prisma.order.groupBy({
      by: ["merchantId"],
      where: { merchantId: { not: null } },
      _count: { _all: true },
    }),
    prisma.order.groupBy({
      by: ["merchantId"],
      where: { merchantId: { not: null }, status: "completed" },
      _count: { _all: true },
      _sum: { feeNgn: true },
    }),
  ]);
  const orderCount = new Map(totals.map((row) => [row.merchantId, row._count._all]));
  const done = new Map(delivered.map((row) => [row.merchantId, row]));

  return json({
    merchants: merchants.map((merchant) => ({
      ...presentMerchant(merchant),
      createdAt: merchant.createdAt.toISOString(),
      approvedAt: merchant.approvedAt?.toISOString() ?? null,
      itemsCount: merchant._count.items,
      ordersCount: orderCount.get(merchant.id) ?? 0,
      deliveredCount: done.get(merchant.id)?._count._all ?? 0,
      deliveryNgn: done.get(merchant.id)?._sum.feeNgn ?? 0,
      lastOrderAt: merchant.orders[0]?.createdAt.toISOString() ?? null,
    })),
  });
});
