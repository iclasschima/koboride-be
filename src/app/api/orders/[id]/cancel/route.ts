import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { parseBody, readJson } from "@/lib/validate";
import {
  assertCustomerCancelAllowed,
  assertCustomerOwns,
  cancelOrder,
  getOrderOrThrow,
  normalizeCancelReason,
  presentTrip,
} from "@/lib/orders";
import { maybeRetentionOffer } from "@/lib/dispatch";

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
  const updated = await cancelOrder(order, {
    reason: cancelReason,
    event: "cancelled",
    eventData: { reason: cancelReason },
  });
  if (!updated) {
    throw new AppError("You can only cancel before the rider picks up the package", "ALREADY_PICKED_UP", 409);
  }
  return json({ trip: presentTrip(updated) });
});
