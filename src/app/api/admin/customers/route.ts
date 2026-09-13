import { api, json, options } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { reconcileDuplicateCustomers } from "@/lib/customers";
import { cancelWindowStart } from "@/lib/orders";
import { samePhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  requireUser(req, ["admin"]);
  await reconcileDuplicateCustomers();

  const [customers, riders] = await Promise.all([
    prisma.customer.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { orders: true } },
        orders: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            createdAt: true,
            status: true,
            feeNgn: true,
          },
        },
      },
    }),
    prisma.rider.findMany({ select: { phone: true } }),
  ]);

  const spend = await prisma.order.groupBy({
    by: ["customerId"],
    where: { status: { in: ["in_progress", "completed"] } },
    _sum: { feeNgn: true },
  });
  const spentByCustomer = new Map(spend.map((row) => [row.customerId, row._sum.feeNgn ?? 0]));

  const resetAtByCustomer = new Map(customers.map((c) => [c.id, c.cancelLimitResetAt]));
  const recentCancels = await prisma.order.findMany({
    where: {
      status: "cancelled",
      updatedAt: { gte: cancelWindowStart() },
    },
    select: { customerId: true, updatedAt: true },
  });
  const cancelsByCustomer = new Map<string, number>();
  for (const row of recentCancels) {
    if (row.updatedAt < cancelWindowStart(resetAtByCustomer.get(row.customerId))) continue;
    cancelsByCustomer.set(row.customerId, (cancelsByCustomer.get(row.customerId) ?? 0) + 1);
  }

  return json({
    customers: customers.map((customer) => {
      const last = customer.orders[0];
      const cancelsInWindow = cancelsByCustomer.get(customer.id) ?? 0;
      return {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        active: customer.active,
        createdAt: customer.createdAt.toISOString(),
        ordersCount: customer._count.orders,
        lastOrderAt: last?.createdAt.toISOString() ?? null,
        lastOrderStatus: last?.status ?? null,
        spentNgn: spentByCustomer.get(customer.id) ?? 0,
        isRider: riders.some((r) => samePhone(r.phone, customer.phone)),
        cancelsInWindow,
        cancelLimit: config.maxCancelsPerWindow,
        cancelWindowHours: config.cancelWindowHours,
        cancelLimited: cancelsInWindow >= config.maxCancelsPerWindow,
      };
    }),
  });
});
