import { config } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { maskPhone } from "@/lib/phone";

/** Approved Termii DND copy. The code is the only part we fill in. */
export function otpSmsText(code: string): string {
  return `Your Koboride verification code is ${code}. This code expires in 10 minutes. Do not share with anyone.`;
}

export function deliveryPinSmsText(pin: string): string {
  return `Dear Customer, your KoboRide package PIN is ${pin}. Please share this code with the rider to receive your package. Powered by KoboRide.`;
}

type TermiiBody = {
  code?: string | number;
  message?: string;
  message_id?: string;
};

function toMsisdn(phone: string): string {
  return phone.replace(/^\+/, "");
}

async function sendTermiiSms(phone: string, sms: string, failMessage: string): Promise<void> {
  const res = await fetch(`${config.termiiBaseUrl}/api/sms/send`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: config.termiiApiKey,
      to: toMsisdn(phone),
      from: "OE Alert",
      sms,
      type: "plain",
      channel: "dnd",
    }),
  });

  const data = ((await res.json().catch(() => ({}))) as TermiiBody) ?? {};
  const sent = res.ok && (data.code === "ok" || data.message === "Successfully Sent");
  if (sent) return;

  console.error(`[sms] Termii send failed for ${maskPhone(phone)}`, data.message ?? res.status);
  throw new AppError(failMessage, "SMS_SEND_FAILED", 502);
}

export async function sendOtpSms(phone: string, code: string): Promise<void> {
  await sendTermiiSms(phone, otpSmsText(code), "Could not send SMS code. Try again.");
}

export async function sendDeliveryPinSms(phone: string, pin: string): Promise<void> {
  await sendTermiiSms(
    phone,
    deliveryPinSmsText(pin),
    "Could not text the delivery PIN. Try again.",
  );
}
