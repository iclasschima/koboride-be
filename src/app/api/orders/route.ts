import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { orderInclude, presentTrip, autoConfirmStaleDeliveries, placeOrder } from "@/lib/orders";
import { preferredPhone } from "@/lib/phone";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  const user = requireUser(req, ["customer"]);
  await autoConfirmStaleDeliveries();
  const orders = await prisma.order.findMany({
    where: { customerId: user.sub },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });
  return json({ trips: orders.map(presentTrip) });
});

export const POST = api(async (req) => {
  const user = requireUser(req, ["customer"]);
  const body = parseBody(
    z.object({
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
    }),
    await readJson(req),
  );

  const customer = await prisma.customer.findUnique({ where: { id: user.sub } });
  if (!customer) {
    throw new AppError("Customer not found", "NOT_FOUND", 404);
  }

  const senderName = body.senderName?.trim() || customer.name?.trim() || "Customer";
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
  });

  return json({ trip: presentTrip(order) }, 201);
});
