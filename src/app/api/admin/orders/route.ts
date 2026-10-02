import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { api, json, options } from "@/lib/errors";
import { betweenDays, pageInfo, phoneTerms, readListQuery } from "@/lib/listQuery";
import { parseBody, readJson } from "@/lib/validate";
import { requireAdmin } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import {
  autoConfirmStaleDeliveries,
  orderInclude,
  placeOrder,
  presentTrip,
  resolveCustomerContacts,
} from "@/lib/orders";
import { findOrCreateCustomer } from "@/lib/customers";

export const OPTIONS = () => options();

const STATUSES = ["dispatching", "in_progress", "completed", "cancelled"] as const;

/** Without `page`/`pageSize` this returns the newest 500, which the overview relies on. */
export const GET = api(async (req) => {
  await requireAdmin(req, "orders");
  await autoConfirmStaleDeliveries();
  const query = readListQuery(req, 500);
  const params = new URL(req.url).searchParams;
  const { status, shop } = parseBody(
    z.object({ status: z.enum(STATUSES).optional(), shop: z.string().min(1).optional() }),
    { status: params.get("status") || undefined, shop: params.get("shop") || undefined },
  );

  const createdAt = betweenDays(query);
  const where: Prisma.OrderWhereInput = {
    ...(createdAt ? { createdAt } : {}),
    ...(shop ? { merchantId: shop } : {}),
    ...(query.q ? { OR: orderSearch(query.q) } : {}),
  };
  const listed = status ? { ...where, status } : where;
  const [orders, total, byStatus] = await Promise.all([
    prisma.order.findMany({
      where: listed,
      include: orderInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.order.count({ where: listed }),
    prisma.order.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);
  const counts = Object.fromEntries(STATUSES.map((key) => [key, 0])) as Record<(typeof STATUSES)[number], number>;
  for (const row of byStatus) counts[row.status] = row._count._all;
  return json({ trips: orders.map(presentTrip), ...pageInfo(total, query), counts });
});

function orderSearch(q: string): Prisma.OrderWhereInput[] {
  const text = { contains: q, mode: "insensitive" as const };
  const phones = phoneTerms(q).map((term) => ({ contains: term }));
  return [
    { id: text },
    { pickup: text },
    { dropoff: text },
    { notes: text },
    { senderName: text },
    { receiverName: text },
    { rider: { name: text } },
    { customer: { name: text } },
    ...phones.flatMap((phone) => [
      { senderPhone: phone },
      { receiverPhone: phone },
      { customer: { phone } },
    ]),
  ];
}

export const POST = api(async (req) => {
  await requireAdmin(req, "orders");
  const body = parseBody(
    z.object({
      customerName: z.string().min(1).max(80).optional(),
      customerPhone: z.string().min(7).max(20),
      pickup: z.string().min(2),
      dropoff: z.string().min(2),
      notes: z.string().min(1).max(500),
      pickupLat: z.number().finite(),
      pickupLng: z.number().finite(),
      dropoffLat: z.number().finite(),
      dropoffLng: z.number().finite(),
      customerRole: z.enum(["sender", "receiver"]).optional(),
      senderName: z.string().min(2).max(80).optional(),
      senderPhone: z.string().min(7).max(20).optional(),
      receiverName: z.string().min(2).max(80).optional(),
      receiverPhone: z.string().min(7).max(20).optional(),
      riderId: z.string().min(1).optional(),
    }),
    await readJson(req),
  );

  const customer = await findOrCreateCustomer(body.customerPhone, body.customerName, { source: "admin" });

  const contacts = resolveCustomerContacts({
    customerRole: body.customerRole,
    customerName: customer.name?.trim() || body.customerName?.trim() || "Customer",
    customerPhone: customer.phone,
    senderName: body.senderName,
    senderPhone: body.senderPhone,
    receiverName: body.receiverName,
    receiverPhone: body.receiverPhone,
  });

  const order = await placeOrder({
    customerId: customer.id,
    pickup: body.pickup,
    dropoff: body.dropoff,
    notes: body.notes,
    pickupLat: body.pickupLat,
    pickupLng: body.pickupLng,
    dropoffLat: body.dropoffLat,
    dropoffLng: body.dropoffLng,
    ...contacts,
    riderId: body.riderId,
  });

  return json({ trip: presentTrip(order) }, 201);
});
