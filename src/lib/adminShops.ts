import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { orderInclude, presentTrip } from "@/lib/orders";
import { adminShopBank, listShopItems, presentMerchant } from "@/lib/merchants";
import { shopPayoutNgn } from "@/lib/shopMoney";
import { paystackConfigured } from "@/lib/paystack";
import { presentShopPayout, shopLedger, shopSettlement } from "@/lib/shopPayouts";
import { betweenDays } from "@/lib/listQuery";

const SHOP_ORDERS_LIMIT = 500;

export async function findShop(id: string | undefined) {
  if (!id) throw new AppError("Missing shop id", "VALIDATION_ERROR", 400);
  const merchant = await prisma.merchant.findUnique({ where: { id } });
  if (!merchant) throw new AppError("Shop not found", "NOT_FOUND", 404);
  return merchant;
}

export async function presentAdminShop(id: string | undefined) {
  const merchant = await findShop(id);
  const [items, orders, settlement, customersCount, payouts] = await Promise.all([
    listShopItems(merchant.id),
    prisma.order.findMany({
      where: { merchantId: merchant.id },
      select: { status: true, feeNgn: true, farePayer: true, goodsNgn: true },
    }),
    shopSettlement(merchant.id),
    prisma.customer.count({ where: { sourceMerchantId: merchant.id } }),
    prisma.shopPayout.findMany({ where: { merchantId: merchant.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const completed = orders.filter((order) => order.status === "completed");
  return {
    merchant: {
      ...presentMerchant(merchant, items),
      createdAt: merchant.createdAt.toISOString(),
      approvedAt: merchant.approvedAt?.toISOString() ?? null,
      ordersCount: orders.length,
      /** Customers whose account started with this shop's link or bag. */
      customersCount,
      liveCount: orders.filter((order) => order.status === "dispatching" || order.status === "in_progress").length,
      deliveredCount: completed.length,
      deliveryNgn: completed.reduce((sum, order) => sum + order.feeNgn, 0),
      shopPaidNgn: completed
        .filter((order) => order.farePayer === "sender")
        .reduce((sum, order) => sum + order.feeNgn, 0),
      itemsNgn: completed.reduce((sum, order) => sum + order.goodsNgn, 0),
      bank: adminShopBank(merchant),
      settlement,
      /** Whether "Send with Paystack" can be offered at all. */
      paystackTransfers: paystackConfigured(),
      payouts: payouts.map(presentShopPayout),
    },
  };
}

/** A shop's orders booked between two Lagos days (both included), with totals over every match. */
export async function listAdminShopOrders(id: string | undefined, range: { from?: string; to?: string }) {
  const merchant = await findShop(id);
  const createdAt = betweenDays(range);
  const where = { merchantId: merchant.id, ...(createdAt ? { createdAt } : {}) };
  const [orders, all, { paidAt }] = await Promise.all([
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: { createdAt: "desc" },
      take: SHOP_ORDERS_LIMIT,
    }),
    prisma.order.findMany({
      where,
      select: {
        status: true,
        paymentStatus: true,
        goodsNgn: true,
        feeNgn: true,
        farePayer: true,
        paymentFeeNgn: true,
      },
    }),
    shopLedger(merchant.id),
  ]);
  const counted = all.filter((order) => order.status !== "cancelled" && order.paymentStatus !== "refunded");
  return {
    trips: orders.map((order) => ({
      ...presentTrip(order),
      shopPaidOutAt: paidAt.get(order.id)?.toISOString() ?? null,
    })),
    totals: {
      orders: counted.length,
      customerPaidNgn: counted.reduce(
        (sum, order) =>
          sum + order.goodsNgn + (order.farePayer === "receiver" ? order.feeNgn : 0) + order.paymentFeeNgn,
        0,
      ),
      shopNgn: counted.reduce((sum, order) => sum + shopPayoutNgn(order), 0),
    },
  };
}
