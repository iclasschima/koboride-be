import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { orderInclude, presentTrip } from "@/lib/orders";
import { quoteRoute } from "@/lib/fare";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  const user = requireUser(req, ["customer"]);
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
    }),
    await readJson(req),
  );

  const quote = quoteRoute(body);
  const order = await prisma.order.create({
    data: {
      customerId: user.sub,
      pickup: quote.pickup,
      dropoff: quote.dropoff,
      notes: body.notes.trim(),
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
