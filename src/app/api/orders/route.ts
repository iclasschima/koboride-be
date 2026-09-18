import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson, customerBookingSchema } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  orderInclude,
  presentTrip,
  autoConfirmStaleDeliveries,
  placeOrder,
  resolveCustomerContacts,
} from "@/lib/orders";
import { getMaxActiveOrders } from "@/lib/settings";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  const user = requireUser(req, ["customer"]);
  await autoConfirmStaleDeliveries();
  const [orders, maxActiveOrders] = await Promise.all([
    prisma.order.findMany({
      where: { customerId: user.sub },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
    }),
    getMaxActiveOrders(),
  ]);
  const activeOrders = orders.filter(
    (o) => o.status === "dispatching" || o.status === "in_progress",
  ).length;
  return json({
    trips: orders.map(presentTrip),
    activeOrders,
    maxActiveOrders,
    canPlaceOrder: activeOrders < maxActiveOrders,
  });
});

export const POST = api(async (req) => {
  const user = requireUser(req, ["customer"]);
  const body = parseBody(
    customerBookingSchema.extend({
      paymentMethod: z.enum(["cash", "paystack"]).optional(),
      paystackReference: z.string().min(8).max(80).optional(),
    }),
    await readJson(req),
  );

  const customer = await prisma.customer.findUnique({ where: { id: user.sub } });
  if (!customer) {
    throw new AppError("Customer not found", "NOT_FOUND", 404);
  }

  const contacts = resolveCustomerContacts({
    customerRole: body.customerRole,
    customerName: customer.name?.trim() || "Customer",
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
    paymentMethod: body.paymentMethod === "paystack" ? "paystack" : "cash",
    paystackReference: body.paystackReference,
  });

  return json({ trip: presentTrip(order) }, 201);
});
