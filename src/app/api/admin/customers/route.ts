import { api, json, options } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  requireUser(req, ["admin"]);

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

  const riderPhones = new Set(riders.map((r) => r.phone));

  const spend = await prisma.order.groupBy({
    by: ["customerId"],
    where: { status: { in: ["in_progress", "completed"] } },
    _sum: { feeNgn: true },
  });
  const spentByCustomer = new Map(spend.map((row) => [row.customerId, row._sum.feeNgn ?? 0]));

  return json({
    customers: customers.map((customer) => {
      const last = customer.orders[0];
      return {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        createdAt: customer.createdAt.toISOString(),
        ordersCount: customer._count.orders,
        lastOrderAt: last?.createdAt.toISOString() ?? null,
        lastOrderStatus: last?.status ?? null,
        spentNgn: spentByCustomer.get(customer.id) ?? 0,
        isRider: riderPhones.has(customer.phone),
      };
    }),
  });
});
