import { config } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { maskPhone, normalizePhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { notifyDeliveryPinRequested } from "@/lib/push";
import { sendDeliveryPinSms } from "@/lib/sms";
import { type OrderRow, orderInclude, orderNeedsDeliveryPin } from "@/lib/orders";

export const PIN_SMS_COOLDOWN_MS = 30_000;

export async function textDeliveryPinToReceiver(
  order: OrderRow,
  opts?: { resend?: boolean },
): Promise<OrderRow> {
  if (!orderNeedsDeliveryPin(order)) {
    throw new AppError("This order does not use a delivery PIN", "INVALID_STATUS", 409);
  }

  const raw = order.receiverPhone.trim();
  if (!raw) {
    throw new AppError("Add the receiver’s phone number to text the PIN", "INVALID_PHONE", 400);
  }

  let phone: string;
  try {
    phone = normalizePhone(raw);
  } catch {
    throw new AppError("The receiver’s phone number is not valid", "INVALID_PHONE", 400);
  }

  if (order.deliveryPinSentAt) {
    const recent = Date.now() - order.deliveryPinSentAt.getTime() < PIN_SMS_COOLDOWN_MS;
    if (!opts?.resend || recent) return order;
  }

  if (!config.termiiApiKey) {
    if (!config.isProd) {
      console.info(`[sms] Termii not configured — delivery PIN not texted to ${maskPhone(phone)}`);
    }
    throw new AppError(
      config.isProd ? "SMS is not configured. Set TERMII_API_KEY." : "SMS is not configured.",
      "SMS_NOT_CONFIGURED",
      503,
    );
  }

  await sendDeliveryPinSms(phone, order.deliveryPin);
  return prisma.order.update({
    where: { id: order.id },
    data: { deliveryPinSentAt: new Date() },
    include: orderInclude,
  });
}

/** SMS did not go out, so ask the sender to share the code with the rider. */
export async function askSenderToRevealPin(order: OrderRow): Promise<OrderRow> {
  if (order.deliveryPinSentAt || order.deliveryPinRevealedAt) return order;
  const last = order.deliveryPinRequestedAt?.getTime() ?? 0;
  if (order.deliveryPinRequestedAt && Date.now() - last < PIN_SMS_COOLDOWN_MS) {
    return order;
  }
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { deliveryPinRequestedAt: new Date() },
    include: orderInclude,
  });
  await notifyDeliveryPinRequested(updated, { smsSent: false });
  return updated;
}
