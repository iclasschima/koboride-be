import { config } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { maskPhone } from "@/lib/phone";

/** Approved Termii DND copy. The code is the only part we fill in. */
export function otpSmsText(code: string): string {
  return `Your Koboride verification code is ${code}. This code expires in 10 minutes. Do not share with anyone.`;
}

type TermiiBody = {
  code?: string | number;
  message?: string;
  message_id?: string;
};

function toMsisdn(phone: string): string {
  return phone.replace(/^\+/, "");
}

export async function sendOtpSms(phone: string, code: string): Promise<void> {
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
      sms: otpSmsText(code),
      type: "plain",
      channel: "dnd",
    }),
  });

  const data = ((await res.json().catch(() => ({}))) as TermiiBody) ?? {};
  const sent = res.ok && (data.code === "ok" || data.message === "Successfully Sent");
  if (sent) return;

  console.error(`[sms] Termii send failed for ${maskPhone(phone)}`, data.message ?? res.status);
  throw new AppError("Could not send SMS code. Try again.", "SMS_SEND_FAILED", 502);
}
