import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateBalance,
  applyTransferEvent,
  confirmedBeforeCutoff,
  lagosCutoff,
  namesPlausiblyMatch,
  payoutReference,
  planRiderPayout,
  type OpenEntry,
} from "./payoutMath";

const config = { minPayout: 50_000, recoveryCapRatio: 0.5 };

function entry(partial: Partial<OpenEntry> & Pick<OpenEntry, "id" | "type" | "amount">): OpenEntry {
  return { createdAt: "2026-09-28T10:00:00.000Z", ...partial };
}

describe("recovery cap", () => {
  it("pays half when debt is larger than the cap and carries the rest", () => {
    const plan = planRiderPayout(
      [
        entry({ id: "e1", type: "ONLINE_EARNING", amount: 100_000 }),
        entry({ id: "d1", type: "CASH_COMMISSION", amount: -400_000 }),
      ],
      config,
    );
    assert.equal(plan.decision, "pay");
    assert.equal(plan.recovery, 50_000);
    assert.equal(plan.net, 50_000);
    assert.equal(plan.debtRemainder?.amount, -350_000);
  });
});

describe("minimum payout", () => {
  it("rolls a net below the minimum into the next day", () => {
    const plan = planRiderPayout(
      [entry({ id: "e1", type: "ONLINE_EARNING", amount: 40_000 })],
      config,
    );
    assert.equal(plan.decision, "skip");
    assert.deepEqual(plan.consumeIds, []);
  });
});

describe("transfer events", () => {
  it("restores a failed transfer once and ignores a replay", () => {
    const first = applyTransferEvent("PROCESSING", "transfer.failed");
    assert.equal(first?.restore, true);
    assert.equal(applyTransferEvent("FAILED", "transfer.failed"), null);
    assert.equal(applyTransferEvent("SUCCESS", "transfer.reversed"), null);
  });
});

describe("refund after payout", () => {
  it("nets a later clawback against the next run", () => {
    const plan = planRiderPayout(
      [
        entry({ id: "e2", type: "ONLINE_EARNING", amount: 200_000, createdAt: "2026-09-29T08:00:00.000Z" }),
        entry({ id: "c1", type: "CLAWBACK", amount: -80_000, createdAt: "2026-09-29T09:00:00.000Z" }),
      ],
      config,
    );
    assert.equal(plan.recovery, 80_000);
    assert.equal(plan.net, 120_000);
  });
});

describe("one payout per rider per day", () => {
  it("uses one Paystack reference", () => {
    const reference = payoutReference("cmurider1", "2026-09-28");
    assert.equal(reference, "payout-cmurider1-2026-09-28");
    assert.equal(payoutReference("cmurider1", "2026-09-28"), reference);
  });
});

describe("balance", () => {
  it("pays oldest first and holds the rest", () => {
    const result = allocateBalance(
      [
        { riderId: "b", net: 80_000, oldestAt: "2026-09-28T12:00:00.000Z" },
        { riderId: "a", net: 60_000, oldestAt: "2026-09-28T08:00:00.000Z" },
        { riderId: "c", net: 70_000, oldestAt: "2026-09-28T09:00:00.000Z" },
      ],
      100_000,
    );
    assert.deepEqual(result.funded.map((plan) => plan.riderId), ["a"]);
    assert.deepEqual(result.held.map((plan) => plan.riderId), ["c", "b"]);
    assert.equal(result.shortfall, 150_000);
  });
});

describe("cutoff", () => {
  it("excludes a delivery confirmed at or after the Lagos cutoff", () => {
    const cutoff = lagosCutoff("2026-09-28", 18);
    assert.equal(confirmedBeforeCutoff(new Date("2026-09-28T16:59:00.000Z"), cutoff), true);
    assert.equal(confirmedBeforeCutoff(new Date("2026-09-28T17:00:00.000Z"), cutoff), false);
  });
});

describe("bank name", () => {
  it("accepts a reordered name with a middle name and rejects a different person", () => {
    assert.equal(namesPlausiblyMatch("Frank Oke", "OKE FRANK CHINEDU"), true);
    assert.equal(namesPlausiblyMatch("Frank Oke", "JANE DOE"), false);
  });
});

describe("dry run", () => {
  it("plans a payout without requiring a transfer call", () => {
    const plan = planRiderPayout(
      [entry({ id: "e1", type: "ONLINE_EARNING", amount: 80_000 })],
      config,
    );
    assert.equal(plan.decision, "pay");
    assert.equal(plan.net, 80_000);
  });
});
