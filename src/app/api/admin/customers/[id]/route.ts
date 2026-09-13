import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { countActiveOrders, countRecentCancels, orderInclude, presentTrip } from "@/lib/orders";
import { phoneLookupKeys } from "@/lib/phone";
import { getMaxActiveOrders } from "@/lib/settings";

export const OPTIONS = () => options();

export const GET = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing customer id", "VALIDATION_ERROR", 400);

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      _count: { select: { orders: true } },
      orders: {
        include: orderInclude,
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!customer) throw new AppError("Customer not found", "NOT_FOUND", 404);

  const rider = await prisma.rider.findFirst({
    where: { phone: { in: phoneLookupKeys(customer.phone) } },
    select: { id: true, approved: true },
  });

  const spentNgn = customer.orders
    .filter((o) => o.status === "in_progress" || o.status === "completed")
    .reduce((sum, o) => sum + o.feeNgn, 0);
  const last = customer.orders[0];
  const [cancelsInWindow, activeOrders, maxActiveOrders] = await Promise.all([
    countRecentCancels(customer.id, customer.cancelLimitResetAt),
    countActiveOrders(customer.id),
    getMaxActiveOrders(),
  ]);

  return json({
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      active: customer.active,
      createdAt: customer.createdAt.toISOString(),
      ordersCount: customer._count.orders,
      lastOrderAt: last?.createdAt.toISOString() ?? null,
      lastOrderStatus: last?.status ?? null,
      spentNgn,
      isRider: Boolean(rider),
      cancelsInWindow,
      cancelLimit: config.maxCancelsPerWindow,
      cancelWindowHours: config.cancelWindowHours,
      cancelLimited: cancelsInWindow >= config.maxCancelsPerWindow,
      activeOrders,
      maxActiveOrders,
    },
    trips: customer.orders.map(presentTrip),
  });
});

export const PATCH = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing customer id", "VALIDATION_ERROR", 400);

  const body = parseBody(
    z.object({
      active: z.boolean().optional(),
      resetCancelLimit: z.boolean().optional(),
    }),
    await readJson(req),
  );
  if (body.active === undefined && !body.resetCancelLimit) {
    throw new AppError("Nothing to update", "VALIDATION_ERROR", 400);
  }

  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) throw new AppError("Customer not found", "NOT_FOUND", 404);

  const updated = await prisma.customer.update({
    where: { id },
    data: {
      ...(body.active === undefined ? {} : { active: body.active }),
      ...(body.resetCancelLimit ? { cancelLimitResetAt: new Date() } : {}),
    },
    include: { _count: { select: { orders: true } } },
  });

  const cancelsInWindow = await countRecentCancels(updated.id, updated.cancelLimitResetAt);

  return json({
    customer: {
      id: updated.id,
      name: updated.name,
      phone: updated.phone,
      active: updated.active,
      createdAt: updated.createdAt.toISOString(),
      ordersCount: updated._count.orders,
      cancelsInWindow,
      cancelLimit: config.maxCancelsPerWindow,
      cancelWindowHours: config.cancelWindowHours,
      cancelLimited: cancelsInWindow >= config.maxCancelsPerWindow,
    },
  });
});
