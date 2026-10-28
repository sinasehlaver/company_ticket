// Reservation core (port of views.get_day/reserve_toggle/reserve/dereserve/sell/cancel/cancel_count/get_log/lookup_log).
// Every state change is one conditional UPDATE (or one write tx for sell/cancel) + a day_versions bump in the
// same batch/tx, so GET /state can answer 204 cheaply. Functions throw httpError; conflicts throw Conflict
// (routes turn it into 409 {error, state}).
import { now, newUid, tx } from './db.js';
import { httpError, RANK } from './auth.js';
import { one, json } from './routes/util.js';

export const FREE = 0, HELD = 1, SOLD = 2;

/** 409 carrying a message; the route adds fresh state. */
export class Conflict extends Error {
  constructor(message) { super(message); this.name = 'Conflict'; }
}

// Bumps the day's counter iff the previous statement in the same batch/tx changed rows.
const bump = (dayId) => ({
  sql: 'INSERT INTO day_versions (day_id, version) SELECT ?, 1 WHERE changes() > 0 ON CONFLICT(day_id) DO UPDATE SET version = version + 1',
  args: [dayId],
});

/** -> {id, uid, date, eventId, eventName, hallId, hallName, kind:'seated'|'count', ticketsDict, seats} or 404 */
export async function loadDay(db, id) {
  const d = await one(db, `SELECT d.id, d.uid, d.date, d.tickets_dict, e.id AS event_id, e.name AS event_name, h.id AS hall_id, h.name AS hall_name, h.seats
    FROM days d JOIN events e ON e.id = d.event_id JOIN halls h ON h.id = e.hall_id WHERE d.id = ?`, [id], 'Gün bulunamadı');
  const seats = json(d.seats);
  return {
    id: Number(d.id), uid: d.uid, date: d.date, eventId: Number(d.event_id), eventName: d.event_name,
    hallId: Number(d.hall_id), hallName: d.hall_name, kind: Array.isArray(seats.all) ? 'seated' : 'count',
    ticketsDict: json(d.tickets_dict), seats,
  };
}

/** Days of the same event ordered by date: [{id, date}]. */
export async function siblingDays(db, eventId) {
  const r = await db.execute({ sql: 'SELECT id, date FROM days WHERE event_id = ? ORDER BY date, id', args: [eventId] });
  return r.rows.map((x) => ({ id: Number(x.id), date: x.date }));
}

const VERSION_SQL = `SELECT COALESCE((SELECT version FROM day_versions WHERE day_id = ?1), 0) AS v,
  COALESCE((SELECT MAX(updated_at) FROM tickets WHERE day_id = ?1), '') AS m, (SELECT COUNT(*) FROM tickets WHERE day_id = ?1) AS n`;
// counter + newest ticket updated_at + ticket count: also changes on import/merge (phase 5) or a counter reset.
const versionOf = (row) => `${Number(row.v)}.${row.m ? Date.parse(row.m) : 0}.${Number(row.n)}`;

/** Change marker for the day's tickets. */
export async function dayVersion(db, dayId) {
  return versionOf((await db.execute({ sql: VERSION_SQL, args: [dayId] })).rows[0]);
}

/**
 * Seat-map state for user. seats: [id, row, num, price, category, status, mine, holder] (holder = username of
 * the holder/seller for baskan+, else null). mine = held by user. sold = {count, revenue} for baskan+, else null.
 */
export async function dayState(db, dayId, user) {
  const [v, t] = await db.batch([
    { sql: VERSION_SQL, args: [dayId] },
    { sql: 'SELECT t.id, t.row, t.num, t.price, t.category, t.status, t.owner, u.username FROM tickets t LEFT JOIN users u ON u.id = t.owner WHERE t.day_id = ? ORDER BY t.id', args: [dayId] },
  ], 'read');
  const boss = RANK[user.role] >= RANK.baskan;
  const seats = [];
  const mine = { count: 0, total: 0, list: [] };
  let free = 0, soldCount = 0, revenue = 0;
  const holders = new Map(); // owner id -> {userId, username, count}
  for (const r of t.rows) {
    const id = Number(r.id), price = Number(r.price), status = Number(r.status);
    const isMine = status === HELD && Number(r.owner) === user.id;
    seats.push([id, r.row, r.num, price, Number(r.category), status, isMine, boss && status !== FREE ? r.username ?? null : null]);
    if (status === FREE) free++;
    else if (status === SOLD) { soldCount++; revenue += price; }
    else if (boss && r.owner !== null) {
      const k = Number(r.owner);
      const h = holders.get(k) ?? { userId: k, username: r.username ?? '?', count: 0 };
      h.count++;
      holders.set(k, h);
    }
    if (isMine) { mine.count++; mine.total += price; mine.list.push({ id, row: r.row, num: r.num, price }); }
  }
  return {
    version: versionOf(v.rows[0]), seats, mine, free, sold: boss ? { count: soldCount, revenue } : null,
    holders: boss ? [...holders.values()].sort((a, b) => b.count - a.count || a.username.localeCompare(b.username)) : null,
  };
}

const ticketId = (v) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) throw httpError(400, 'Geçersiz bilet');
  return n;
};

const needKind = (day, kind) => {
  if (day.kind !== kind) throw httpError(400, kind === 'count' ? 'Bu gün numaralı koltuklu; koltuk seçin' : 'Bu gün numarasız; + / − kullanın');
};

/** Seated click (F8): free -> held by me; held by me -> free. -> 'held' | 'released'. Others' / sold -> Conflict; other day -> 404. */
export async function toggleSeat(db, day, user, rawId) {
  needKind(day, 'seated');
  const id = ticketId(rawId);
  const ts = now();
  const [h] = await db.batch([
    { sql: 'UPDATE tickets SET status = 1, owner = ?, last_modified_by = ?, updated_at = ? WHERE id = ? AND day_id = ? AND status = 0', args: [user.id, user.username, ts, id, day.id] },
    bump(day.id),
  ], 'write');
  if (h.rowsAffected === 1) return 'held';
  const [u] = await db.batch([
    { sql: 'UPDATE tickets SET status = 0, owner = NULL, last_modified_by = ?, updated_at = ? WHERE id = ? AND day_id = ? AND status = 1 AND owner = ?', args: [user.username, ts, id, day.id, user.id] },
    bump(day.id),
  ], 'write');
  if (u.rowsAffected === 1) return 'released';
  const r = await db.execute({ sql: 'SELECT status FROM tickets WHERE id = ? AND day_id = ?', args: [id, day.id] });
  if (!r.rows.length) throw httpError(404, 'Bu günde böyle bir koltuk yok');
  if (Number(r.rows[0].status) === SOLD) throw new Conflict('Bu koltuk satıldı');
  if (Number(r.rows[0].status) === HELD) throw new Conflict('Bu koltuğu başkası tuttu');
  throw new Conflict('Koltuk o sırada değişti, tekrar deneyin'); // freed between the two statements
}

/** Count hall + (F11): holds the lowest-id free ticket. */
export async function countHold(db, day, user) {
  needKind(day, 'count');
  const [h] = await db.batch([
    { sql: `UPDATE tickets SET status = 1, owner = ?, last_modified_by = ?, updated_at = ?
      WHERE id = (SELECT id FROM tickets WHERE day_id = ? AND status = 0 ORDER BY id LIMIT 1) AND status = 0`, args: [user.id, user.username, now(), day.id] },
    bump(day.id),
  ], 'write');
  if (h.rowsAffected !== 1) throw new Conflict('Boş bilet kalmadı');
}

/** Count hall − (F11): frees my most recently numbered held ticket. */
export async function countRelease(db, day, user) {
  needKind(day, 'count');
  const [h] = await db.batch([
    { sql: `UPDATE tickets SET status = 0, owner = NULL, last_modified_by = ?, updated_at = ?
      WHERE id = (SELECT id FROM tickets WHERE day_id = ? AND status = 1 AND owner = ? ORDER BY id DESC LIMIT 1) AND status = 1 AND owner = ?`, args: [user.username, now(), day.id, user.id, user.id] },
    bump(day.id),
  ], 'write');
  if (h.rowsAffected !== 1) throw new Conflict('Tuttuğunuz bilet yok');
}

const userId = (v) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) throw httpError(400, 'Geçersiz kullanıcı');
  return n;
};

/**
 * Başkan release (baskan+): body {ticketId} frees one held seat whoever holds it; {userId, count?} frees all
 * (or the newest `count`) of that user's holds on the day. -> {released, holder}. Not held -> Conflict.
 * Writes audit 'hold.release' (holds are not in `logs`) and bumps day_versions in the same tx.
 */
export async function releaseHold(db, day, actor, body) {
  const byTicket = body?.ticketId !== undefined;
  const id = byTicket ? ticketId(body.ticketId) : userId(body?.userId);
  let limit = null;
  if (!byTicket && body?.count !== undefined) {
    limit = body.count;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20000) throw httpError(400, 'Bırakılacak bilet sayısı 1 veya daha büyük bir tam sayı olmalı');
  }
  return tx(db, async (t) => {
    let holder, n;
    const ts = now();
    if (byTicket) {
      const r = await t.execute({ sql: 'SELECT t.status, u.username FROM tickets t LEFT JOIN users u ON u.id = t.owner WHERE t.id = ? AND t.day_id = ?', args: [id, day.id] });
      if (!r.rows.length) throw httpError(404, 'Bu günde böyle bir koltuk yok');
      if (Number(r.rows[0].status) !== HELD) throw new Conflict('Bu koltuk artık tutulmuyor');
      holder = r.rows[0].username ?? '?';
      n = (await t.execute({ sql: 'UPDATE tickets SET status = 0, owner = NULL, last_modified_by = ?, updated_at = ? WHERE id = ? AND day_id = ? AND status = 1', args: [actor.username, ts, id, day.id] })).rowsAffected;
    } else {
      const u = await t.execute({ sql: 'SELECT username FROM users WHERE id = ?', args: [id] });
      holder = u.rows[0]?.username ?? '?';
      n = (await t.execute({
        sql: `UPDATE tickets SET status = 0, owner = NULL, last_modified_by = ?, updated_at = ? WHERE day_id = ? AND status = 1 AND owner = ?
          ${limit ? 'AND id IN (SELECT id FROM tickets WHERE day_id = ? AND status = 1 AND owner = ? ORDER BY id DESC LIMIT ?)' : ''}`,
        args: limit ? [actor.username, ts, day.id, id, day.id, id, limit] : [actor.username, ts, day.id, id],
      })).rowsAffected;
    }
    if (!n) throw new Conflict(byTicket ? 'Bu koltuk artık tutulmuyor' : 'Bu kullanıcının tuttuğu bilet yok');
    await t.execute({ sql: 'INSERT INTO day_versions (day_id, version) VALUES (?, 1) ON CONFLICT(day_id) DO UPDATE SET version = version + 1', args: [day.id] });
    await t.execute({ sql: 'INSERT INTO audit (at, username, action, detail) VALUES (?, ?, ?, ?)', args: [ts, actor.username, 'hold.release', JSON.stringify({ dayId: day.id, holder, count: n, ...(byTicket ? { ticketId: id } : { userId: id }) })] });
    return { released: n, holder };
  });
}

const STALE = 'Tuttuğunuz koltuklar değişti, listeyi kontrol edin';
const seatOut = (r) => ({ row: r.row, num: r.num, price: Number(r.price) });
const logInsert = (rows, dayId, action, username, at) => ({
  sql: `INSERT INTO logs (uid, ticket_id, day_id, action, username, at) VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
  args: rows.flatMap((r) => [newUid(), Number(r.id), dayId, action, username, at]),
});

/** Sell (F9): sells exactly ticketIds, which must equal my held set on the day. -> {sold:[{row,num,price}], total} */
export async function sell(db, day, user, rawIds) {
  if (!Array.isArray(rawIds)) throw httpError(400, 'Satılacak koltuk yok');
  if (!rawIds.length) throw httpError(400, 'Satılacak koltuk yok');
  if (rawIds.length > 20000) throw httpError(400, 'Geçersiz bilet listesi');
  const ids = rawIds.map(ticketId);
  if (new Set(ids).size !== ids.length) throw httpError(400, 'Geçersiz bilet listesi');
  return tx(db, async (t) => {
    const held = await t.execute({ sql: 'SELECT id FROM tickets WHERE day_id = ? AND status = 1 AND owner = ?', args: [day.id, user.id] });
    const heldIds = new Set(held.rows.map((r) => Number(r.id)));
    if (heldIds.size !== ids.length || !ids.every((i) => heldIds.has(i))) throw new Conflict(STALE);
    const ts = now();
    const ph = ids.map(() => '?').join(', ');
    const upd = await t.execute({
      sql: `UPDATE tickets SET status = 2, last_modified_by = ?, updated_at = ? WHERE day_id = ? AND status = 1 AND owner = ? AND id IN (${ph}) RETURNING id, row, num, price`,
      args: [user.username, ts, day.id, user.id, ...ids],
    });
    if (upd.rows.length !== ids.length) throw new Conflict(STALE); // tx() rolls back
    const rows = [...upd.rows].sort((a, b) => Number(a.id) - Number(b.id));
    await t.execute(logInsert(rows, day.id, 'satış', user.username, ts));
    await t.execute({ sql: 'INSERT INTO day_versions (day_id, version) VALUES (?, 1) ON CONFLICT(day_id) DO UPDATE SET version = version + 1', args: [day.id] });
    const sold = rows.map(seatOut);
    return { sold, total: sold.reduce((s, x) => s + x.price, 0) };
  });
}

const SEAT = /^([a-zA-Z])-([0-9A-Za-z]{1,10})$/;
const label = (row, num) => `${row.toUpperCase()}-${num}`;

/** 'a-32' / 'A-32' -> {row:'a', num:'32'} | null. */
export function parseSeat(token) {
  const m = SEAT.exec(token);
  return m ? { row: m[1].toLowerCase(), num: m[2] } : null;
}

/**
 * Strict cancel list: 'a-32, B-25' -> [{row,num}]. Throws 400 listing every bad token, grouped.
 * Empty items (trailing / double comma) and duplicates are errors.
 */
export function parseSeatList(text) {
  if (typeof text !== 'string' || !text.trim()) throw httpError(400, 'İptal edilecek koltukları girin (ör. a-32, b-25)');
  if (text.length > 20000) throw httpError(400, 'Liste çok uzun');
  const bad = [], dup = [], seen = new Set(), out = [];
  for (const raw of text.split(',')) {
    const tok = raw.trim();
    const s = parseSeat(tok);
    if (!s) { bad.push(tok ? `"${tok}"` : '(boş)'); continue; }
    const key = `${s.row}-${s.num}`;
    if (seen.has(key)) { if (!dup.includes(label(s.row, s.num))) dup.push(label(s.row, s.num)); continue; }
    seen.add(key);
    out.push(s);
  }
  const msg = [bad.length && `Anlaşılmayan: ${bad.join(', ')}`, dup.length && `Tekrarlanan: ${dup.join(', ')}`].filter(Boolean);
  if (msg.length) throw httpError(400, msg.join(' · '));
  return out;
}

/** Count-hall cancel N: integer 1..soldCount (number or digit string). */
function cancelCount(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d{1,6}\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 1) throw httpError(400, 'İptal edilecek bilet sayısı 1 veya daha büyük bir tam sayı olmalı');
  return n;
}

/**
 * Cancel sales (F10, baskan+). seated body {tickets:'a-32, b-25'}, count body {count:N}. All-or-nothing.
 * -> {cancelled:[{row,num,price}]}. Sold tickets -> free, owner NULL, last_modified_by = canceller, 'satış iptal' log each.
 */
export async function cancel(db, day, user, body) {
  const seated = day.kind === 'seated';
  const seats = seated ? parseSeatList(body?.tickets) : null;
  const n = seated ? 0 : cancelCount(body?.count);
  return tx(db, async (t) => {
    let rows;
    if (seated) {
      const r = await t.execute({
        sql: `SELECT id, row, num, price, status FROM tickets WHERE day_id = ? AND (${seats.map(() => '(row = ? AND num = ?)').join(' OR ')})`,
        args: [day.id, ...seats.flatMap((s) => [s.row, s.num])],
      });
      const byKey = new Map(r.rows.map((x) => [`${x.row}-${x.num}`, x]));
      const missing = [], unsold = [];
      rows = [];
      for (const s of seats) {
        const x = byKey.get(`${s.row}-${s.num}`);
        if (!x) missing.push(label(s.row, s.num));
        else if (Number(x.status) !== SOLD) unsold.push(label(s.row, s.num));
        else rows.push(x);
      }
      const msg = [missing.length && `Bu günde yok: ${missing.join(', ')}`, unsold.length && `Satılmamış: ${unsold.join(', ')}`].filter(Boolean);
      if (msg.length) throw httpError(400, msg.join(' · '));
    } else {
      const sold = Number((await t.execute({ sql: 'SELECT COUNT(*) AS n FROM tickets WHERE day_id = ? AND status = 2', args: [day.id] })).rows[0].n);
      if (n > sold) throw httpError(400, sold ? `En fazla ${sold} bilet iptal edilebilir` : 'Bu günde satılmış bilet yok');
      rows = (await t.execute({ sql: 'SELECT id, row, num, price FROM tickets WHERE day_id = ? AND status = 2 ORDER BY updated_at DESC, id DESC LIMIT ?', args: [day.id, n] })).rows;
    }
    const ts = now();
    const ids = rows.map((x) => Number(x.id));
    const upd = await t.execute({
      sql: `UPDATE tickets SET status = 0, owner = NULL, last_modified_by = ?, updated_at = ? WHERE day_id = ? AND status = 2 AND id IN (${ids.map(() => '?').join(', ')})`,
      args: [user.username, ts, day.id, ...ids],
    });
    if (upd.rowsAffected !== ids.length) throw new Conflict('Biletler o sırada değişti, tekrar deneyin');
    await t.execute(logInsert(rows, day.id, 'satış iptal', user.username, ts));
    await t.execute({ sql: 'INSERT INTO day_versions (day_id, version) VALUES (?, 1) ON CONFLICT(day_id) DO UPDATE SET version = version + 1', args: [day.id] });
    await t.execute({ sql: 'INSERT INTO audit (at, username, action, detail) VALUES (?, ?, ?, ?)', args: [ts, user.username, 'sale.cancel', JSON.stringify({ dayId: day.id, seats: rows.map((x) => label(x.row, x.num)) })] });
    return { cancelled: rows.map(seatOut) };
  });
}

/** Day log newest first (F12). seat = 'a-12' narrows to that seat (unknown -> 404, unparseable -> 400). */
export async function dayLogs(db, day, seat) {
  let ticket = null;
  if (seat !== undefined && seat !== '') {
    const s = typeof seat === 'string' ? parseSeat(seat.trim()) : null;
    if (!s) throw httpError(400, `Anlaşılmayan koltuk: "${String(seat)}" (ör. a-12)`);
    const r = await db.execute({ sql: 'SELECT id, row, num FROM tickets WHERE day_id = ? AND row = ? AND num = ?', args: [day.id, s.row, s.num] });
    if (!r.rows.length) throw httpError(404, 'Bu günde böyle bir koltuk yok');
    ticket = r.rows[0];
  }
  const r = await db.execute({
    sql: `SELECT l.at, l.action, l.username, t.row, t.num, t.price FROM logs l JOIN tickets t ON t.id = l.ticket_id
      WHERE l.day_id = ? ${ticket ? 'AND l.ticket_id = ?' : ''} ORDER BY l.at DESC, l.id DESC`,
    args: ticket ? [day.id, ticket.id] : [day.id],
  });
  return {
    seat: ticket ? `${ticket.row}-${ticket.num}` : null,
    logs: r.rows.map((x) => ({ at: x.at, action: x.action, username: x.username, row: x.row, num: x.num, price: Number(x.price) })),
  };
}
