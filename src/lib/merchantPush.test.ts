import { test } from "node:test";
import assert from "node:assert/strict";
import { merchantProgressPush } from "./merchantPush";

const order = { id: "o1", receiverName: "Ada", rider: { name: "Tunde" } };
const at = (status: string, riderPhase: string | null) => ({ status, riderPhase });

test("rider collecting the bag tells the shop it was picked up", () => {
  const push = merchantProgressPush(at("in_progress", "en_route_pickup"), {
    ...order,
    ...at("in_progress", "collected"),
  });
  assert.equal(push?.title, "Bag picked up");
  assert.equal(push?.body, "Tunde is taking it to Ada");
  assert.equal(push?.url, "/merchant/orders/o1");
});

test("moving on after pickup does not repeat the pickup alert", () => {
  const push = merchantProgressPush(at("in_progress", "collected"), {
    ...order,
    ...at("in_progress", "en_route_dropoff"),
  });
  assert.equal(push, null);
});

test("delivery tells the shop once", () => {
  const delivered = { ...order, ...at("completed", "delivered") };
  assert.equal(merchantProgressPush(at("in_progress", "en_route_dropoff"), delivered)?.title, "Order delivered");
  assert.equal(merchantProgressPush(at("in_progress", "delivered"), delivered), null);
});

test("an admin jumping straight to delivered sends only the delivered alert", () => {
  const push = merchantProgressPush(at("in_progress", "accepted"), { ...order, ...at("completed", "delivered") });
  assert.equal(push?.title, "Order delivered");
});

test("early phases and cancellations stay quiet", () => {
  assert.equal(merchantProgressPush(at("dispatching", null), { ...order, ...at("in_progress", "accepted") }), null);
  assert.equal(merchantProgressPush(at("in_progress", "collected"), { ...order, ...at("cancelled", "collected") }), null);
});
