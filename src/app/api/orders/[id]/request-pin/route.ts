import { api, json, options, AppError } from "@/lib/errors";
import { requireRider } from "@/lib/auth";
import { askSenderToRevealPin, textDeliveryPinToReceiver } from "@/lib/deliveryPinSms";
import { getOrderOrThrow, hasPickedUp, orderInclude, orderNeedsDeliveryPin, presentRiderTrip } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { notifyDeliveryPinRequested } from "@/lib/push";

export const OPTIONS = () => options();

/** Text the receiver. If that fails, ask the sender to reveal the code. */
export const POST = api(async (req, ctx) => {
  const { rider } = await requireRider(req);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const order = await getOrderOrThrow(id);
  if (order.riderId !== rider.id) {
    throw new AppError("You are not assigned to this order", "FORBIDDEN", 403);
  }
  if (order.status !== "in_progress") {
    throw new AppError("This job is not in progress", "INVALID_STATUS", 409);
  }
  if (!orderNeedsDeliveryPin(order)) {
    throw new AppError("This order does not use a delivery PIN", "INVALID_STATUS", 409);
  }
  if (!hasPickedUp(order)) {
    throw new AppError(
      "Ask for the code when you are heading to drop-off",
      "INVALID_STATUS",
      409,
    );
  }

  if (order.deliveryPinRevealedAt) {
    return json({ trip: presentRiderTrip(order) });
  }

  try {
    const before = order.deliveryPinSentAt?.getTime() ?? 0;
    const texted = await textDeliveryPinToReceiver(order, { resend: true });
    const sent = (texted.deliveryPinSentAt?.getTime() ?? 0) !== before;
    if (!sent) {
      return json({ trip: presentRiderTrip(texted) });
    }
    const updated = await prisma.order.update({
      where: { id: texted.id },
      data: { deliveryPinRequestedAt: new Date() },
      include: orderInclude,
    });
    await notifyDeliveryPinRequested(updated, { smsSent: true });
    return json({ trip: presentRiderTrip(updated) });
  } catch (err) {
    const fallback =
      err instanceof AppError &&
      (err.code.startsWith("SMS") || err.code === "INVALID_PHONE");
    if (!fallback) throw err;
    const updated = await askSenderToRevealPin(order);
    return json({ trip: presentRiderTrip(updated) });
  }
});
