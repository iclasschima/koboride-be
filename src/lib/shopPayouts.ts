import { randomBytes } from "node:crypto";
import type { Admin, Prisma, ShopPayout } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { decryptField } from "@/lib/fieldCrypto";
import { shopBalance, shopPayoutNgn } from "@/lib/shopMoney";
import { sendPushToAdmins } from "@/lib/push";
import {
  createPaystackRecipient,
  finalizePaystackTransfer,
  initiatePaystackTransfer,
  nairaToKobo,
  PaystackAmbiguousError,
  paystackConfigured,
  verifyPaystackTransfer,
} from "@/lib/paystack";

/** Shop transfer references start with this, so the webhook can tell them from rider payouts. */
export const SHOP_PAYOUT_PREFIX = "kbshop_";

/** Delivered card orders: KoboRide holds their item money until it is sent to the shop. */
export const OWED_WHERE = {
  paymentMethod: "paystack",
  paymentStatus: "paid",
  status: "completed",
} as const;

/** Payouts that count against what the shop is owed. Failed and reversed transfers do not. */
const COUNTED_STATUSES = ["PROCESSING", "SUCCESS", "MANUAL"];
const MIN_PAYOUT_NGN = 100;

const OTP_NOTE = "Paystack sent an OTP to confirm this transfer. Enter it here to send the money.";

type Db = Prisma.TransactionClient | typeof prisma;

/** The shop's balance from its delivered card orders and counted payouts. See `shopBalance`. */
export async function shopLedger(merchantId: string, db: Db = prisma) {
  const [orders, payouts] = await Promise.all([
    db.order.findMany({
      where: { merchantId, ...OWED_WHERE },
      select: { id: true, goodsNgn: true, feeNgn: true, farePayer: true, shopPaidOutAt: true },
      orderBy: [{ completedAt: "asc" }, { createdAt: "asc" }],
    }),
    db.shopPayout.findMany({
      where: { merchantId, status: { in: COUNTED_STATUSES } },
      select: { amountNgn: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return shopBalance(
    orders.map((order) => ({ id: order.id, amountNgn: shopPayoutNgn(order), markedPaidAt: order.shopPaidOutAt })),
    payouts,
  );
}

export async function shopSettlement(merchantId: string) {
  const { owedNgn, owedOrders, paidOutNgn } = await shopLedger(merchantId);
  return { owedNgn, owedOrders, paidOutNgn };
}

/** Records a payout after checking it fits what is owed. One payout per shop at a time. */
async function recordPayout(
  admin: Admin,
  merchantId: string,
  amountNgn: number,
  status: "PROCESSING" | "MANUAL",
  reference: string,
): Promise<ShopPayout> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shop-payout:${merchantId}`}))`;
    const { owedNgn } = await shopLedger(merchantId, tx);
    if (owedNgn <= 0) throw new AppError("Nothing is owed to this shop", "NOTHING_OWED", 409);
    if (amountNgn < MIN_PAYOUT_NGN) {
      throw new AppError(`Send at least ₦${MIN_PAYOUT_NGN}`, "VALIDATION_ERROR", 400);
    }
    if (amountNgn > owedNgn) {
      throw new AppError(
        `The shop is owed ₦${owedNgn.toLocaleString("en-NG")}. Send that or less.`,
        "AMOUNT_TOO_HIGH",
        409,
      );
    }
    return tx.shopPayout.create({ data: { merchantId, amountNgn, reference, status, adminId: admin.id } });
  });
}

/** For money an admin sent outside Paystack transfers. */
export async function markShopPaidOut(admin: Admin, merchantId: string, amountNgn: number): Promise<void> {
  await recordPayout(admin, merchantId, amountNgn, "MANUAL", `kbmanual_${randomBytes(10).toString("hex")}`);
}

async function shopRecipient(merchantId: string): Promise<{ code: string; shopName: string }> {
  const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
  if (merchant.paystackRecipientCode) return { code: merchant.paystackRecipientCode, shopName: merchant.name };
  const accountNumber = decryptField(merchant.bankAccountNo);
  if (!merchant.bankCode || !accountNumber) {
    throw new AppError("Add the shop's bank account first.", "BANK_REQUIRED", 409);
  }
  const code = await createPaystackRecipient({
    name: merchant.bankAccountName || merchant.name,
    accountNumber,
    bankCode: merchant.bankCode,
  });
  await prisma.merchant.updateMany({
    where: { id: merchantId, bankAccountNo: merchant.bankAccountNo },
    data: { paystackRecipientCode: code },
  });
  return { code, shopName: merchant.name };
}

/** Sends `amountNgn` from KoboRide's Paystack balance. It counts as paid while in flight and stops counting if it fails. */
export async function sendShopPayout(admin: Admin, merchantId: string, amountNgn: number): Promise<ShopPayout> {
  if (!paystackConfigured()) {
    throw new AppError("Paystack is not set up", "PAYSTACK_NOT_CONFIGURED", 503);
  }
  const recipient = await shopRecipient(merchantId);
  const reference = `${SHOP_PAYOUT_PREFIX}${randomBytes(10).toString("hex")}`;
  const payout = await recordPayout(admin, merchantId, amountNgn, "PROCESSING", reference);

  let transfer: { status: string; transferCode: string | null };
  try {
    transfer = await initiatePaystackTransfer({
      amountKobo: nairaToKobo(payout.amountNgn),
      recipient: recipient.code,
      reference,
      reason: `KoboRide payout to ${recipient.shopName}`.slice(0, 100),
    });
  } catch (err) {
    if (!(err instanceof PaystackAmbiguousError)) {
      await failShopPayout(payout.id, err instanceof Error ? err.message : "Transfer failed", "FAILED");
      throw err;
    }
    const known = await verifyPaystackTransfer(reference).catch(() => null);
    if (!known) {
      return prisma.shopPayout.update({
        where: { id: payout.id },
        data: { failureReason: "Paystack has not confirmed this transfer yet. It updates when Paystack reports back." },
      });
    }
    transfer = known;
  }
  await applyShopTransfer(payout.id, transfer.status, transfer.transferCode);
  return prisma.shopPayout.findUniqueOrThrow({ where: { id: payout.id } });
}

async function applyShopTransfer(payoutId: string, status: string, transferCode: string | null) {
  if (status === "failed" || status === "reversed") {
    await failShopPayout(payoutId, `Paystack: ${status}`, status === "reversed" ? "REVERSED" : "FAILED");
    return;
  }
  await prisma.shopPayout.update({
    where: { id: payoutId },
    data: {
      status: status === "success" ? "SUCCESS" : "PROCESSING",
      paystackTransferCode: transferCode,
      failureReason: status === "otp" ? OTP_NOTE : null,
    },
  });
  if (status === "otp") {
    await sendPushToAdmins({ title: "Shop payout needs OTP", body: OTP_NOTE, url: "/admin/merchants" });
  }
}

/** Confirms a transfer Paystack is holding for an OTP. */
export async function finalizeShopPayout(merchantId: string, payoutId: string, otp: string): Promise<void> {
  const payout = await prisma.shopPayout.findFirst({ where: { id: payoutId, merchantId } });
  if (!payout || !needsOtp(payout) || !payout.paystackTransferCode) {
    throw new AppError("This transfer is not waiting for an OTP", "NOT_PENDING", 409);
  }
  const transfer = await finalizePaystackTransfer(payout.paystackTransferCode, otp);
  await applyShopTransfer(payout.id, transfer.status, transfer.transferCode ?? payout.paystackTransferCode);
}

function needsOtp(payout: ShopPayout): boolean {
  return payout.status === "PROCESSING" && payout.failureReason === OTP_NOTE;
}

/** A failed or reversed transfer stops counting as paid, so the shop is owed that money again. */
async function failShopPayout(payoutId: string, reason: string, status: "FAILED" | "REVERSED") {
  const result = await prisma.shopPayout.updateMany({
    where: { id: payoutId, status: { in: ["PROCESSING", "SUCCESS"] } },
    data: { status, failureReason: reason },
  });
  if (result.count === 0) return;
  const payout = await prisma.shopPayout.findUniqueOrThrow({ where: { id: payoutId } });
  await sendPushToAdmins({
    title: "Shop payout failed",
    body: `${reason}. The shop is owed that money again.`,
    url: `/admin/merchants/${payout.merchantId}`,
  });
}

export async function handleShopTransferWebhook(
  event: "transfer.success" | "transfer.failed" | "transfer.reversed",
  reference: string,
  reason: string,
): Promise<void> {
  const payout = await prisma.shopPayout.findUnique({ where: { reference } });
  if (!payout) return;
  if (event === "transfer.success") {
    if (payout.status !== "PROCESSING") return;
    await prisma.shopPayout.update({ where: { id: payout.id }, data: { status: "SUCCESS", failureReason: null } });
    return;
  }
  await failShopPayout(payout.id, reason || event, event === "transfer.reversed" ? "REVERSED" : "FAILED");
}

export function presentShopPayout(payout: ShopPayout) {
  return {
    id: payout.id,
    amountNgn: payout.amountNgn,
    status: payout.status,
    failureReason: payout.failureReason,
    needsOtp: needsOtp(payout),
    createdAt: payout.createdAt.toISOString(),
  };
}
