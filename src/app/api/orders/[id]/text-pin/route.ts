import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { textDeliveryPinToReceiver } from "@/lib/deliveryPinSms";
import { assertCustomerOwns, getOrderOrThrow, hasPickedUp, orderNeedsDeliveryPin, presentTrip } from "@/lib/orders";

export const OPTIONS = () => options();

/** Sender texts the delivery PIN to the receiver. The rider never sees the code. */
export const POST = api(async (req, ctx) => {
  const user = requireUser(req, ["customer"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const order = await getOrderOrThrow(id);
  assertCustomerOwns(order, user.sub);

  if (order.status === "completed" || order.status === "cancelled") {
    throw new AppError("This order is no longer active", "INVALID_STATUS", 409);
  }
  if (!orderNeedsDeliveryPin(order)) {
    throw new AppError("This order does not use a delivery PIN", "INVALID_STATUS", 409);
  }
  if (!hasPickedUp(order)) {
    throw new AppError(
      "Text the code when the rider is heading to drop-off",
      "INVALID_STATUS",
      409,
    );
  }

  const updated = await textDeliveryPinToReceiver(order, { resend: true });
  return json({ trip: presentTrip(updated) });
});
