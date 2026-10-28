import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmStamp, dayLabel, dayParts, dayShort, istanbulInput, istanbulToday, money, seatLabel, stamp } from "./format.js";
import { istanbulLabel } from "../../server/admin.js";

test("confirmStamp matches the server's delete-confirm label; istanbulInput prefills the edit form", () => {
  for (const iso of ["2026-10-28T17:30:00.000Z", "2026-12-31T21:05:00.000Z", "2027-01-01T00:00:00.000Z"]) {
    assert.equal(confirmStamp(iso), istanbulLabel(iso));
  }
  assert.equal(confirmStamp("2026-10-28T17:30:00.000Z"), "28.10.2026 20:30");
  assert.deepEqual(istanbulInput("2026-12-31T21:05:00.000Z"), { date: "2027-01-01", time: "00:05" });
  assert.equal(confirmStamp("nope"), "");
});

test("money: tr-TR grouping + ₺", () => {
  assert.equal(money(1250), "1.250 ₺");
  assert.equal(money(75), "75 ₺");
  assert.equal(money(0), "0 ₺");
  assert.equal(money(1234567), "1.234.567 ₺");
});

test("dates are Istanbul time (UTC+3), Turkish names", () => {
  const iso = "2026-10-28T17:30:00.000Z"; // 20:30 in Istanbul
  assert.equal(dayLabel(iso), "28 Ekim Çarşamba 20:30");
  assert.equal(dayLabel(iso, "en"), "28 October Wednesday 20:30");
  assert.equal(dayShort(iso), "28 Eki Çar 20:30");
  assert.deepEqual(dayParts(iso), { day: "28", month: "Ekim", weekday: "Çarşamba", year: "2026", time: "20:30" });
  assert.equal(stamp("2026-10-28T17:31:05.000Z"), "28.10.2026 20:31:05");
  assert.equal(dayLabel("nope"), "—");
});

test("istanbulToday crosses midnight before UTC does", () => {
  assert.equal(istanbulToday(new Date("2026-10-28T22:30:00Z")), "2026-10-29");
  assert.equal(istanbulToday(new Date("2026-10-28T20:30:00Z")), "2026-10-28");
});

test("seatLabel upper-cases the row in ASCII", () => {
  assert.equal(seatLabel("i", "12"), "I-12"); // not "İ-12"
});
