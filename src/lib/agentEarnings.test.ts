import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quoteAgentEarnings, type AgentPaySlice, type EarningsRider } from "./agentEarnings";
import { nextFirstTenReachedAt } from "./onboarding";

const rates: AgentPaySlice = {
  activationPay: 250_000,
  volumeBonusPer10: 500_000,
  retentionBonus: 1_000_000,
  retentionThreshold: 0.7,
  activityWindowDays: 14,
  baseStipend: 3_000_000,
  transportAllowance: 1_000_000,
};

const range = {
  start: new Date("2026-08-31T23:00:00.000Z"),
  end: new Date("2026-09-30T23:00:00.000Z"),
};

function rider(partial: Partial<EarningsRider> & Pick<EarningsRider, "id">): EarningsRider {
  return { approvedAt: null, firstTenReachedAt: null, completedAt: [], ...partial };
}

describe("guaranteed pay", () => {
  it("pays the stipend and transport in full when nobody was approved", () => {
    const quote = quoteAgentEarnings({ range, now: new Date("2026-09-28T12:00:00.000Z"), rates, riders: [] });
    const base = quote.lines.find((line) => line.key === "base");
    const transport = quote.lines.find((line) => line.key === "transport");
    assert.equal(base?.amountKobo, 3_000_000);
    assert.equal(transport?.amountKobo, 1_000_000);
    assert.equal(base?.task, "Paid monthly, guaranteed.");
    assert.equal(transport?.task, "Paid monthly, guaranteed.");
    assert.equal(base?.detail, "");
    assert.equal(quote.totalKobo, 4_000_000);
  });
});

describe("activation pay", () => {
  it("pays the rate once for every rider who reaches 10 deliveries", () => {
    const quote = quoteAgentEarnings({
      range,
      now: new Date("2026-09-28T12:00:00.000Z"),
      rates,
      riders: [1, 2, 3].map((n) =>
        rider({
          id: `r${n}`,
          firstTenReachedAt: new Date(`2026-09-0${n}T12:00:00.000Z`),
        }),
      ),
    });
    const activation = quote.lines.find((line) => line.key === "activation");
    assert.equal(quote.activatedCount, 3);
    assert.equal(activation?.amountKobo, 750_000);
    assert.equal(activation?.rateLabel, "per rider");
    assert.equal(activation?.detail, "3 riders reached 10 deliveries this month → ₦7,500");
    assert.equal(quote.totalKobo, 4_000_000 + 750_000);
  });

  it("pays no activation when nobody reached 10, and still pays the stipend", () => {
    const quote = quoteAgentEarnings({
      range,
      now: new Date("2026-09-28T12:00:00.000Z"),
      rates,
      riders: [rider({ id: "r1", approvedAt: new Date("2026-09-02T12:00:00.000Z") })],
    });
    const activation = quote.lines.find((line) => line.key === "activation");
    assert.equal(activation?.amountKobo, 0);
    assert.equal(activation?.detail, "0 riders reached 10 deliveries this month → ₦0");
    assert.equal(quote.lines.find((line) => line.key === "base")?.amountKobo, 3_000_000);
    assert.equal(quote.lines.find((line) => line.key === "transport")?.amountKobo, 1_000_000);
  });

  it("adds the volume bonus on top of per-rider activation, one block per 10 riders", () => {
    const riders = Array.from({ length: 10 }, (_, index) =>
      rider({
        id: `r${index}`,
        firstTenReachedAt: new Date("2026-09-15T12:00:00.000Z"),
      }),
    );
    const quote = quoteAgentEarnings({
      range,
      now: new Date("2026-09-28T12:00:00.000Z"),
      rates,
      riders,
    });
    assert.equal(quote.lines.find((line) => line.key === "activation")?.amountKobo, 2_500_000);
    assert.equal(quote.lines.find((line) => line.key === "volume")?.amountKobo, 500_000);
  });
});

describe("retention bonus", () => {
  it("waits 30 days after each approval, then pays once if enough riders are still delivering", () => {
    const approvedAt = new Date("2026-09-01T12:00:00.000Z");
    const riders = [1, 2].map((n) =>
      rider({
        id: `r${n}`,
        approvedAt,
        completedAt: [new Date("2026-09-25T12:00:00.000Z")],
      }),
    );
    const pending = quoteAgentEarnings({
      range,
      now: new Date("2026-09-20T12:00:00.000Z"),
      rates,
      riders,
    });
    assert.equal(pending.lines.find((line) => line.key === "retention")?.status, "pending");
    assert.equal(pending.lines.find((line) => line.key === "retention")?.amountKobo, 0);

    const due = quoteAgentEarnings({
      range,
      now: new Date("2026-10-02T12:00:00.000Z"),
      rates,
      riders,
    });
    const retention = due.lines.find((line) => line.key === "retention");
    assert.equal(retention?.status, "due");
    assert.equal(retention?.amountKobo, 1_000_000);
  });
});

describe("first ten stamp", () => {
  it("sets the timestamp once at 10 completed orders and leaves it unchanged after that", () => {
    const first = nextFirstTenReachedAt(null, 9, new Date("2026-09-01T00:00:00.000Z"));
    assert.equal(first, null);
    const stamped = nextFirstTenReachedAt(null, 10, new Date("2026-09-10T00:00:00.000Z"));
    assert.equal(stamped?.toISOString(), "2026-09-10T00:00:00.000Z");
    const later = nextFirstTenReachedAt(stamped, 14, new Date("2026-09-20T00:00:00.000Z"));
    assert.equal(later?.toISOString(), "2026-09-10T00:00:00.000Z");
  });
});
