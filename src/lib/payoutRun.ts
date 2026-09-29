import { prisma } from "@/lib/prisma";
import { payoutsEnabled } from "@/lib/payoutFlags";
import {
  allocateBalance,
  applyTransferEvent,
  badAccountReason,
  lagosCutoff,
  lagosParts,
  payoutReference,
  planRiderPayout,
  type OpenEntry,
} from "@/lib/payoutMath";
import {
  initiatePaystackTransfer,
  paystackBalanceKobo,
  PaystackAmbiguousError,
  pendingSettlementKobo,
  verifyPaystackTransfer,
  listSuccessfulChargesKobo,
} from "@/lib/paystack";
import { sendPushToAdmins } from "@/lib/push";
import { writeConfirmedLedger, type CompletedOrderLedger } from "@/lib/ledger";
import { nairaToKobo } from "@/lib/paystack";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function configRow() {
  return prisma.payoutConfig.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
}

async function backfillLedger(dayStart: Date, cutoffAt: Date): Promise<void> {
  const orders = await prisma.order.findMany({
    where: {
      status: "completed",
      riderId: { not: null },
      completedAt: { gte: dayStart, lt: cutoffAt },
    },
    select: {
      id: true,
      riderId: true,
      paymentMethod: true,
      feeNgn: true,
      payoutNgn: true,
      status: true,
    },
  });
  for (const order of orders) {
    await writeConfirmedLedger(prisma, order as CompletedOrderLedger);
  }
}

export async function runPayouts(at = new Date(), opts?: { dryRun?: boolean }): Promise<{ runId: string; status: string }> {
  const config = await configRow();
  const parts = lagosParts(at);
  const live = !opts?.dryRun && (await payoutsEnabled());
  const cutoffAt = lagosCutoff(parts.date, config.cutoffHourLagos);
  await backfillLedger(lagosCutoff(parts.date, 0), cutoffAt);

  let run = await prisma.payoutRun.findUnique({ where: { runDate: parts.date } });
  if (run?.status === "COMPLETED") return { runId: run.id, status: run.status };
  if (run?.status === "DRY_RUN" && !live) return { runId: run.id, status: run.status };
  if (!run) {
    run = await prisma.payoutRun.create({
      data: { runDate: parts.date, status: live ? "RUNNING" : "DRY_RUN", cutoffAt },
    });
  } else if (!live) {
    return { runId: run.id, status: run.status };
  } else {
    run = await prisma.payoutRun.update({ where: { id: run.id }, data: { status: "RUNNING", cutoffAt } });
  }

  const open = await prisma.ledgerEntry.findMany({
    where: { payoutId: null, createdAt: { lt: cutoffAt } },
    orderBy: { createdAt: "asc" },
  });
  const byRider = new Map<string, OpenEntry[]>();
  for (const row of open) {
    const list = byRider.get(row.riderId) ?? [];
    list.push({
      id: row.id,
      type: row.type as OpenEntry["type"],
      amount: row.amount,
      createdAt: row.createdAt.toISOString(),
    });
    byRider.set(row.riderId, list);
  }

  const riders = await prisma.rider.findMany({
    where: { id: { in: Array.from(byRider.keys()) } },
    select: {
      id: true,
      name: true,
      bankVerifiedAt: true,
      bankNeedsReview: true,
      paystackRecipientCode: true,
    },
  });
  const riderById = new Map(riders.map((rider) => [rider.id, rider]));

  type Ready = {
    riderId: string;
    net: number;
    oldestAt: string;
    plan: ReturnType<typeof planRiderPayout>;
    recipient: string | null;
  };
  const ready: Ready[] = [];
  const skipped: Array<{ riderId: string; reason: string; net: number }> = [];

  for (const [riderId, entries] of Array.from(byRider.entries())) {
    const plan = planRiderPayout(entries, config);
    const rider = riderById.get(riderId);
    const oldestAt = entries.reduce((min, entry) => (entry.createdAt < min ? entry.createdAt : min), entries[0].createdAt);
    if (plan.decision === "skip") {
      skipped.push({ riderId, reason: "below_minimum", net: plan.net });
      continue;
    }
    if (!rider?.bankVerifiedAt || rider.bankNeedsReview || !rider.paystackRecipientCode) {
      skipped.push({ riderId, reason: "bank_not_verified", net: plan.net });
      continue;
    }
    ready.push({ riderId, net: plan.net, oldestAt, plan, recipient: rider.paystackRecipientCode });
  }

  if (!live) {
    const summary = {
      dryRun: true,
      wouldPay: ready.map((row) => ({ riderId: row.riderId, amount: row.net, recovered: row.plan.recovery })),
      skipped,
    };
    await prisma.payoutRun.update({
      where: { id: run.id },
      data: { status: "DRY_RUN", finishedAt: new Date(), summary },
    });
    return { runId: run.id, status: "DRY_RUN" };
  }

  let balance = 0;
  try {
    balance = await paystackBalanceKobo();
  } catch {
    balance = 0;
  }
  const processing = await prisma.payout.findMany({ where: { status: "PROCESSING", run: { runDate: parts.date } } });
  for (const payout of processing) {
    const remote = await verifyPaystackTransfer(payout.reference).catch(() => null);
    if (remote) await applyKnown(payout.id, remote.status, remote.transferCode, payout.amount);
  }

  const allocation = allocateBalance(ready, balance);
  if (allocation.shortfall > 0) {
    await sendPushToAdmins({
      title: "Payout balance short",
      body: `Short ${allocation.shortfall} kobo. Older riders are paid first.`,
      url: "/admin/payouts",
    });
  }

  let paid = 0;
  let paidAmount = 0;
  let recovered = 0;
  let failures = 0;

  for (let index = 0; index < allocation.funded.length; index += 1) {
    const row = allocation.funded[index];
    const reference = payoutReference(row.riderId, parts.date);
    const existing = await prisma.payout.findUnique({ where: { reference } });
    if (existing && (existing.status === "SUCCESS" || existing.status === "PROCESSING")) continue;
    if (existing && existing.attempts >= config.maxAttempts) continue;
    const payout = existing ?? (await createPayout(run.id, row.riderId, parts.date, row.plan));
    const result = await sendOne(payout.id, reference, row.net, row.recipient!);
    if (result === "paid") {
      paid += 1;
      paidAmount += row.net;
      recovered += row.plan.recovery;
    } else if (result === "failed") failures += 1;
    if (index % 5 === 4) await sleep(1000);
    else await sleep(200);
  }

  const status = failures > 0 || allocation.held.length > 0 ? "PARTIAL" : "COMPLETED";
  const summary = {
    paid,
    paidAmount,
    recovered,
    skipped,
    held: allocation.held.map((row) => row.riderId),
    failures,
    shortfall: allocation.shortfall,
  };
  await prisma.payoutRun.update({
    where: { id: run.id },
    data: { status, finishedAt: new Date(), summary },
  });
  await sendPushToAdmins({
    title: "Payout run finished",
    body: `${paid} riders, ${paidAmount} kobo sent, ${recovered} kobo recovered, ${failures} failed.`,
    url: "/admin/payouts",
  });
  await reconcile(parts.date, cutoffAt);
  return { runId: run.id, status };
}

async function createPayout(
  runId: string,
  riderId: string,
  runDate: string,
  plan: ReturnType<typeof planRiderPayout>,
) {
  return prisma.$transaction(async (tx) => {
    const payout = await tx.payout.create({
      data: {
        runId,
        riderId,
        grossEarnings: plan.gross,
        recovered: plan.recovery,
        amount: plan.net,
        reference: payoutReference(riderId, runDate),
        status: "PENDING",
      },
    });
    if (plan.consumeIds.length) {
      await tx.ledgerEntry.updateMany({
        where: { id: { in: plan.consumeIds }, payoutId: null },
        data: { payoutId: payout.id },
      });
    }
    if (plan.debtRemainder) {
      const source = await tx.ledgerEntry.findUnique({ where: { id: plan.debtRemainder.sourceId } });
      await tx.ledgerEntry.create({
        data: {
          riderId,
          orderId: source?.orderId,
          type: "CASH_COMMISSION",
          amount: plan.debtRemainder.amount,
          idempotencyKey: `payout:${payout.id}:debt-remainder:${plan.debtRemainder.sourceId}`,
          note: "Cash commission still owed after the recovery cap",
          createdBy: "system",
        },
      });
    }
    if (plan.recovery > 0) {
      await tx.ledgerEntry.create({
        data: {
          riderId,
          type: "RECOVERY",
          amount: plan.recovery,
          idempotencyKey: `payout:${payout.id}:recovery`,
          payoutId: payout.id,
          note: "Cash commission recovered",
          createdBy: "system",
        },
      });
    }
    await tx.ledgerEntry.create({
      data: {
        riderId,
        type: "PAYOUT",
        amount: -plan.net,
        idempotencyKey: `payout:${payout.id}:pay`,
        payoutId: payout.id,
        createdBy: "system",
      },
    });
    return payout;
  });
}

async function sendOne(
  payoutId: string,
  reference: string,
  amount: number,
  recipient: string,
): Promise<"paid" | "failed" | "pending"> {
  const current = await prisma.payout.update({
    where: { id: payoutId },
    data: { status: "PROCESSING", attempts: { increment: 1 } },
  });
  try {
    if (current.attempts > 1) {
      const existing = await verifyPaystackTransfer(reference);
      if (existing) return applyKnown(payoutId, existing.status, existing.transferCode, amount);
    }
    const transfer = await initiatePaystackTransfer({
      amountKobo: amount,
      recipient,
      reference,
      reason: "KoboRide rider payout",
    });
    return applyKnown(payoutId, transfer.status, transfer.transferCode, amount);
  } catch (err) {
    if (err instanceof PaystackAmbiguousError) {
      const existing = await verifyPaystackTransfer(reference).catch(() => null);
      if (existing) return applyKnown(payoutId, existing.status, existing.transferCode, amount);
      await prisma.payout.update({
        where: { id: payoutId },
        data: { status: "PENDING", failureReason: "Transfer status unknown. Not retried until the next run." },
      });
      return "pending";
    }
    const message = err instanceof Error ? err.message : "Transfer failed";
    await failPayout(payoutId, message, amount);
    return "failed";
  }
}

async function applyKnown(
  payoutId: string,
  paystackStatus: string,
  transferCode: string | null,
  amount: number,
): Promise<"paid" | "failed" | "pending"> {
  if (paystackStatus === "success") {
    await prisma.payout.update({
      where: { id: payoutId },
      data: { status: "SUCCESS", paystackTransferCode: transferCode, failureReason: null },
    });
    return "paid";
  }
    if (paystackStatus === "failed" || paystackStatus === "reversed") {
    await failPayout(
      payoutId,
      paystackStatus,
      amount,
      transferCode,
      paystackStatus === "reversed" ? "transfer.reversed" : "transfer.failed",
    );
    return "failed";
  }
  const reason = paystackStatus === "otp"
    ? "Paystack asked for an OTP. Finalize this transfer from the dashboard, or disable OTP and use an IP allowlist."
    : null;
  await prisma.payout.update({
    where: { id: payoutId },
    data: { status: "PROCESSING", paystackTransferCode: transferCode, failureReason: reason },
  });
  if (paystackStatus === "otp") {
    await sendPushToAdmins({
      title: "Payout needs OTP",
      body: "A Paystack transfer is waiting for OTP.",
      url: "/admin/payouts",
    });
  }
  return "pending";
}

async function failPayout(
  payoutId: string,
  reason: string,
  amount: number,
  transferCode?: string | null,
  event: "transfer.failed" | "transfer.reversed" = "transfer.failed",
) {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout) return;
  const next = applyTransferEvent(payout.status, event);
  if (!next?.restore && payout.status !== "PENDING" && payout.status !== "PROCESSING") return;
  await prisma.$transaction(async (tx) => {
    await tx.payout.update({
      where: { id: payoutId },
      data: {
        status: reason === "reversed" ? "REVERSED" : "FAILED",
        failureReason: reason,
        paystackTransferCode: transferCode ?? payout.paystackTransferCode,
      },
    });
    await tx.ledgerEntry.create({
      data: {
        riderId: payout.riderId,
        type: "PAYOUT_REVERSAL",
        amount,
        idempotencyKey: `payout:${payoutId}:reversal`,
        note: reason,
        createdBy: "system",
      },
    }).catch((err: unknown) => {
      if (typeof err === "object" && err && "code" in err && (err as { code?: string }).code === "P2002") return;
      throw err;
    });
  });
  if (badAccountReason(reason)) {
    await prisma.rider.update({ where: { id: payout.riderId }, data: { bankNeedsReview: true } });
  }
  await sendPushToAdmins({
    title: "Payout failed",
    body: reason,
    url: "/admin/payouts",
  });
}

export async function handleTransferWebhook(
  event: "transfer.success" | "transfer.failed" | "transfer.reversed",
  reference: string,
  reason: string,
): Promise<void> {
  const payout = await prisma.payout.findUnique({ where: { reference } });
  if (!payout) return;
  const next = applyTransferEvent(payout.status, event);
  if (!next) return;
  if (next.status === "SUCCESS") {
    await prisma.payout.update({ where: { id: payout.id }, data: { status: "SUCCESS", failureReason: null } });
    return;
  }
  await failPayout(
    payout.id,
    reason || event,
    payout.amount,
    null,
    event === "transfer.reversed" ? "transfer.reversed" : "transfer.failed",
  );
}

export async function maybeRunScheduledPayout(at = new Date()): Promise<void> {
  const config = await configRow();
  const parts = lagosParts(at);
  if (parts.hour !== config.runHourLagos || parts.minute > 5) return;
  await runPayouts(at);
}

async function reconcile(runDate: string, cutoffAt: Date): Promise<void> {
  const dayStart = lagosCutoff(runDate, 0);
  const mismatches: string[] = [];
  let chargeKobo = 0;
  let transferListed = 0;
  try {
    chargeKobo = await listSuccessfulChargesKobo(dayStart.toISOString(), cutoffAt.toISOString());
  } catch {
    mismatches.push("Could not list Paystack charges");
  }
  const orders = await prisma.order.findMany({
    where: {
      paymentMethod: "paystack",
      paymentStatus: "paid",
      paidAt: { gte: dayStart, lt: cutoffAt },
    },
    select: { feeNgn: true },
  });
  const orderKobo = orders.reduce((sum, order) => sum + nairaToKobo(order.feeNgn), 0);
  if (chargeKobo !== orderKobo) mismatches.push(`Charges ${chargeKobo} kobo vs orders ${orderKobo} kobo`);

  const payouts = await prisma.payout.findMany({
    where: { status: "SUCCESS", run: { runDate } },
    select: { amount: true, reference: true },
  });
  const ledgerPaid = payouts.reduce((sum, row) => sum + row.amount, 0);
  for (const payout of payouts) {
    const remote = await verifyPaystackTransfer(payout.reference).catch(() => null);
    if (!remote || remote.status !== "success" || remote.amount !== payout.amount) {
      mismatches.push(`Transfer ${payout.reference} does not match Paystack`);
    } else {
      transferListed += remote.amount;
    }
  }
  if (transferListed !== ledgerPaid) mismatches.push(`Ledger payouts ${ledgerPaid} vs Paystack ${transferListed}`);

  const openCredits = await prisma.ledgerEntry.groupBy({
    by: ["riderId"],
    where: { payoutId: null, amount: { gt: 0 } },
    _sum: { amount: true },
  });
  const owed = openCredits.reduce((sum, row) => sum + (row._sum.amount ?? 0), 0);
  let cover = 0;
  try {
    cover = (await paystackBalanceKobo()) + (await pendingSettlementKobo());
  } catch {
    mismatches.push("Could not read Paystack balance");
  }
  if (cover < owed) mismatches.push(`Balance ${cover} kobo does not cover ${owed} kobo owed`);

  const status = mismatches.length ? "MISMATCH" : "OK";
  await prisma.reconciliationRun.create({
    data: { runDate, status, details: { mismatches, chargeKobo, orderKobo, ledgerPaid, owed, cover } },
  });
  if (status === "MISMATCH") {
    await sendPushToAdmins({
      title: "Payout reconciliation mismatch",
      body: mismatches[0] ?? "Review the reconciliation report",
      url: "/admin/payouts",
    });
  }
}

/** Re-check a transfer that did not reach a final Paystack status. Failed rows are paid on the next run. */
export async function retryPayout(payoutId: string): Promise<void> {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId }, include: { rider: true } });
  if (!payout) return;
  if (payout.status !== "PENDING" && payout.status !== "PROCESSING") return;
  const remote = await verifyPaystackTransfer(payout.reference).catch(() => null);
  if (remote) {
    await applyKnown(payout.id, remote.status, remote.transferCode, payout.amount);
    return;
  }
  const config = await configRow();
  if (payout.attempts >= config.maxAttempts) return;
  if (!payout.rider.paystackRecipientCode || payout.rider.bankNeedsReview) return;
  await sendOne(payout.id, payout.reference, payout.amount, payout.rider.paystackRecipientCode);
}
