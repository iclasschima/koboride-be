import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { requireMerchant } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseBody, readJson } from "@/lib/validate";
import { createMerchantOrder, presentMerchantOrder } from "@/lib/merchants";
import { shopLedger } from "@/lib/shopPayouts";
import { assertServiceOpen } from "@/lib/settings";
import { orderInclude } from "@/lib/orders";
import { PACKAGE_TYPES } from "@/lib/packages";

export const OPTIONS = () => options();

const rangeSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  open: z.enum(["1"]).optional(),
});

/** With from/to: that window (the shop's local day), plus still-open bags when open=1. */
export const GET = api(async (req) => {
  const { merchant } = await requireMerchant(req);
  const params = Object.fromEntries(new URL(req.url).searchParams);
  if (!params.from && !params.to) {
    const orders = await prisma.order.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: orderInclude,
    });
    const { paidAt } = await shopLedger(merchant.id);
    return json({ orders: orders.map((order) => presentMerchantOrder(order, paidAt.get(order.id))) });
  }
  const range = parseBody(rangeSchema, params);
  const inRange = { createdAt: { gte: new Date(range.from), lt: new Date(range.to) } };
  const orders = await prisma.order.findMany({
    where: {
      merchantId: merchant.id,
      OR: range.open
        ? [inRange, { status: { in: ["dispatching", "in_progress"] } }]
        : [inRange],
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: orderInclude,
  });
  const { paidAt } = await shopLedger(merchant.id);
  return json({ orders: orders.map((order) => presentMerchantOrder(order, paidAt.get(order.id))) });
});

export const POST = api(async (req) => {
  const { merchant } = await requireMerchant(req);
  await assertServiceOpen();
  const body = parseBody(
    z.object({
      dropoff: z.string().min(3).max(240),
      dropoffLat: z.number().finite(),
      dropoffLng: z.number().finite(),
      receiverName: z.string().min(2).max(80),
      receiverPhone: z.string().min(7).max(20),
      notes: z.string().max(400).optional(),
      packageType: z.enum(PACKAGE_TYPES).optional(),
      farePayer: z.enum(["sender", "receiver"]),
      scheduledFor: z.string().min(10).optional(),
    }),
    await readJson(req),
  );
  const order = await createMerchantOrder({
    merchant,
    dropoff: body.dropoff,
    dropoffLat: body.dropoffLat,
    dropoffLng: body.dropoffLng,
    receiverName: body.receiverName,
    receiverPhone: body.receiverPhone,
    notes: body.notes,
    packageType: body.packageType,
    farePayer: body.farePayer,
    scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
    holdUntilReady: false,
  });
  return json({ order: presentMerchantOrder(order) }, 201);
});
