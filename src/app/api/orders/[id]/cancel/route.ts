import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { parseBody, readJson } from "@/lib/validate";
import {
  assertCustomerCancelAllowed,
  assertCustomerOwns,
  getOrderOrThrow,
  normalizeCancelReason,
  orderInclude,
  presentTrip,
  refundIfPaidOnline,
} from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { maybeRetentionOffer, writeOrderEvent } from "@/lib/dispatch";
import {
  notifyAdminOrderStatus,
  notifyCustomerPaymentRefunded,
  notifyRiderOrderCancelled,
} from "@/lib/push";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const user = requireUser(req, ["customer"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const body = parseBody(
    z.object({
      reason: z.string().min(1),
      note: z.string().max(160).optional(),
    }),
    await readJson(req),
  );

  const order = await getOrderOrThrow(id);
  assertCustomerOwns(order, user.sub);
  assertCustomerCancelAllowed(order);

  const offer = await maybeRetentionOffer(order);
  if (offer) {
    const latest = await getOrderOrThrow(id);
    return json({
      offerAvailable: true,
      discountAmount: offer.discountAmount,
      trip: presentTrip(latest),
    });
  }

  const cancelReason = normalizeCancelReason(body.reason, body.note);
  const refund = await refundIfPaidOnline(order);

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: "cancelled", cancelReason, ...refund },
    include: orderInclude,
  });
  await writeOrderEvent(order.id, "cancelled", {
    reason: cancelReason,
    refunded: refund.paymentStatus === "refunded",
  });
  await notifyAdminOrderStatus(updated);
  if (updated.riderId) await notifyRiderOrderCancelled(updated);
  if (refund.paymentStatus === "refunded") {
    await notifyCustomerPaymentRefunded(updated);
  }
  return json({ trip: presentTrip(updated) });
});
