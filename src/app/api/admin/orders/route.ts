import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
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
      customerRole: z.enum(["sender", "receiver"]).optional(),
      senderName: z.string().min(2).max(80).optional(),
      senderPhone: z.string().min(7).max(20).optional(),
      receiverName: z.string().min(2).max(80).optional(),
      receiverPhone: z.string().min(7).max(20).optional(),
      riderId: z.string().min(1).optional(),
    }),
    await readJson(req),
  );

  const customer = await findOrCreateCustomer(body.customerPhone, body.customerName);

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
