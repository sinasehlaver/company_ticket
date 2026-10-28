// Phase 4 başkan/superuser writes: cascade delete with tombstones, day re-pricing (free always; held/sold by choice).
import { now, tx } from './db.js';
import { readPrices, tiers, PriceError } from './pricing.js';
import { httpError } from './auth.js';
import { IST_OFFSET_MIN } from './seats.js';

/** UTC ISO -> Istanbul 'DD.MM.YYYY HH:MM' (what the user types to confirm deleting a day). */
export function istanbulLabel(iso) {
  const d = new Date(Date.parse(iso) + IST_OFFSET_MIN * 60000);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// Which days a delete covers, as a SQL predicate over days.id with one `?` (the target id).
const SCOPE = {
  hall: { days: 'event_id IN (SELECT id FROM events WHERE hall_id = ?)', label: 'SELECT name AS label, uid FROM halls WHERE id = ?', notFound: 'Salon bulunamadı' },
  event: { days: 'event_id = ?', label: 'SELECT name AS label, uid FROM events WHERE id = ?', notFound: 'Etkinlik bulunamadı' },
  day: { days: 'id = ?', label: 'SELECT date AS label, uid FROM days WHERE id = ?', notFound: 'Gün bulunamadı' },
};

/** Sold tickets under the scope; thrown when the caller did not pass force:true. */
export class SoldConflict extends Error {
  constructor(sold) { super(`Bu kayıtta ${sold} satılmış bilet var; satış kayıtları da silinecek`); this.sold = sold; }
}

/**
 * Deletes a hall / event / day and everything under it (logs, tickets, day_versions, days, events) in one tx.
 * body {confirm, force}: confirm must equal the name (day: Istanbul 'DD.MM.YYYY HH:MM'); sold > 0 needs force:true
 * (else SoldConflict). Writes a tombstone per deleted syncable row. -> {deleted:{halls,events,days,tickets,logs}, sold}
 */
export async function deleteScope(db, kind, id, body) {
  const s = SCOPE[kind];
  const typed = typeof body?.confirm === 'string' ? body.confirm.trim() : '';
  if (!typed) throw httpError(400, 'Silmek için adı yazın');
  return tx(db, async (t) => {
    const r = await t.execute({ sql: s.label, args: [id] });
    if (!r.rows.length) throw httpError(404, s.notFound);
    const name = kind === 'day' ? istanbulLabel(r.rows[0].label) : r.rows[0].label;
    if (typed !== name.trim()) throw httpError(400, 'Yazdığınız ad eşleşmiyor');
    const dayIds = `SELECT id FROM days WHERE ${s.days}`;
    const sold = Number((await t.execute({ sql: `SELECT COUNT(*) AS n FROM tickets WHERE status = 2 AND day_id IN (${dayIds})`, args: [id] })).rows[0].n);
    if (sold > 0 && body?.force !== true) throw new SoldConflict(sold);
    const ts = now();
    const tomb = (tbl, where) => ({ sql: `INSERT OR REPLACE INTO tombstones (uid, tbl, deleted_at) SELECT uid, '${tbl}', ? FROM ${tbl} WHERE ${where}`, args: [ts, id] });
    const out = {};
    const steps = [
      ['logs', `day_id IN (${dayIds})`],
      ['tickets', `day_id IN (${dayIds})`],
      ['days', s.days],
      ...(kind !== 'day' ? [['events', kind === 'hall' ? 'hall_id = ?' : 'id = ?']] : []),
      ...(kind === 'hall' ? [['halls', 'id = ?']] : []),
    ];
    for (const [tbl, where] of steps) {
      await t.execute(tomb(tbl, where));
      if (tbl === 'days') await t.execute({ sql: `DELETE FROM day_versions WHERE day_id IN (${dayIds})`, args: [id] });
      out[tbl] = (await t.execute({ sql: `DELETE FROM ${tbl} WHERE ${where}`, args: [id] })).rowsAffected;
    }
    return { deleted: { halls: 0, events: 0, ...out }, sold, name };
  });
}

/**
 * Re-prices a day. Free tickets always take the new row price / tier; held and sold ones only when the caller says
 * so (body.held / body.sold = 'keep' (default) | 'apply'). Repricing sold tickets changes revenue and the report.
 * dryRun -> preview {free, held, sold, soldOld, soldNew} = tickets per status whose price/tier would change and the
 * old/new revenue of those sold ones; nothing is written. Otherwise one tx: tickets, tickets_dict, updated_at,
 * day_versions bump when anything changed. hall = halls row (seats JSON text). -> {changed, schema, preview, held, sold}
 */
const CHOICES = ['keep', 'apply'];
const STATUS_KEY = ['free', 'held', 'sold'];

export async function repriceDay(db, dayId, hall, body, { dryRun = false } = {}) {
  let prices, schema;
  try { ({ prices, schema } = readPrices(hall, body ?? {})); } catch (e) {
    if (e instanceof PriceError) throw httpError(400, e.message);
    throw e;
  }
  const choice = {};
  for (const k of ['held', 'sold']) {
    const v = body?.[k] ?? 'keep';
    if (!CHOICES.includes(v)) throw httpError(400, `"${k}" 'keep' ya da 'apply' olmalı`);
    choice[k] = v;
  }
  const seated = Object.keys(prices).length > 0;
  const tier = seated ? tiers(prices) : null;
  const target = (row) => {
    if (!seated) return [Number(schema), null];
    const price = prices[row];
    return price === undefined ? null : [price, tier.get(price)[0]];
  };
  return tx(db, async (t) => {
    const rows = (await t.execute({ sql: 'SELECT id, row, status, price, category FROM tickets WHERE day_id = ?', args: [dayId] })).rows;
    const preview = { free: 0, held: 0, sold: 0, soldOld: 0, soldNew: 0 };
    const todo = [];
    for (const r of rows) {
      const tg = target(r.row);
      if (!tg) continue;
      const [price, cat] = tg;
      if (Number(r.price) === price && (cat === null || Number(r.category) === cat)) continue;
      const key = STATUS_KEY[Number(r.status)];
      if (!key) continue;
      preview[key]++;
      if (key === 'sold') { preview.soldOld += Number(r.price); preview.soldNew += price; }
      if (key === 'free' || choice[key] === 'apply') todo.push([Number(r.id), price, cat]);
    }
    if (dryRun) return { preview, schema };
    const ts = now();
    // One UPDATE per (price, tier) chunk, not per ticket: a big hall on Turso would otherwise be hundreds of round
    // trips inside one interactive transaction (and risk its timeout).
    const groups = new Map();
    for (const [id, price, cat] of todo) {
      const k = `${price}|${cat}`;
      if (!groups.has(k)) groups.set(k, { price, cat, ids: [] });
      groups.get(k).ids.push(id);
    }
    const stmts = [];
    for (const { price, cat, ids } of groups.values()) {
      for (let i = 0; i < ids.length; i += 500) {
        const part = ids.slice(i, i + 500);
        const ph = part.map(() => '?').join(', ');
        stmts.push(cat === null
          ? { sql: `UPDATE tickets SET price = ?, updated_at = ? WHERE day_id = ? AND id IN (${ph})`, args: [price, ts, dayId, ...part] }
          : { sql: `UPDATE tickets SET price = ?, category = ?, updated_at = ? WHERE day_id = ? AND id IN (${ph})`, args: [price, cat, ts, dayId, ...part] });
      }
    }
    if (stmts.length) await t.batch(stmts);
    if (seated) {
      const dict = {};
      for (const [row, price] of Object.entries(prices)) dict[row] = { '-1': [price, tier.get(price)[1]] };
      await t.execute({ sql: 'UPDATE days SET tickets_dict = ?, updated_at = ? WHERE id = ?', args: [JSON.stringify(dict), ts, dayId] });
    } else {
      await t.execute({ sql: 'UPDATE days SET updated_at = ? WHERE id = ?', args: [ts, dayId] });
    }
    if (todo.length) await t.execute({ sql: 'INSERT INTO day_versions (day_id, version) VALUES (?, 1) ON CONFLICT(day_id) DO UPDATE SET version = version + 1', args: [dayId] });
    return { changed: todo.length, schema, preview, ...choice };
  });
}
