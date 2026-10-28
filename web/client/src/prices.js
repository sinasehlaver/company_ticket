// Price-editor helpers (port of ticketsystem/templates/partials/price_editor.html). Pure, unit-tested.
import { tierHues } from "./seatmap.js";

export const MAX_PRICE = 32767;
export const isPrice = (v) => /^\d{1,5}$/.test(String(v ?? "").trim()) && Number(v) <= MAX_PRICE;

/** {a:"75", b:"75", c:"60"} -> "a-b:75,c:60" (consecutive letters with equal price merge, rows in letter order). */
export function schemaText(values) {
  const rows = Object.entries(values).filter(([, v]) => isPrice(v)).map(([r, v]) => [r, Number(v)]).sort((x, y) => (x[0] < y[0] ? -1 : 1));
  const out = [];
  let run = null;
  for (const [r, p] of rows) {
    if (run && run.p === p && r.charCodeAt(0) === run.end.charCodeAt(0) + 1) run.end = r;
    else { run = { start: r, end: r, p }; out.push(run); }
  }
  return out.map((o) => `${o.start === o.end ? o.start : `${o.start}-${o.end}`}:${o.p}`).join(",");
}

/** Lenient paste: "A-F:75, g:60" -> {a:"75",…,g:"60"} for the given rows; unknown parts are skipped. */
export function applySchema(text, rows) {
  const map = {};
  for (const part of String(text).toLowerCase().split(",")) {
    const m = part.trim().match(/^([a-z])(?:-([a-z]))?:(\d{1,5})$/);
    if (!m) continue;
    for (let c = m[1].charCodeAt(0); c <= (m[2] || m[1]).charCodeAt(0); c++) map[String.fromCharCode(c)] = m[3];
  }
  const out = {};
  for (const r of rows) if (r in map) out[r] = map[r];
  return out;
}

/** Row tile hue per row (null for an empty/invalid price), same tiers a saved day gets. */
export function rowHues(values) {
  const hues = tierHues(Object.values(values).filter(isPrice));
  const out = {};
  for (const [r, v] of Object.entries(values)) out[r] = isPrice(v) ? hues.get(Number(v)) : null;
  return out;
}

/** Rows still missing a valid price. */
export const missingRows = (rows, values) => rows.filter((r) => !isPrice(values[r]));

/** Body for the API: {row: Number}. */
export const pricesBody = (rows, values) => Object.fromEntries(rows.map((r) => [r, Number(values[r])]));
