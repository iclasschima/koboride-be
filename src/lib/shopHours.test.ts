import { test } from "node:test";
import assert from "node:assert/strict";
import { formatClock, shopOpenAt, shopTakingOrders } from "./shopHours";

/** A UTC instant for a Lagos wall-clock time (Lagos is UTC+1 all year). */
const lagos = (clock: string) => {
  const [hour, minute] = clock.split(":").map(Number);
  return new Date(Date.UTC(2026, 8, 30, hour - 1, minute));
};

test("a shop without hours is always open", () => {
  assert.equal(shopOpenAt(null, lagos("03:00")), true);
});

test("day hours include opening and exclude closing", () => {
  const hours = { opensAt: "09:00", closesAt: "21:00" };
  assert.equal(shopOpenAt(hours, lagos("08:59")), false);
  assert.equal(shopOpenAt(hours, lagos("09:00")), true);
  assert.equal(shopOpenAt(hours, lagos("20:59")), true);
  assert.equal(shopOpenAt(hours, lagos("21:00")), false);
});

test("hours that close after midnight stay open overnight", () => {
  const hours = { opensAt: "18:00", closesAt: "02:00" };
  assert.equal(shopOpenAt(hours, lagos("17:00")), false);
  assert.equal(shopOpenAt(hours, lagos("23:30")), true);
  assert.equal(shopOpenAt(hours, lagos("00:30")), true);
  assert.equal(shopOpenAt(hours, lagos("02:00")), false);
});

test("uses Lagos time, not UTC", () => {
  assert.equal(shopOpenAt({ opensAt: "09:00", closesAt: "10:00" }, new Date(Date.UTC(2026, 8, 30, 8, 30))), true);
});

test("the shop's open or closed switch ignores the hours", () => {
  const shop = { opensAt: "09:00", closesAt: "21:00" };
  assert.equal(shopTakingOrders({ ...shop, openMode: "hours" }, lagos("23:00")), false);
  assert.equal(shopTakingOrders({ ...shop, openMode: "open" }, lagos("23:00")), true);
  assert.equal(shopTakingOrders({ ...shop, openMode: "closed" }, lagos("12:00")), false);
  assert.equal(shopTakingOrders({ opensAt: null, closesAt: null, openMode: "closed" }, lagos("12:00")), false);
});

test("formats clock times for people", () => {
  assert.equal(formatClock("00:00"), "12:00 am");
  assert.equal(formatClock("09:05"), "9:05 am");
  assert.equal(formatClock("12:00"), "12:00 pm");
  assert.equal(formatClock("21:30"), "9:30 pm");
});
