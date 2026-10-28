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
