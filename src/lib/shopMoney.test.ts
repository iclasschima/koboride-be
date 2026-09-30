import { test } from "node:test";
import assert from "node:assert/strict";
import { shopCardPaid, shopCardTotalNgn, shopPayoutNgn } from "./shopMoney";

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
