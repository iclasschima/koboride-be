import { createHmac, timingSafeEqual } from "node:crypto";
import { json } from "@/lib/errors";
import { config } from "@/lib/config";
import { handleTransferWebhook } from "@/lib/payoutRun";
import { handleShopTransferWebhook, SHOP_PAYOUT_PREFIX } from "@/lib/shopPayouts";

export const dynamic = "force-dynamic";

function signaturesMatch(rawBody: string, header: string | null): boolean {
  const secret = config.paystackSecretKey.trim();
  if (!secret || !header) return false;
  const digest = createHmac("sha512", secret).update(rawBody).digest("hex");
  const left = Buffer.from(digest);
  const right = Buffer.from(header);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Paystack signs the raw body with HMAC SHA512 in x-paystack-signature. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!signaturesMatch(raw, req.headers.get("x-paystack-signature"))) {
    return json({ error: "Invalid signature", code: "INVALID_SIGNATURE" }, 401);
  }
  let body: { event?: string; data?: { reference?: string; reason?: string; failures?: unknown } };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json({ error: "Invalid JSON", code: "INVALID_JSON" }, 400);
  }
  const event = body.event;
  const reference = body.data?.reference;
  if (
    reference &&
    (event === "transfer.success" || event === "transfer.failed" || event === "transfer.reversed")
  ) {
    const reason =
      typeof body.data?.reason === "string"
        ? body.data.reason
        : event === "transfer.failed"
          ? "transfer.failed"
          : event;
    if (reference.startsWith(SHOP_PAYOUT_PREFIX)) await handleShopTransferWebhook(event, reference, reason);
    else await handleTransferWebhook(event, reference, reason);
  }
  return json({ received: true });
}
