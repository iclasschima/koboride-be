import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { requireRider } from "@/lib/auth";
import { parseBody, readJson } from "@/lib/validate";
import {
  assertRiderReleaseAllowed,
  generateDeliveryPin,
  getOrderOrThrow,
  normalizeReleaseReason,
  orderInclude,
} from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import {
  notifyAdminJobReleased,
  notifyCustomerJobReleased,
  notifySearchingRider,
} from "@/lib/push";

export const OPTIONS = () => options();

/** The rider hands the job back; the order goes to the waiting list again. */
export const POST = api(async (req, ctx) => {
  const { rider } = await requireRider(req);
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
  if (order.riderId !== rider.id) {
    throw new AppError("You are not assigned to this order", "FORBIDDEN", 403);
  }
  assertRiderReleaseAllowed(order);
  const reason = normalizeReleaseReason(body.reason, body.note);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.orderRelease.create({
      data: {
        orderId: order.id,
        riderId: rider.id,
        phase: order.riderPhase,
        reason,
      },
    });
    return tx.order.update({
      where: { id: order.id },
      data: {
        status: "dispatching",
        riderId: null,
        riderPhase: null,
        deliveryPinRequestedAt: null,
        deliveryPinRevealedAt: null,
        // A rider who saw the code must not keep a working one after walking away.
        ...(order.deliveryPinRevealedAt ? { deliveryPin: generateDeliveryPin() } : {}),
      },
      include: orderInclude,
    });
  });
  await notifyCustomerJobReleased(updated);
  await notifySearchingRider(updated);
  await notifyAdminJobReleased(updated, rider, reason);
  return json({ released: true });
});
