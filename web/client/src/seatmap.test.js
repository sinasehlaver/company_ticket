import { test } from "node:test";
import assert from "node:assert/strict";
import { bandsFromDict, bandsFromPrices, buildLayout, seatStatus, tally, tierHues } from "./seatmap.js";

const ALL = [{ c: ["1", "2", "-1", "3"] }, { "-": [] }, { b: ["1", "2"] }, { a: ["1"] }];
// [id, row, num, price, category, status, mine, holder]
const SEATS = [
  [1, "c", "1", 75, 1, 0, false, null], [2, "c", "2", 75, 1, 1, true, null], [3, "c", "3", 75, 1, 1, false, "carsi"],
  [4, "b", "1", 60, 2, 2, false, "mimarlik"], [5, "b", "2", 60, 2, 0, false, null], [6, "a", "1", 60, 2, 0, false, null],
];

test("seatStatus", () => {
  assert.equal(seatStatus(0, false), "free");
  assert.equal(seatStatus(1, true), "mine");
  assert.equal(seatStatus(1, false), "other");
  assert.equal(seatStatus(2, false), "sold");
});

test("tierHues matches the server (Django pricing.py) spread", () => {
  assert.deepEqual([...tierHues([60])], [[60, 200]]);
  assert.deepEqual([...tierHues([60, 75, 60])], [[75, 360], [60, 150]]);
  assert.deepEqual([...tierHues([100, 75, 50])], [[100, 360], [75, 255], [50, 150]]);
});

test("buildLayout keeps seats.all order, aisles, gaps, and pads rows", () => {
  const bands = bandsFromDict({ c: { "-1": [75, 360] }, b: { "-1": [60, 150] }, a: { "-1": [60, 150] } });
  const l = buildLayout(ALL, bands, SEATS);
  assert.equal(l.width, 4);
  assert.equal(l.count, 6);
  assert.deepEqual(l.rows.map((r) => r.type === "aisle" ? "-" : r.row), ["c", "-", "b", "a"]);
  const c = l.rows[0];
  assert.equal(c.price, 75); assert.equal(c.hue, 360);
  assert.deepEqual(c.cells.map((x) => x.gap ? "_" : x.status), ["free", "mine", "_", "other"]);
  assert.equal(c.cells[3].holder, "carsi");
  assert.deepEqual(l.rows[2].cells.map((x) => x.gap ? "_" : x.status), ["sold", "free", "_", "_"]);
  assert.equal(l.rows[3].cells.length, 4);
});

test("buildLayout without state = hall preview (all free); with state, a missing ticket is marked", () => {
  const prev = buildLayout(ALL, bandsFromPrices({ a: 60, b: 60, c: 75 }));
  assert.ok(prev.rows.filter((r) => r.type === "row").every((r) => r.cells.every((x) => x.gap || x.status === "free")));
  assert.equal(prev.rows[0].hue, 360);
  const l = buildLayout(ALL, {}, SEATS.slice(1));
  assert.equal(l.rows[0].cells[0].status, "missing");
});

test("tally", () => {
  assert.deepEqual(tally(SEATS), { free: 3, mine: 1, other: 1, sold: 1 });
});
