import { config } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { maskPhone } from "@/lib/phone";

const PIN_LENGTH = 5;
const PIN_TTL_MIN = 6;

type SendchampBody = {
  code?: number;
  status?: string;
  message?: string;
  errors?: unknown;
  data?: {
    reference?: string;
    status?: string;
  } | null;
};

function toMsisdn(phone: string): string {
  return phone.replace(/^\+/, "");
}

function sendchampMessage(data: SendchampBody): string | undefined {
  const raw =
    (typeof data.message === "string" && data.message.trim()) ||
    (typeof data.errors === "string" && data.errors.trim()) ||
    "";
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower.includes("token is invalid") || lower.includes("authorization")) {
    return "SMS provider rejected the API key.";
  }
  return raw;
}

async function sendchamp(path: string, body: Record<string, unknown>): Promise<SendchampBody> {
  const res = await fetch(`${config.sendchampBaseUrl}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json,text/plain,*/*",
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.sendchampPublicKey}`,
    },
    body: JSON.stringify(body),
  });
  return ((await res.json().catch(() => ({}))) as SendchampBody) ?? {};
}

export async function sendOtpSms(phone: string): Promise<string> {
  const data = await sendchamp("/verification/create", {
    channel: "sms",
    sender: config.sendchampSender,
    token_type: "numeric",
    token_length: PIN_LENGTH,
    expiration_time: PIN_TTL_MIN,
    customer_mobile_number: toMsisdn(phone),
    customer_email_address: "",
    meta_data: { description: "demo" },
    in_app_token: false,
  });

  const reference = data.data?.reference;
  if (data.status === "success" && reference) return reference;

  console.error(`[sms] Sendchamp send failed for ${maskPhone(phone)}`, data.message ?? data);
  throw new AppError(
    sendchampMessage(data) || "Could not send SMS code. Try again.",
    "SMS_SEND_FAILED",
    502,
  );
}

export async function verifyOtpSms(reference: string, code: string): Promise<void> {
  const data = await sendchamp("/verification/confirm", {
    verification_reference: reference,
    verification_code: code,
  });

  if (data.status === "success" && (data.code === 200 || data.code === undefined)) return;

  const msg = (data.message ?? "").toLowerCase();
  if (msg.includes("invalid") || msg.includes("incorrect") || msg.includes("wrong")) {
    throw new AppError("Incorrect code", "OTP_INVALID", 400);
  }
  if (msg.includes("expired")) {
    throw new AppError("That code has expired. Request a new one.", "OTP_EXPIRED", 400);
  }
  if (msg.includes("not found") || msg.includes("reference")) {
    throw new AppError("Request a new code first", "OTP_NOT_FOUND", 400);
  }

  console.error("[sms] Sendchamp verify failed", data.message ?? data);
  throw new AppError(
    sendchampMessage(data) || "Could not verify that code. Try again.",
    "OTP_VERIFY_FAILED",
    502,
  );
}
