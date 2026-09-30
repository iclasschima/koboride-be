import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { requireCustomer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseBody, readJson } from "@/lib/validate";
import { createMerchantOrder, shopLive, shopOrderSchema } from "@/lib/merchants";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const slug = ctx.params?.slug;
  if (!slug) throw new AppError("Missing shop", "VALIDATION_ERROR", 400);
  const customer = await requireCustomer(req);
  const merchant = await prisma.merchant.findUnique({ where: { slug } });
  if (!merchant || !shopLive(merchant)) {
    throw new AppError("This shop is not available", "NOT_FOUND", 404);
  }
  const body = parseBody(
    shopOrderSchema.extend({
      paymentMethod: z.enum(["cash", "paystack"]).optional(),
      paystackReference: z.string().min(8).max(80).optional(),
    }),
    await readJson(req),
  );
  if (body.paymentMethod !== "paystack") {
    throw new AppError("Pay by card to order from this shop", "CARD_REQUIRED", 400);
  }
  const order = await createMerchantOrder({
    merchant,
    dropoff: body.dropoff,
    dropoffLat: body.dropoffLat,
    dropoffLng: body.dropoffLng,
    receiverName: body.receiverName,
    receiverPhone: body.receiverPhone,
    notes: body.notes,
    noteFor: body.noteFor,
    items: body.items,
    farePayer: "receiver",
    holdUntilReady: true,
    customerId: customer.id,
    paymentMethod: "paystack",
    paystackReference: body.paystackReference,
  });
  return json({ order: { id: order.id } }, 201);
});
