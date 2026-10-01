import type { CustomerSource, OrderStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** West Africa Time, no daylight saving. Weeks start on Monday in Lagos. */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type MetricsPeriod = "week" | "month";

/** Start of the Lagos week or month that contains `at`, as a UTC instant. */
export function periodStart(at: Date, period: MetricsPeriod): Date {
  const lagos = new Date(at.getTime() + LAGOS_OFFSET_MS);
  const year = lagos.getUTCFullYear();
  const month = lagos.getUTCMonth();
  if (period === "month") return new Date(Date.UTC(year, month, 1) - LAGOS_OFFSET_MS);
  const sinceMonday = (lagos.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(year, month, lagos.getUTCDate() - sinceMonday) - LAGOS_OFFSET_MS);
}

export function shiftPeriod(start: Date, period: MetricsPeriod, count: number): Date {
  if (period === "week") return new Date(start.getTime() + count * 7 * DAY_MS);
  const lagos = new Date(start.getTime() + LAGOS_OFFSET_MS);
  return new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth() + count, 1) - LAGOS_OFFSET_MS);
}

/** The Lagos calendar day (YYYY-MM-DD) a period starts on. */
function lagosDay(start: Date): string {
  return new Date(start.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

export type MetricsOrder = {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  customerId: string;
  riderId: string | null;
  merchantId: string | null;
  feeNgn: number;
  payoutNgn: number;
  goodsNgn: number;
  createdAt: Date;
  completedAt: Date | null;
};

export type MetricsBucket = {
  start: string;
  /** Delivered orders, not refunded. Booked by when they were delivered. */
  orders: number;
  /** Cancelled orders, booked by when they were placed. */
  cancelled: number;
  faresNgn: number;
  goodsNgn: number;
  /** Fares minus rider pay. Negative when a location discount paid the rider more than the fare. */
  revenueNgn: number;
  activeCustomers: number;
  /** Customers whose first delivered order fell in this period. */
  newCustomers: number;
  signups: number;
  activeRiders: number;
  newRiders: number;
  activeShops: number;
  shopOrders: number;
};

export type MetricsCohort = {
  start: string;
  size: number;
  /** Customers from the cohort with a delivered order in each period since, starting with their first. */
  active: number[];
};

/**
 * Groups orders and sign-ups into periods. `starts` are oldest first; anything before the first is ignored.
 * `firstDelivered` is each customer's first delivered order over all time, so returning customers aren't counted new.
 */
export function summarizeMetrics(input: {
  starts: Date[];
  orders: MetricsOrder[];
  firstDelivered: Map<string, Date>;
  signups: Date[];
  riderApprovals: Date[];
}): { buckets: MetricsBucket[]; cohorts: MetricsCohort[] } {
  const { starts } = input;
  const indexOf = (at: Date) => {
    if (at < starts[0]) return -1;
    let index = starts.length - 1;
    while (index > 0 && at < starts[index]) index -= 1;
    return index;
  };
  const sets = starts.map(() => ({ customers: new Set<string>(), riders: new Set<string>(), shops: new Set<string>() }));
  const buckets: MetricsBucket[] = starts.map((start) => ({
    start: lagosDay(start),
    orders: 0,
    cancelled: 0,
    faresNgn: 0,
    goodsNgn: 0,
    revenueNgn: 0,
    activeCustomers: 0,
    newCustomers: 0,
    signups: 0,
    activeRiders: 0,
    newRiders: 0,
    activeShops: 0,
    shopOrders: 0,
  }));

  for (const order of input.orders) {
    if (order.status === "cancelled") {
      const index = indexOf(order.createdAt);
      if (index >= 0) buckets[index].cancelled += 1;
      continue;
    }
    if (order.status !== "completed" || order.paymentStatus === "refunded") continue;
    const index = indexOf(order.completedAt ?? order.createdAt);
    if (index < 0) continue;
    const bucket = buckets[index];
    bucket.orders += 1;
    bucket.faresNgn += order.feeNgn;
    bucket.goodsNgn += order.goodsNgn;
    bucket.revenueNgn += order.feeNgn - order.payoutNgn;
    sets[index].customers.add(order.customerId);
    if (order.riderId) sets[index].riders.add(order.riderId);
    if (order.merchantId) {
      sets[index].shops.add(order.merchantId);
      bucket.shopOrders += 1;
    }
  }

  const cohortOf = new Map<string, number>();
  input.firstDelivered.forEach((at, customerId) => {
    const index = indexOf(at);
    if (index < 0) return;
    buckets[index].newCustomers += 1;
    cohortOf.set(customerId, index);
  });
  for (const at of input.signups) {
    const index = indexOf(at);
    if (index >= 0) buckets[index].signups += 1;
  }
  for (const at of input.riderApprovals) {
    const index = indexOf(at);
    if (index >= 0) buckets[index].newRiders += 1;
  }

  const cohorts: MetricsCohort[] = buckets.map((bucket, index) => ({
    start: bucket.start,
    size: 0,
    active: Array.from({ length: starts.length - index }, () => 0),
  }));
  cohortOf.forEach((index) => {
    cohorts[index].size += 1;
  });
  sets.forEach((set, index) => {
    buckets[index].activeCustomers = set.customers.size;
    buckets[index].activeRiders = set.riders.size;
    buckets[index].activeShops = set.shops.size;
    set.customers.forEach((customerId) => {
      const cohort = cohortOf.get(customerId);
      if (cohort !== undefined && cohort <= index) cohorts[cohort].active[index - cohort] += 1;
    });
  });

  return { buckets, cohorts };
}

const DELIVERED = { status: "completed", paymentStatus: { not: "refunded" } } as const;

export async function businessMetrics(period: MetricsPeriod, count: number, now = new Date()) {
  const current = periodStart(now, period);
  const starts = Array.from({ length: count }, (_, index) => shiftPeriod(current, period, index - count + 1));
  const since = starts[0];

  const [orders, firsts, signups, riders, sources, lifetime, customers, approvedRiders, approvedShops] =
    await Promise.all([
      prisma.order.findMany({
        where: { OR: [{ createdAt: { gte: since } }, { completedAt: { gte: since } }] },
        select: {
          status: true,
          paymentStatus: true,
          customerId: true,
          riderId: true,
          merchantId: true,
          feeNgn: true,
          payoutNgn: true,
          goodsNgn: true,
          createdAt: true,
          completedAt: true,
        },
      }),
      prisma.order.groupBy({
        by: ["customerId"],
        where: DELIVERED,
        _min: { completedAt: true, createdAt: true },
      }),
      prisma.customer.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      prisma.rider.findMany({ where: { approvedAt: { gte: since } }, select: { approvedAt: true } }),
      prisma.customer.groupBy({ by: ["source"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.order.aggregate({ where: DELIVERED, _count: { _all: true }, _sum: { feeNgn: true, payoutNgn: true, goodsNgn: true } }),
      prisma.customer.count(),
      prisma.rider.count({ where: { approved: true } }),
      prisma.merchant.count({ where: { approvedAt: { not: null } } }),
    ]);

  const firstDelivered = new Map<string, Date>();
  for (const row of firsts) {
    const at = row._min.completedAt ?? row._min.createdAt;
    if (at) firstDelivered.set(row.customerId, at);
  }
  const { buckets, cohorts } = summarizeMetrics({
    starts,
    orders,
    firstDelivered,
    signups: signups.map((row) => row.createdAt),
    riderApprovals: riders.flatMap((row) => (row.approvedAt ? [row.approvedAt] : [])),
  });

  const fares = lifetime._sum.feeNgn ?? 0;
  return {
    period,
    buckets,
    cohorts,
    /** Sign-ups in the window by how they first reached KoboRide. */
    sources: sources
      .map((row) => ({ source: (row.source ?? "unknown") as CustomerSource | "unknown", count: row._count._all }))
      .sort((a, b) => b.count - a.count),
    lifetime: {
      orders: lifetime._count._all,
      faresNgn: fares,
      goodsNgn: lifetime._sum.goodsNgn ?? 0,
      revenueNgn: fares - (lifetime._sum.payoutNgn ?? 0),
      customers,
      payingCustomers: firstDelivered.size,
      approvedRiders,
      approvedShops,
    },
  };
}
