import { z } from "zod";
import type { Admin } from "@prisma/client";
import { writeOrderEvent } from "@/lib/dispatch";
import { AppError } from "@/lib/errors";
import { listPaystackTransactions, nairaToKobo, refundPaystack, verifyPaystack } from "@/lib/paystack";
import { prisma } from "@/lib/prisma";

export const PAYMENTS_PER_PAGE = 50;

export const refundSchema = z.object({
  reference: z.string().trim().min(4).max(100),
  amountNgn: z.number().int().positive().optional(),
  reason: z.string().trim().min(3, "Say why you are refunding").max(300),
  pin: z.string().optional(),
});

/** Paystack moves a payment to reversal-pending, then reversed, once any refund starts, even a partial one. */
function wasPaid(status: string): boolean {
  return status === "success" || status === "reversal-pending" || status === "reversed";
}

function naira(kobo: number): number {
  return Math.floor(kobo / 100);
}

/** Cancelled orders refund themselves without a Refund row, so count those as fully refunded. */
function refundedSoFar(totalNgn: number, refundRowsNgn: number, orderRefunded: boolean): number {
  return refundRowsNgn === 0 && orderRefunded ? totalNgn : Math.min(refundRowsNgn, totalNgn);
}

export async function listPayments(page: number) {
  const { transactions, pageCount, total } = await listPaystackTransactions({ page, perPage: PAYMENTS_PER_PAGE });
  const references = transactions.map((row) => row.reference);
  const customerIds = Array.from(
    new Set(transactions.map((row) => row.metadata.customerId).filter((id): id is string => typeof id === "string")),
  );
  const [orders, refunds, customers] = await Promise.all([
    prisma.order.findMany({
      where: { paystackReference: { in: references } },
      select: {
        id: true,
        status: true,
        paystackReference: true,
        paymentStatus: true,
        customer: { select: { id: true, name: true, phone: true } },
        merchant: { select: { id: true, name: true } },
      },
    }),
    prisma.refund.findMany({
      where: { reference: { in: references } },
      orderBy: { createdAt: "asc" },
      include: { admin: { select: { name: true, email: true } } },
    }),
    prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, phone: true } }),
  ]);
  const orderByRef = new Map(orders.map((order) => [order.paystackReference, order]));
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));

  return {
    page,
    pageCount,
    total,
    payments: transactions.map((row) => {
      const order = orderByRef.get(row.reference) ?? null;
      const rowRefunds = refunds.filter((refund) => refund.reference === row.reference);
      const amountNgn = naira(row.amountKobo);
      const refundedNgn = refundedSoFar(
        amountNgn,
        rowRefunds.reduce((sum, refund) => sum + refund.amountNgn, 0),
        order?.paymentStatus === "refunded",
      );
      const metaCustomer =
        typeof row.metadata.customerId === "string" ? customerById.get(row.metadata.customerId) : undefined;
      return {
        reference: row.reference,
        amountNgn,
        status: row.status,
        paid: wasPaid(row.status),
        channel: row.channel,
        email: row.email,
        paidAt: row.paidAt,
        createdAt: row.createdAt,
        customer: order?.customer ?? metaCustomer ?? null,
        order: order ? { id: order.id, status: order.status, shopName: order.merchant?.name ?? null } : null,
        refundedNgn,
        refundableNgn: wasPaid(row.status) ? Math.max(0, amountNgn - refundedNgn) : 0,
        refunds: rowRefunds.map((refund) => ({
          id: refund.id,
          amountNgn: refund.amountNgn,
          reason: refund.reason,
          by: refund.admin.name ?? refund.admin.email,
          createdAt: refund.createdAt.toISOString(),
        })),
      };
    }),
  };
}

const refunding = new Set<string>();

export async function refundPayment(admin: Admin, input: z.infer<typeof refundSchema>) {
  const reference = input.reference;
  if (refunding.has(reference)) {
    throw new AppError("A refund for this payment is already going through.", "REFUND_IN_PROGRESS", 409);
  }
  refunding.add(reference);
  try {
    const paid = await verifyPaystack(reference);
    if (!wasPaid(paid.status)) {
      throw new AppError(`Only successful payments can be refunded. This one is ${paid.status}.`, "NOT_REFUNDABLE", 409);
    }
    const totalNgn = naira(paid.amountKobo);
    const order = await prisma.order.findUnique({
      where: { paystackReference: reference },
      select: { id: true, paymentStatus: true },
    });
    const earlier = await prisma.refund.aggregate({ where: { reference }, _sum: { amountNgn: true } });
    const remaining =
      totalNgn - refundedSoFar(totalNgn, earlier._sum.amountNgn ?? 0, order?.paymentStatus === "refunded");
    if (remaining <= 0) throw new AppError("This payment is already fully refunded.", "ALREADY_REFUNDED", 409);
    const amountNgn = input.amountNgn ?? remaining;
    if (amountNgn > remaining) {
      throw new AppError(`You can refund up to ₦${remaining.toLocaleString("en-NG")}.`, "VALIDATION_ERROR", 400);
    }

    let paystackRefundId: string;
    try {
      paystackRefundId = (await refundPaystack(reference, nairaToKobo(amountNgn))).id;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Paystack request failed";
      throw new AppError(`Paystack did not accept the refund: ${message}`, "REFUND_FAILED", 502);
    }

    const refund = await prisma.refund.create({
      data: { reference, amountNgn, reason: input.reason, adminId: admin.id, orderId: order?.id, paystackRefundId },
    });
    if (order) {
      if (amountNgn === remaining) {
        await prisma.order.update({
          where: { id: order.id },
          data: { paymentStatus: "refunded", refundedAt: new Date(), paystackRefundId },
        });
      }
      await writeOrderEvent(order.id, "admin_refund", { amountNgn, reason: input.reason, adminId: admin.id });
    }
    return refund;
  } finally {
    refunding.delete(reference);
  }
}
