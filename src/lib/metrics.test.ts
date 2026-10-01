import { test } from "node:test";
import assert from "node:assert/strict";
import { periodStart, shiftPeriod, summarizeMetrics, type MetricsOrder } from "./metrics";

test("weeks start on Monday midnight in Lagos", () => {
  // Sunday 23:30 UTC is Monday 00:30 in Lagos, so it belongs to the new week.
  assert.equal(periodStart(new Date("2026-10-04T23:30:00Z"), "week").toISOString(), "2026-10-04T23:00:00.000Z");
  assert.equal(periodStart(new Date("2026-10-04T22:30:00Z"), "week").toISOString(), "2026-09-27T23:00:00.000Z");
});

test("months follow the Lagos calendar and shift across years", () => {
  const start = periodStart(new Date("2026-12-31T23:30:00Z"), "month");
  assert.equal(start.toISOString(), "2026-12-31T23:00:00.000Z");
  assert.equal(shiftPeriod(start, "month", -1).toISOString(), "2026-11-30T23:00:00.000Z");
  assert.equal(shiftPeriod(start, "month", 1).toISOString(), "2027-01-31T23:00:00.000Z");
});

const starts = [0, 1, 2].map((week) => shiftPeriod(new Date("2026-09-13T23:00:00Z"), "week", week));
const at = (week: number) => new Date(starts[week].getTime() + 60 * 60 * 1000);

function order(customerId: string, week: number, extra: Partial<MetricsOrder> = {}): MetricsOrder {
  return {
    status: "completed",
    paymentStatus: "paid",
    customerId,
    riderId: "r1",
    merchantId: null,
    feeNgn: 1000,
    payoutNgn: 800,
    goodsNgn: 0,
    createdAt: at(week),
    completedAt: at(week),
    ...extra,
  };
}

test("delivered orders count toward money and activity; cancelled and refunded ones don't", () => {
  const { buckets } = summarizeMetrics({
    starts,
    orders: [
      order("a", 0, { goodsNgn: 3000, merchantId: "s1" }),
      order("a", 0),
      order("b", 0, { status: "cancelled", completedAt: null }),
      order("c", 0, { paymentStatus: "refunded" }),
    ],
    firstDelivered: new Map([["a", at(0)]]),
    signups: [at(0), at(1)],
    riderApprovals: [at(2)],
  });
  assert.deepEqual(
    { ...buckets[0], start: undefined },
    {
      start: undefined,
      orders: 2,
      cancelled: 1,
      faresNgn: 2000,
      goodsNgn: 3000,
      revenueNgn: 400,
      activeCustomers: 1,
      newCustomers: 1,
      signups: 1,
      activeRiders: 1,
      newRiders: 0,
      activeShops: 1,
      shopOrders: 1,
    },
  );
  assert.equal(buckets[1].signups, 1);
  assert.equal(buckets[2].newRiders, 1);
});

test("returning customers aren't new, and cohorts track who comes back", () => {
  const { buckets, cohorts } = summarizeMetrics({
    starts,
    orders: [order("old", 0), order("a", 0), order("b", 0), order("a", 1), order("a", 2), order("b", 2)],
    firstDelivered: new Map([
      ["old", new Date("2026-08-01T10:00:00Z")],
      ["a", at(0)],
      ["b", at(0)],
    ]),
    signups: [],
    riderApprovals: [],
  });
  assert.equal(buckets[0].activeCustomers, 3);
  assert.equal(buckets[0].newCustomers, 2);
  assert.deepEqual(cohorts[0], { start: "2026-09-14", size: 2, active: [2, 1, 2] });
  assert.deepEqual(cohorts[2], { start: "2026-09-28", size: 0, active: [0] });
});
