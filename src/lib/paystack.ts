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

/**
 * Transfer reference rules from Paystack's Initiate Transfer docs:
 * unique, lowercase, only letters, numbers, "-" and "_".
 * Amounts are kobo. source is only "balance".
 * If the dashboard still requires OTP, status comes back "otp" and the
 * transfer is finished with POST /transfer/finalize_transfer. Disable OTP
 * for API transfers only together with Paystack's IP allowlist. The secret
 * key stays on the server and is never logged.
 */
export type PaystackTransfer = {
  status: string;
  transferCode: string | null;
  reference: string | null;
  amount: number;
};

export class PaystackAmbiguousError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaystackAmbiguousError";
  }
}

type PaystackResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

async function paystackRaw<T>(path: string, init?: RequestInit): Promise<PaystackResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secretKey()}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    throw new PaystackAmbiguousError(err instanceof Error ? err.message : "Paystack network error");
  }
  const body = (await res.json().catch(() => ({}))) as PaystackEnvelope<T>;
  if (res.status >= 500) {
    throw new PaystackAmbiguousError(body.message || "Paystack unavailable");
  }
  if (res.status === 429) {
    throw new PaystackAmbiguousError(body.message || "Paystack rate limit");
  }
  if (!res.ok || !body.status || body.data == null) {
    return { ok: false, status: res.status, message: body.message || "Paystack request failed" };
  }
  return { ok: true, data: body.data };
}

export async function listPaystackBanks(): Promise<Array<{ name: string; code: string }>> {
  const data = await paystack<Array<{ name: string; code: string; currency?: string }>>(
    "/bank?currency=NGN",
  );
  return data
    .filter((bank) => bank.name && bank.code)
    .map((bank) => ({ name: bank.name, code: bank.code }));
}

export async function resolvePaystackAccount(
  accountNumber: string,
  bankCode: string,
): Promise<{ accountNumber: string; accountName: string }> {
  const params = new URLSearchParams({ account_number: accountNumber, bank_code: bankCode });
  const data = await paystack<{ account_number: string; account_name: string }>(
    `/bank/resolve?${params.toString()}`,
  );
  return { accountNumber: data.account_number, accountName: data.account_name };
}

export async function createPaystackRecipient(input: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): Promise<string> {
  const data = await paystack<{ recipient_code: string }>("/transferrecipient", {
    method: "POST",
    body: JSON.stringify({
      type: "nuban",
      name: input.name,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: "NGN",
    }),
  });
  return data.recipient_code;
}

export async function paystackBalanceKobo(): Promise<number> {
  const data = await paystack<Array<{ currency: string; balance: number }>>("/balance");
  const ngn = data.find((row) => row.currency === "NGN");
  return Math.trunc(ngn?.balance ?? 0);
}

export async function pendingSettlementKobo(): Promise<number> {
  const data = await paystack<Array<{ currency?: string; status?: string; effective_amount?: number }>>(
    "/settlement?status=pending&perPage=50",
  );
  return data.reduce((sum, row) => {
    if (row.currency && row.currency !== "NGN") return sum;
    return sum + Math.trunc(row.effective_amount ?? 0);
  }, 0);
}

function asTransfer(data: {
  status?: string;
  transfer_code?: string;
  reference?: string;
  amount?: number;
}): PaystackTransfer {
  return {
    status: data.status ?? "pending",
    transferCode: data.transfer_code ?? null,
    reference: data.reference ?? null,
    amount: Math.trunc(data.amount ?? 0),
  };
}

export async function initiatePaystackTransfer(input: {
  amountKobo: number;
  recipient: string;
  reference: string;
  reason: string;
}): Promise<PaystackTransfer> {
  const result = await paystackRaw<{
    status?: string;
    transfer_code?: string;
    reference?: string;
    amount?: number;
  }>("/transfer", {
    method: "POST",
    body: JSON.stringify({
      source: "balance",
      amount: input.amountKobo,
      recipient: input.recipient,
      reference: input.reference,
      reason: input.reason,
      currency: "NGN",
    }),
  });
  if (!result.ok) {
    throw new AppError(result.message, "PAYSTACK_TRANSFER_FAILED", result.status === 400 ? 409 : 502);
  }
  return asTransfer(result.data);
}

export async function verifyPaystackTransfer(reference: string): Promise<PaystackTransfer | null> {
  const result = await paystackRaw<{
    status?: string;
    transfer_code?: string;
    reference?: string;
    amount?: number;
  }>(`/transfer/verify/${encodeURIComponent(reference)}`);
  if (!result.ok) return null;
  return asTransfer(result.data);
}

export async function finalizePaystackTransfer(transferCode: string, otp: string): Promise<PaystackTransfer> {
  const data = await paystack<{
    status?: string;
    transfer_code?: string;
    reference?: string;
    amount?: number;
  }>("/transfer/finalize_transfer", {
    method: "POST",
    body: JSON.stringify({ transfer_code: transferCode, otp }),
  });
  return asTransfer(data);
}

export async function listSuccessfulChargesKobo(from: string, to: string): Promise<number> {
  let page = 1;
  let total = 0;
  for (let guard = 0; guard < 20; guard += 1) {
    const params = new URLSearchParams({
      status: "success",
      from,
      to,
      perPage: "50",
      page: String(page),
    });
    const res = await fetch(`${BASE}/transaction?${params.toString()}`, {
      headers: { Authorization: `Bearer ${secretKey()}` },
    });
    const body = (await res.json().catch(() => ({}))) as PaystackEnvelope<Array<{ amount?: number }>> & {
      meta?: { pageCount?: number };
    };
    if (!res.ok || !body.status || !body.data) break;
    total += body.data.reduce((sum, row) => sum + Math.trunc(row.amount ?? 0), 0);
    const pages = body.meta?.pageCount ?? 1;
    if (page >= pages) break;
    page += 1;
  }
  return total;
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
