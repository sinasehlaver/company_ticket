// Port of ticketsystem/pricing.py. A schema is "a-f:75,g-k:60,l-z:50" (row-letter ranges)
// or one number for count halls (Mimarlık).
export const MAX_PRICE = 32767;
const PART = /^([a-z])(?:-([a-z]))?:(\d{1,5})$/;

export class PriceError extends Error {
  constructor(message) { super(message); this.name = 'PriceError'; }
}

/** Row letters in display order, aisle markers '-' skipped. Count halls -> []. */
export function hallRows(hall) {
  const seats = typeof hall.seats === 'string' ? JSON.parse(hall.seats) : hall.seats;
  const rows = [];
  for (const rowDict of seats?.all ?? []) for (const r of Object.keys(rowDict)) if (r !== '-') rows.push(r);
  return rows;
}

/** 'a-f:75, g:60' -> {a:75,…,f:75,g:60}. Throws PriceError on junk. */
export function parseSchema(text) {
  const prices = {};
  const parts = (text || '').split(',').filter((p) => p.trim()).map((p) => p.trim().toLowerCase());
  for (const part of parts) {
    const m = PART.exec(part);
    if (!m) throw new PriceError(`Anlaşılmayan parça: "${part}" (beklenen: a-f:75)`);
    const start = m[1], end = m[2] || m[1], price = Number(m[3]);
    if (end.charCodeAt(0) < start.charCodeAt(0)) throw new PriceError(`Aralık ters: "${part}"`);
    if (price > MAX_PRICE) throw new PriceError(`Fiyat çok büyük: ${price}`);
    for (let c = start.charCodeAt(0); c <= end.charCodeAt(0); c++) prices[String.fromCharCode(c)] = price;
  }
  return prices;
}

/** {a:75,b:75,g:60} -> 'a-b:75,g:60' (merges letters adjacent in the alphabet with equal price). */
export function formatSchema(rowPrices) {
  const out = [];
  let run = null;
  for (const row of Object.keys(rowPrices).sort()) {
    const price = rowPrices[row];
    if (run && run[2] === price && row.charCodeAt(0) === run[1].charCodeAt(0) + 1) run[1] = row;
    else { run = [row, row, price]; out.push(run); }
  }
  return out.map(([a, b, p]) => (a !== b ? `${a}-${b}:${p}` : `${a}:${p}`)).join(',');
}

const isPrice = (raw) => /^\d+$/.test(raw) && Number(raw) <= MAX_PRICE;

/** prices = {row: price (number or digit string)}. Every seat row needs a price 0..MAX_PRICE. */
export function rowPricesFromBody(prices, rows) {
  const out = {};
  const src = prices && typeof prices === 'object' && !Array.isArray(prices) ? prices : {};
  for (const row of rows) {
    const v = Object.hasOwn(src, row) ? src[row] : '';
    const raw = typeof v === 'number' || typeof v === 'string' ? String(v).trim() : '';
    if (!isPrice(raw)) throw new PriceError(`"${row.toUpperCase()}" sırası için geçerli bir fiyat girin`);
    out[row] = Number(raw);
  }
  return out;
}

/** Python round(): half to even. */
function roundHalfEven(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

/** Distinct prices, highest first -> Map price -> [category 1..n, hue]. Category 1 = most expensive. */
export function tiers(rowPrices) {
  const distinct = [...new Set(Object.values(rowPrices))].sort((a, b) => b - a);
  const n = distinct.length;
  const out = new Map();
  distinct.forEach((p, i) => out.set(p, [i + 1, n === 1 ? 200 : 150 + roundHalfEven((210 * (n - 1 - i)) / (n - 1))]));
  return out;
}

/** views._read_prices: -> {prices, schema}. Count halls take one price from body.price. */
export function readPrices(hall, body) {
  const rows = hallRows(hall);
  if (!rows.length) {
    const v = body?.price;
    const raw = typeof v === 'number' || typeof v === 'string' ? String(v).trim() : '';
    if (!isPrice(raw)) throw new PriceError('Geçerli bir fiyat girin');
    return { prices: {}, schema: String(Number(raw)) }; // '055' -> '55'
  }
  const prices = rowPricesFromBody(body?.prices, rows);
  return { prices, schema: formatSchema(prices) };
}
