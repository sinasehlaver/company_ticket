// Seat-map layout from the hall's seats.all (display order) + the day's state. Pure: unit-tested, used by SeatMap.jsx.
// Rows "-" are aisles (empty gap rows); num "-1" is a gap inside a row. Every row is padded to the widest row so the
// closing letter column lines up.

/** state.seats tuple: [id, row, num, price, category, status, mine, holder] -> {id, status: free|mine|other|sold, holder, price} */
export function seatStatus(status, mine) {
  if (status === 2) return "sold";
  if (status === 1) return mine ? "mine" : "other";
  return "free";
}

/** Distinct prices, highest first -> Map price -> hue. Same formula as server/pricing.js tiers() (Django pricing.py). */
export function tierHues(prices) {
  const distinct = [...new Set(prices.filter((p) => p !== "" && p != null && !Number.isNaN(Number(p))).map(Number))].sort((a, b) => b - a);
  const n = distinct.length;
  const out = new Map();
  distinct.forEach((p, i) => out.set(p, n === 1 ? 200 : 150 + roundHalfEven((210 * (n - 1 - i)) / (n - 1))));
  return out;
}
function roundHalfEven(x) {
  const f = Math.floor(x);
  if (x - f === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

/**
 * all: [{row: [nums]}], bands: {row: {price, hue}} (from ticketsDict or a hall's prices), seats: state.seats or null.
 * -> {width, rows: [{type:'aisle', key} | {type:'row', key, row, price, hue, cells: [{gap:true} | {id, num, status, holder, price}]}], count}
 */
export function buildLayout(all, bands = {}, seats = null) {
  const byKey = new Map();
  for (const s of seats ?? []) byKey.set(`${s[1]}-${s[2]}`, s);
  const rows = [];
  let width = 0, count = 0;
  (all ?? []).forEach((d, i) => {
    for (const [row, nums] of Object.entries(d)) {
      if (row === "-") { rows.push({ type: "aisle", key: `-${i}` }); continue; }
      const cells = nums.map((num) => {
        if (num === "-1") return { gap: true };
        count++;
        const s = byKey.get(`${row}-${num}`);
        if (!s) return { id: null, num, status: seats ? "missing" : "free", holder: null, price: bands[row]?.price ?? null };
        return { id: s[0], num, status: seatStatus(s[5], s[6]), holder: s[7] ?? null, price: s[3] };
      });
      width = Math.max(width, cells.length);
      const b = bands[row] ?? {};
      rows.push({ type: "row", key: row, row, price: b.price ?? null, hue: b.hue ?? null, cells });
    }
  });
  for (const r of rows) if (r.type === "row") while (r.cells.length < width) r.cells.push({ gap: true });
  return { width, rows, count };
}

/** Day ticketsDict {row: {"-1": [price, hue]}} -> bands {row: {price, hue}}. */
export function bandsFromDict(dict) {
  const out = {};
  for (const [row, v] of Object.entries(dict ?? {})) {
    const t = v?.["-1"];
    if (Array.isArray(t)) out[row] = { price: Number(t[0]), hue: Number(t[1]) };
  }
  return out;
}

/** Hall price prefill {row: price} -> bands with the same tier hues a new day would get. Rows without a price: no band hue. */
export function bandsFromPrices(prices) {
  const hues = tierHues(Object.values(prices ?? {}));
  const out = {};
  for (const [row, p] of Object.entries(prices ?? {})) out[row] = { price: Number(p), hue: hues.get(Number(p)) ?? null };
  return out;
}

/** Legend counts over state.seats. */
export function tally(seats) {
  const n = { free: 0, mine: 0, other: 0, sold: 0 };
  for (const s of seats ?? []) n[seatStatus(s[5], s[6])]++;
  return n;
}
