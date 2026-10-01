import { test } from "node:test";
import assert from "node:assert/strict";
import { liveEventFor, parseRawLiveEvent, type RawLiveEvent } from "./liveEvents";

const base: RawLiveEvent = {
  t: "order",
  id: "o1",
  status: "in_progress",
  prevStatus: "in_progress",
  customerId: "c1",
  riderId: "r1",
  prevRiderId: "r1",
  merchantId: "m1",
  zoneSlug: "YAB",
  locOnly: false,
  deleted: false,
};

test("customers only hear about their own orders, including rider moves", () => {
  assert.deepEqual(liveEventFor({ kind: "customer", id: "c1" }, { ...base, locOnly: true }), {
    t: "order",
    id: "o1",
    status: "in_progress",
    locOnly: true,
  });
  assert.equal(liveEventFor({ kind: "customer", id: "c2" }, base), null);
});

test("shops hear status changes on their orders but not rider moves", () => {
  assert.ok(liveEventFor({ kind: "merchant", id: "m1" }, base));
  assert.equal(liveEventFor({ kind: "merchant", id: "m1" }, { ...base, locOnly: true }), null);
  assert.equal(liveEventFor({ kind: "merchant", id: "m2" }, base), null);
});

test("riders hear their own jobs, a job they just lost, and the board in their zone", () => {
  const rider = { kind: "rider", id: "r1", zoneSlug: "YAB" } as const;
  assert.ok(liveEventFor(rider, base));
  assert.ok(liveEventFor(rider, { ...base, riderId: null, status: "dispatching" }));
  assert.deepEqual(
    liveEventFor({ kind: "rider", id: "r2", zoneSlug: "YAB" }, { ...base, status: "dispatching", riderId: null }),
    { t: "jobs" },
  );
  assert.deepEqual(
    liveEventFor({ kind: "rider", id: "r2", zoneSlug: "YAB" }, { ...base, prevStatus: "dispatching" }),
    { t: "jobs" },
  );
  assert.equal(
    liveEventFor({ kind: "rider", id: "r2", zoneSlug: "SUR" }, { ...base, status: "dispatching", riderId: null }),
    null,
  );
  assert.equal(liveEventFor({ kind: "rider", id: "r2", zoneSlug: "YAB" }, base), null);
  assert.equal(liveEventFor(rider, { ...base, locOnly: true }), null);
});

test("only admins see rider positions", () => {
  assert.deepEqual(liveEventFor({ kind: "admin" }, { t: "rider", id: "r1" }), { t: "rider", id: "r1" });
  assert.equal(liveEventFor({ kind: "customer", id: "c1" }, { t: "rider", id: "r1" }), null);
});

test("everyone hears app status changes", () => {
  for (const audience of [
    { kind: "customer", id: "c1" },
    { kind: "rider", id: "r1", zoneSlug: "YAB" },
    { kind: "merchant", id: "m1" },
    { kind: "admin" },
  ] as const) {
    assert.deepEqual(liveEventFor(audience, { t: "app" }), { t: "app" });
  }
  assert.deepEqual(parseRawLiveEvent(JSON.stringify({ t: "app" })), { t: "app" });
});

test("bad payloads are dropped", () => {
  assert.equal(parseRawLiveEvent("not json"), null);
  assert.equal(parseRawLiveEvent(JSON.stringify({ t: "other" })), null);
  assert.deepEqual(parseRawLiveEvent(JSON.stringify(base)), base);
});
