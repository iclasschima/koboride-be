import type { Prisma } from "@prisma/client";
import { api, json, options } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { config } from "@/lib/config";
import { presentOrigin, reconcileDuplicateCustomers, sourceMerchantInclude } from "@/lib/customers";
import { betweenDays, pageInfo, phoneTerms, readListQuery } from "@/lib/listQuery";
import { cancelWindowStart } from "@/lib/orders";
import { samePhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

const SPENDING: Prisma.OrderWhereInput = { status: { in: ["in_progress", "completed"] } };

/** Paged by `page`/`pageSize`, filtered by join day (`from`/`to`) and `q`. Totals cover every match. */
export const GET = api(async (req) => {
  await requireAdmin(req, "users");
  await reconcileDuplicateCustomers();
  const query = readListQuery(req, 50, 200);

  const createdAt = betweenDays(query);
  const where: Prisma.CustomerWhereInput = {
    ...(createdAt ? { createdAt } : {}),
    ...(query.q ? { OR: customerSearch(query.q) } : {}),
  };

  const [customers, total, activeCount, matchIds, ordersCount, spentAll, riders, recentCancels] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        ...sourceMerchantInclude,
        _count: { select: { orders: true } },
        orders: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true, status: true, feeNgn: true },
        },
      },
    }),
    prisma.customer.count({ where }),
    prisma.customer.count({ where: { ...where, active: true } }),
    prisma.customer.findMany({ where, select: { id: true, cancelLimitResetAt: true } }),
    prisma.order.count({ where: { customer: where } }),
    prisma.order.aggregate({ where: { customer: where, ...SPENDING }, _sum: { feeNgn: true } }),
    prisma.rider.findMany({ select: { phone: true } }),
    prisma.order.findMany({
      where: { status: "cancelled", updatedAt: { gte: cancelWindowStart() } },
      select: { customerId: true, updatedAt: true },
    }),
  ]);

  const spend = await prisma.order.groupBy({
    by: ["customerId"],
    where: { customerId: { in: customers.map((customer) => customer.id) }, ...SPENDING },
    _sum: { feeNgn: true },
  });
  const spentByCustomer = new Map(spend.map((row) => [row.customerId, row._sum.feeNgn ?? 0]));

  const resetAtByCustomer = new Map(matchIds.map((c) => [c.id, c.cancelLimitResetAt]));
  const cancelsByCustomer = new Map<string, number>();
  for (const row of recentCancels) {
    if (!resetAtByCustomer.has(row.customerId)) continue;
    if (row.updatedAt < cancelWindowStart(resetAtByCustomer.get(row.customerId))) continue;
    cancelsByCustomer.set(row.customerId, (cancelsByCustomer.get(row.customerId) ?? 0) + 1);
  }
  let onHold = 0;
  cancelsByCustomer.forEach((count) => {
    if (count >= config.maxCancelsPerWindow) onHold += 1;
  });

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
        origin: presentOrigin(customer),
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
    ...pageInfo(total, query),
    totals: { users: total, active: activeCount, onHold, orders: ordersCount, spentNgn: spentAll._sum.feeNgn ?? 0 },
  });
});

function customerSearch(q: string): Prisma.CustomerWhereInput[] {
  const text = { contains: q, mode: "insensitive" as const };
  return [
    { name: text },
    ...phoneTerms(q).map((term) => ({ phone: { contains: term } })),
    { sourceRef: text },
    { sourceLanding: text },
    { sourceReferrer: text },
    { sourceMerchant: { name: text } },
  ];
}
