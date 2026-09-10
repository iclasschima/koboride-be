import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { autoConfirmStaleDeliveries, orderInclude, placeOrder, presentTrip } from "@/lib/orders";
import { phoneLookupKeys, preferredPhone } from "@/lib/phone";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  requireUser(req, ["admin"]);
  await autoConfirmStaleDeliveries();
  const orders = await prisma.order.findMany({
    include: orderInclude,
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return json({ trips: orders.map(presentTrip) });
});

export const POST = api(async (req) => {
  requireUser(req, ["admin"]);
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
      senderName: z.string().min(2).max(80).optional(),
      senderPhone: z.string().min(7).max(20).optional(),
      receiverName: z.string().min(2).max(80),
      receiverPhone: z.string().min(7).max(20),
      riderId: z.string().min(1).optional(),
    }),
    await readJson(req),
  );

  const keys = phoneLookupKeys(body.customerPhone);
  const existing = await prisma.customer.findFirst({ where: { phone: { in: keys } } });
  const name = body.customerName?.trim();
  const customer = existing
    ? await prisma.customer.update({
        where: { id: existing.id },
        data: name ? { name } : {},
      })
    : await prisma.customer.create({
        data: { phone: preferredPhone(body.customerPhone), name: name || undefined },
      });

  const senderName = body.senderName?.trim() || customer.name?.trim() || name || "Customer";
  const senderPhone = preferredPhone(body.senderPhone || customer.phone);

  const order = await placeOrder({
    customerId: customer.id,
    pickup: body.pickup,
    dropoff: body.dropoff,
    notes: body.notes,
    pickupLat: body.pickupLat,
    pickupLng: body.pickupLng,
    dropoffLat: body.dropoffLat,
    dropoffLng: body.dropoffLng,
    senderName,
    senderPhone,
    receiverName: body.receiverName.trim(),
    receiverPhone: preferredPhone(body.receiverPhone),
    riderId: body.riderId,
  });

  return json({ trip: presentTrip(order) }, 201);
});
