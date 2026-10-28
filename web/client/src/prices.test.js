import { test } from "node:test";
import assert from "node:assert/strict";
import { applySchema, isPrice, missingRows, pricesBody, rowHues, schemaText } from "./prices.js";

test("isPrice: 0..32767 integers", () => {
  assert.ok(isPrice("0")); assert.ok(isPrice(32767)); assert.ok(isPrice(" 75 "));
  assert.ok(!isPrice("32768")); assert.ok(!isPrice("")); assert.ok(!isPrice("7.5")); assert.ok(!isPrice("-1"));
});

test("schemaText merges consecutive letters with equal prices", () => {
  assert.equal(schemaText({ a: "75", b: "75", c: "60", e: "60", d: "60" }), "a-b:75,c-e:60");
  assert.equal(schemaText({ a: "75", c: "75" }), "a:75,c:75");
  assert.equal(schemaText({ a: "", b: "50" }), "b:50");
});

test("applySchema is lenient and limited to the hall's rows", () => {
  assert.deepEqual(applySchema("A-C:75, z:10, junk", ["a", "b", "c", "d"]), { a: "75", b: "75", c: "75" });
});

test("rowHues / missingRows / pricesBody", () => {
  assert.deepEqual(rowHues({ a: "75", b: "60", c: "" }), { a: 360, b: 150, c: null });
  assert.deepEqual(missingRows(["a", "b", "c"], { a: "1", c: "x" }), ["b", "c"]);
  assert.deepEqual(pricesBody(["a", "b"], { a: "75", b: "60" }), { a: 75, b: 60 });
});
