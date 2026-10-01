import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import { parseBody, readJson } from "@/lib/validate";
import { paymentFlags, setPaymentFlag } from "@/lib/payoutFlags";
import { runPayouts, retryPayout } from "@/lib/payoutRun";
import { replaceRiderBank } from "@/lib/bankVerify";
import { finalizePaystackTransfer } from "@/lib/paystack";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  await requireAdmin(req, "payouts");
  const [runs, config, flags, reconciliation] = await Promise.all([
    prisma.payoutRun.findMany({ orderBy: { runDate: "desc" }, take: 30, include: { payouts: true } }),
    prisma.payoutConfig.findUnique({ where: { id: "default" } }),
    paymentFlags(),
    prisma.reconciliationRun.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return json({ runs, config, flags, reconciliation });
});

const configSchema = z.object({
  cutoffHourLagos: z.number().int().min(0).max(23),
  runHourLagos: z.number().int().min(0).max(23),
  minPayout: z.number().int().min(0).max(50_000_000),
  recoveryCapRatio: z.number().gt(0).lte(1),
  maxAttempts: z.number().int().min(1).max(10),
  cashDebtBlockLimit: z.number().int().min(0).max(50_000_000),
  onlinePaymentsEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
});

export const PATCH = api(async (req) => {
  await requireAdmin(req, "payouts");
  const body = parseBody(configSchema, await readJson(req));
  const [config] = await Promise.all([
    prisma.payoutConfig.upsert({
      where: { id: "default" },
      update: {
        cutoffHourLagos: body.cutoffHourLagos,
        runHourLagos: body.runHourLagos,
        minPayout: body.minPayout,
        recoveryCapRatio: body.recoveryCapRatio,
        maxAttempts: body.maxAttempts,
        cashDebtBlockLimit: body.cashDebtBlockLimit,
      },
      create: {
        id: "default",
        cutoffHourLagos: body.cutoffHourLagos,
        runHourLagos: body.runHourLagos,
        minPayout: body.minPayout,
        recoveryCapRatio: body.recoveryCapRatio,
        maxAttempts: body.maxAttempts,
        cashDebtBlockLimit: body.cashDebtBlockLimit,
      },
    }),
    setPaymentFlag("onlinePaymentsEnabled", body.onlinePaymentsEnabled),
    setPaymentFlag("payoutsEnabled", body.payoutsEnabled),
  ]);
  return json({ config, flags: await paymentFlags() });
});

export const POST = api(async (req) => {
  const admin = await requireAdmin(req, "payouts");
  const body = parseBody(
    z.object({
      action: z.enum(["dry-run", "run", "retry", "finalize-otp", "adjust", "replace-bank"]),
      payoutId: z.string().optional(),
      otp: z.string().trim().min(4).max(10).optional(),
      riderId: z.string().optional(),
      amount: z.number().int().optional(),
      note: z.string().trim().min(3).max(300).optional(),
      bankCode: z.string().trim().min(2).max(10).optional(),
      bankName: z.string().trim().min(2).max(80).optional(),
      accountNumber: z.string().optional(),
    }),
    await readJson(req),
  );
  if (body.action === "dry-run") {
    const result = await runPayouts(new Date(), { dryRun: true });
    return json(result);
  }
  if (body.action === "run") {
    const result = await runPayouts(new Date());
    return json(result);
  }
  if (body.action === "retry") {
    if (!body.payoutId) throw new AppError("Missing payout", "VALIDATION_ERROR", 400);
    await retryPayout(body.payoutId);
    return json({ ok: true });
  }
  if (body.action === "finalize-otp") {
    if (!body.payoutId || !body.otp) throw new AppError("OTP is required", "VALIDATION_ERROR", 400);
    const payout = await prisma.payout.findUnique({ where: { id: body.payoutId } });
    if (!payout?.paystackTransferCode) throw new AppError("No transfer is waiting", "NOT_FOUND", 404);
    const transfer = await finalizePaystackTransfer(payout.paystackTransferCode, body.otp);
    return json({ status: transfer.status });
  }
  if (body.action === "adjust") {
    if (!body.riderId || body.amount == null || body.amount === 0 || !body.note) {
      throw new AppError("Rider, amount, and a note are required", "VALIDATION_ERROR", 400);
    }
    await prisma.ledgerEntry.create({
      data: {
        riderId: body.riderId,
        type: "ADJUSTMENT",
        amount: body.amount,
        idempotencyKey: `adjust:${body.riderId}:${Date.now()}`,
        note: body.note,
        createdBy: admin.sub,
      },
    });
    return json({ ok: true });
  }
  if (!body.riderId || !body.bankCode || !body.bankName || !body.accountNumber || !body.note) {
    throw new AppError("Bank change needs a code, account, and note", "VALIDATION_ERROR", 400);
  }
  await replaceRiderBank({
    riderId: body.riderId,
    adminId: admin.sub,
    bankCode: body.bankCode,
    bankName: body.bankName,
    accountNumber: body.accountNumber,
    note: body.note,
  });
  return json({ ok: true });
});
