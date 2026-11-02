import { test } from "node:test";
import assert from "node:assert/strict";
import { cancelCount, cancelPreview } from "./cancel.js";

test("cancelPreview parses like the server", () => {
  assert.deepEqual(cancelPreview("a-32, B-25"), { seats: ["A-32", "B-25"], bad: [], dup: [], ok: true });
  const p = cancelPreview("a32, b-1,");
  assert.deepEqual(p.seats, ["B-1"]);
  assert.deepEqual(p.bad, ["a32", ""]);
  assert.equal(p.ok, false);
  assert.deepEqual(cancelPreview("a-1, A-1").dup, ["A-1"]);
  assert.equal(cancelPreview("   ").ok, false);
});

test("cancelCount: 1..sold integers only", () => {
  assert.equal(cancelCount("3", 5), 3);
  assert.equal(cancelCount(" 5 ", 5), 5);
  assert.equal(cancelCount("6", 5), null);
  assert.equal(cancelCount("0", 5), null);
  assert.equal(cancelCount("-1", 5), null);
  assert.equal(cancelCount("2.5", 5), null);
  assert.equal(cancelCount("x", 5), null);
});

import { moveQuote, pickedSeats, refundTotal } from "./cancel.js";
test("moveQuote: pay / refund / even", () => {
  assert.deepEqual(moveQuote(60, 75), { delta: 15, kind: "pay", amount: 15 });
  assert.deepEqual(moveQuote(75, 60), { delta: -15, kind: "refund", amount: 15 });
  assert.equal(moveQuote(50, 50).kind, "even");
});
test("pickedSeats keeps only cancellable picked seats; refundTotal sums them", () => {
  const seats = [[1, "a", "1", 75, 1, 2, false, null, true], [2, "a", "2", 60, 1, 2, false, null, false], [3, "a", "3", 50, 1, 2, false, null, true]];
  const l = pickedSeats(seats, new Set([1, 2]));
  assert.deepEqual(l.map((s) => s[0]), [1]);
  assert.equal(refundTotal(l), 75);
});
