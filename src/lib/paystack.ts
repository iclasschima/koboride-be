import { randomBytes } from "node:crypto";
import { config } from "@/lib/config";
import { AppError } from "@/lib/errors";

const BASE = "https://api.paystack.co";

type PaystackEnvelope<T> = {
  status: boolean;
  message?: string;
  data?: T;
};

function secretKey(): string {
  const key = config.paystackSecretKey.trim();
  if (!key) {
    throw new AppError("Card payment is not available right now", "PAYSTACK_NOT_CONFIGURED", 503);
  }
  return key;
}

export function paystackPublicKey(): string {
  return config.paystackPublicKey.trim();
}

export function paystackConfigured(): boolean {
  return Boolean(config.paystackSecretKey.trim() && config.paystackPublicKey.trim());
}

export function paystackEmail(phone: string): string {
  const digits = phone.replace(/\D/g, "").slice(-10) || "guest";
  return `pay.${digits}@koboride.ng`;
}

export function newPaystackReference(): string {
  return `kobo_${randomBytes(12).toString("hex")}`;
}

export function nairaToKobo(naira: number): number {
  return Math.round(naira) * 100;
}

async function paystack<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as PaystackEnvelope<T>;
  if (!res.ok || !body.status || body.data == null) {
    throw new AppError(body.message || "Paystack request failed", "PAYSTACK_ERROR", 502);
  }
  return body.data;
}

export async function initializePaystack(input: {
  email: string;
  amountKobo: number;
  reference: string;
  metadata?: Record<string, unknown>;
}): Promise<{ accessCode: string; authorizationUrl: string; reference: string }> {
  const data = await paystack<{
    access_code: string;
    authorization_url: string;
    reference: string;
  }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      amount: input.amountKobo,
      reference: input.reference,
      currency: "NGN",
      metadata: input.metadata,
    }),
  });
  return {
    accessCode: data.access_code,
    authorizationUrl: data.authorization_url,
    reference: data.reference,
  };
}

export async function verifyPaystack(reference: string): Promise<{
  amountKobo: number;
  status: string;
}> {
  const data = await paystack<{ amount: number; status: string }>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
  return { amountKobo: data.amount, status: data.status };
}

export async function refundPaystack(
  reference: string,
  amountKobo?: number,
): Promise<{ id: string; status: string }> {
  const body: { transaction: string; amount?: number } = { transaction: reference };
  if (amountKobo != null && amountKobo > 0) body.amount = amountKobo;
  const data = await paystack<{ id?: number | string; status?: string }>("/refund", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { id: String(data.id ?? reference), status: data.status ?? "pending" };
}
