// Hall seat-shape validation, Istanbul date parsing, and day creation (port of views.create_day).
import { now, newUid, tx } from './db.js';
import { readPrices, tiers, PriceError } from './pricing.js';
import { httpError } from './auth.js';

export const MAX_COUNT = 5000;
export const IST_OFFSET_MIN = 180; // Europe/Istanbul is fixed UTC+3 (no DST since 2016)

/** Validates a hall `seats` value. Returns the normalised object or throws 400. */
export function validateSeats(seats) {
  const bad = (msg) => httpError(400, msg);
  if (!seats || typeof seats !== 'object' || Array.isArray(seats)) throw bad('Koltuk düzeni bir JSON nesnesi olmalı');
  const keys = Object.keys(seats);
  if (keys.length === 1 && keys[0] === 'count') {
    const n = seats.count;
    if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) throw bad(`Koltuk sayısı 1 ile ${MAX_COUNT} arasında bir tam sayı olmalı`);
    return { count: n };
  }
  if (keys.length !== 1 || keys[0] !== 'all' || !Array.isArray(seats.all)) throw bad('Koltuk düzeni {"count": N} ya da {"all": [{"a": ["1","2"]}, …]} olmalı');
  const seen = new Set();
  let total = 0;
  for (const rowDict of seats.all) {
    if (!rowDict || typeof rowDict !== 'object' || Array.isArray(rowDict) || Object.keys(rowDict).length !== 1) {
      throw bad('Her sıra tek anahtarlı bir nesne olmalı: {"a": ["1","2"]}');
    }
    const [row, nums] = Object.entries(rowDict)[0];
    if (!Array.isArray(nums)) throw bad(`"${row}" sırasının koltukları bir liste olmalı`);
    if (row === '-') continue; // aisle, contents ignored
    if (!/^[a-z]$/.test(row)) throw bad(`Geçersiz sıra harfi: "${row}" (tek küçük harf ya da "-")`);
    if (seen.has(row)) throw bad(`"${row}" sırası iki kez var`);
    seen.add(row);
    const inRow = new Set();
    for (const n of nums) {
      if (typeof n !== 'string' || !/^(-1|[0-9A-Za-z]{1,10})$/.test(n)) throw bad(`"${row}" sırasında geçersiz koltuk numarası: ${JSON.stringify(n)}`);
      if (n === '-1') continue;
      if (inRow.has(n)) throw bad(`"${row}" sırasında ${n} numarası iki kez var`);
      inRow.add(n);
      total++;
    }
  }
  if (!seen.size || !total) throw bad('Salonda en az bir koltuk olmalı');
  if (total > 20000) throw bad('Salonda çok fazla koltuk var');
  return { all: seats.all };
}

/** 'YYYY-MM-DDTHH:MM' Istanbul local time -> UTC ISO string, or null when invalid. */
export function istanbulToUtc(text) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{1,2})$/.exec(typeof text === 'string' ? text.trim() : '');
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(ms);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null; // Feb 30 etc.
  return new Date(ms - IST_OFFSET_MIN * 60000).toISOString();
}

const DATE_ERROR = 'Geçerli bir tarih ve saat girin';

/** Port of create_day. body = {date, prices?:{row:price}, price?, remember?}. Returns the new day id. */
export async function createDay(db, event, hall, body) {
  const date = istanbulToUtc(body?.date);
  if (!date) throw httpError(400, DATE_ERROR);
  let prices, schema;
  try {
    ({ prices, schema } = readPrices(hall, body));
  } catch (e) {
    if (e instanceof PriceError) throw httpError(400, e.message);
    throw e;
  }
  const seats = JSON.parse(hall.seats);
  return tx(db, async (t) => {
    const ts = now();
    if (body.remember === true || body.remember === 1 || body.remember === '1') {
      await t.execute({ sql: 'UPDATE halls SET price_schema = ?, updated_at = ? WHERE id = ?', args: [schema, ts, hall.id] });
    }
    const d = await t.execute({
      sql: 'INSERT INTO days (uid, event_id, date, tickets_dict, updated_at) VALUES (?, ?, ?, ?, ?)',
      args: [newUid(), event.id, date, '{}', ts],
    });
    const dayId = Number(d.lastInsertRowid);
    const batch = [];
    if (!Object.keys(prices).length) {
      const price = Number(schema);
      for (let i = 0; i < seats.count; i++) batch.push(['m', String(i), price, 0]);
    } else {
      const tier = tiers(prices);
      const ticketsDict = {};
      for (const rowDict of seats.all) {
        for (const [row, nums] of Object.entries(rowDict)) {
          if (row === '-') continue;
          const price = prices[row];
          const [cat, hue] = tier.get(price);
          ticketsDict[row] = { '-1': [price, hue] };
          for (const n of nums) if (n !== '-1') batch.push([row, n, price, cat]);
        }
      }
      await t.execute({ sql: 'UPDATE days SET tickets_dict = ? WHERE id = ?', args: [JSON.stringify(ticketsDict), dayId] });
    }
    await insertTickets(t, dayId, event.id, batch, ts);
    return dayId;
  });
}

const CHUNK = 200;
async function insertTickets(t, dayId, eventId, rows, ts) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const args = [];
    for (const [row, num, price, cat] of part) args.push(newUid(), dayId, eventId, row, num, price, cat, ts);
    await t.execute({
      sql: `INSERT INTO tickets (uid, day_id, event_id, row, num, price, category, status, owner, last_modified_by, updated_at) VALUES ${part.map(() => "(?, ?, ?, ?, ?, ?, ?, 0, NULL, '', ?)").join(', ')}`,
      args,
    });
  }
}
