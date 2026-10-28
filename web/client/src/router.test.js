import { test } from "node:test";
import assert from "node:assert/strict";
import { parentOf } from "./router.js";

test("parentOf: roots have none, children go up one level", () => {
  assert.equal(parentOf("events"), null);
  assert.equal(parentOf("logs"), null);
  assert.equal(parentOf("report"), null);
  assert.equal(parentOf("accounts"), null);
  assert.equal(parentOf("events/3"), "events");
  assert.equal(parentOf("events/3/new-day"), "events/3");
  assert.equal(parentOf("halls/new"), "halls");
  assert.equal(parentOf("logs/9"), "logs");
  assert.equal(parentOf("day/5"), "events");
  assert.equal(parentOf("day/5", "events/2"), "events/2");
});
