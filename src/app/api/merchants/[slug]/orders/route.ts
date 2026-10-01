import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { customerSession, shopCheckoutCustomer } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseBody, readJson } from "@/lib/validate";
import { createMerchantOrder, shopLive, shopOrderSchema } from "@/lib/merchants";
import { assertServiceOpen } from "@/lib/settings";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const slug = ctx.params?.slug;
  if (!slug) throw new AppError("Missing shop", "VALIDATION_ERROR", 400);
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
    throw new AppError("Pay online to order from this shop", "CARD_REQUIRED", 400);
  }
  if (!body.paystackReference) await assertServiceOpen();
  const { customer, signedIn } = await shopCheckoutCustomer(req, body, merchant.id);
  const earlierOrders = await prisma.order.count({ where: { customerId: customer.id } });
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
  // Without a code, only an account with nothing in it yet is safe to hand over.
  const session = await customerSession(customer);
  const empty = earlierOrders === 0 && !session.user.isRider && !session.user.isMerchant && !session.user.isAgent;
  return json({ order: { id: order.id }, session: signedIn || empty ? session : null }, 201);
});
