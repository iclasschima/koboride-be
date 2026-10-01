import { test } from "node:test";
import assert from "node:assert/strict";
import { paystackFeeNgn, shopCardPaid, shopCardTotalNgn, shopPayoutNgn } from "./shopMoney";

function paystackTakes(chargedNgn: number): number {
  return Math.min(chargedNgn * 0.015 + (chargedNgn >= 2500 ? 100 : 0), 2000);
}

test("the Paystack fee leaves the full amount after Paystack takes its cut", () => {
  for (const net of [1, 500, 2000, 2400, 2462, 2463, 2500, 6200, 50_000, 125_000, 126_000, 500_000]) {
    const charged = net + paystackFeeNgn(net);
    assert.ok(charged - paystackTakes(charged) >= net, `short at ₦${net}`);
    assert.ok(charged - 1 - paystackTakes(charged - 1) < net, `over-charged at ₦${net}`);
  }
});

test("the Paystack fee waives ₦100 under ₦2,500 and stops at ₦2,000", () => {
  assert.equal(paystackFeeNgn(0), 0);
  assert.equal(paystackFeeNgn(1970), 30);
  assert.equal(paystackFeeNgn(6200), 196);
  assert.equal(paystackFeeNgn(500_000), 2000);
});

test("customer-paid delivery is charged on the card with the items", () => {
  assert.equal(shopCardTotalNgn(5000, 1200, "receiver"), 6200);
});

test("shop-paid delivery leaves only the items on the card", () => {
  assert.equal(shopCardTotalNgn(5000, 1200, "sender"), 5000);
});

test("the shop is owed its items when the customer paid delivery", () => {
  assert.equal(shopPayoutNgn({ goodsNgn: 5000, feeNgn: 1200, farePayer: "receiver" }), 5000);
});

test("shop-paid delivery comes out of the shop payout", () => {
  assert.equal(shopPayoutNgn({ goodsNgn: 5000, feeNgn: 1200, farePayer: "sender" }), 3800);
});

test("only a settled card charge counts as paid online", () => {
  assert.equal(shopCardPaid({ paymentMethod: "paystack", paymentStatus: "paid" }), true);
  assert.equal(shopCardPaid({ paymentMethod: "paystack", paymentStatus: "refunded" }), false);
  assert.equal(shopCardPaid({ paymentMethod: "cash", paymentStatus: "unpaid" }), false);
});
