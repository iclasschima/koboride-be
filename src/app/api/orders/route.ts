import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { orderInclude, presentTrip, autoConfirmStaleDeliveries } from "@/lib/orders";
import { quoteRoute } from "@/lib/fare";
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

  const senderName = (body.senderName?.trim() || customer.name?.trim() || "Customer");
  const senderPhone = preferredPhone(body.senderPhone || customer.phone);

  const quote = quoteRoute(body);
  const order = await prisma.order.create({
    data: {
      customerId: user.sub,
      pickup: quote.pickup,
      dropoff: quote.dropoff,
      notes: body.notes.trim(),
      senderName,
      senderPhone,
      receiverName: body.receiverName.trim(),
      receiverPhone: preferredPhone(body.receiverPhone),
      pickupLat: quote.pickupLat,
      pickupLng: quote.pickupLng,
      dropoffLat: quote.dropoffLat,
      dropoffLng: quote.dropoffLng,
      feeNgn: quote.feeNgn,
      payoutNgn: quote.payoutNgn,
    },
    include: orderInclude,
  });

  return json({ trip: presentTrip(order) }, 201);
});
