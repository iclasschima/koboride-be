import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseBody, readJson } from "@/lib/validate";
import { createMerchantOrder, shopLive } from "@/lib/merchants";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const slug = ctx.params?.slug;
  if (!slug) throw new AppError("Missing shop", "VALIDATION_ERROR", 400);
  const user = requireUser(req, ["customer"]);
  const merchant = await prisma.merchant.findUnique({ where: { slug } });
  if (!merchant || !shopLive(merchant)) {
    throw new AppError("This shop is not available", "NOT_FOUND", 404);
  }
  const body = parseBody(
    z.object({
      dropoff: z.string().min(3).max(240),
      dropoffLat: z.number().finite(),
      dropoffLng: z.number().finite(),
      receiverName: z.string().min(2).max(80),
      receiverPhone: z.string().min(7).max(20),
      notes: z.string().max(400).optional(),
      items: z
        .array(z.object({ itemId: z.string().min(1), qty: z.number().int().min(1).max(99) }))
        .min(1)
        .max(30),
    }),
    await readJson(req),
  );
  const customer = await prisma.customer.findUnique({ where: { id: user.sub } });
  if (!customer) throw new AppError("Customer not found", "NOT_FOUND", 404);
  const order = await createMerchantOrder({
    merchant,
    dropoff: body.dropoff,
    dropoffLat: body.dropoffLat,
    dropoffLng: body.dropoffLng,
    receiverName: body.receiverName,
    receiverPhone: body.receiverPhone,
    notes: body.notes,
    items: body.items,
    farePayer: merchant.deliveryPayer,
    holdUntilReady: true,
    customerId: customer.id,
  });
  return json({ order: { id: order.id } }, 201);
});
