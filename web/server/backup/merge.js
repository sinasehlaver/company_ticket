// Newer-wins merge of a validated backup file into the live DB (PORT_PLAN backup step 6), and the full replace used by
// snapshot restore. The file is read with node:sqlite (read-only, separate connection); live is read and written inside
// ONE libsql write transaction. Rows match by uid (users by username); integer FKs are re-mapped through uid
// subqueries, so the statement list can be sent in batches (one round trip per chunk on Turso).
//
// Rules (tests: server/backup.test.js):
// - only in file -> insert (unless a live tombstone is at least as new -> skipped 'deleted'; a newer row resurrects)
// - in both -> file.updated_at > live.updated_at wins the whole row; tie or older -> live kept
// - file tombstone -> deletes the live row (and everything under it) only when newer than the row AND all of its
//   descendants; else skipped 'live-newer'. Superuser (and CLI) imports only: a başkan import skips the delete
//   ('needs-superuser', warning deletesNeedSuperuser)
// - tickets: a live sold ticket never reverts to free/held, whatever the file says ('sold-kept', listed per day in
//   warning soldCancelledInFile for a manual cancel); file holds arrive
//   as free (a hold is a live desk session, never restored)
// - logs: append-only union by uid
// - users: by username; the importer's own row is never touched ('own-account'); a başkan importer can only add or
//   change sales accounts (mirrors in-app account rules; 'needs-superuser'); a changed hash/role/disabled kills
//   that user's sessions; sessions are never imported
// - any held seat in live blocks the whole import (HoldsConflict -> 409), re-checked inside the write tx
import { DatabaseSync } from 'node:sqlite';
import { tx, newUid } from '../db.js';
import { ROLES } from '../auth.js';

export const TABLES = ['halls', 'events', 'days', 'users', 'tickets', 'logs'];
const SYNC_TOMB = ['halls', 'events', 'days', 'tickets', 'logs'];
const PARENT_FIRST = ['halls', 'events', 'days', 'tickets', 'logs'];
const CHUNK = 200;
const TS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

const READ = {
  halls: 'SELECT uid, name, seats, seat_plan, price_schema, updated_at FROM halls',
  events: 'SELECT e.uid, e.name, h.uid AS hall_uid, e.updated_at FROM events e LEFT JOIN halls h ON h.id = e.hall_id',
  days: 'SELECT d.uid, ev.uid AS event_uid, d.date, d.tickets_dict, d.updated_at FROM days d LEFT JOIN events ev ON ev.id = d.event_id',
  users: 'SELECT uid, username, hash, role, disabled, updated_at, created_at FROM users',
  tickets: `SELECT t.uid, d.uid AS day_uid, t.row, t.num, t.price, t.category, t.status, u.username AS owner_name, t.last_modified_by, t.updated_at
    FROM tickets t LEFT JOIN days d ON d.id = t.day_id LEFT JOIN users u ON u.id = t.owner`,
  logs: `SELECT l.uid, tk.uid AS ticket_uid, d.uid AS day_uid, l.action, l.username, l.at
    FROM logs l LEFT JOIN tickets tk ON tk.id = l.ticket_id LEFT JOIN days d ON d.id = l.day_id`,
  tombstones: 'SELECT uid, tbl, deleted_at FROM tombstones',
};

/** Seats held right now, per day. -> [{dayId, date, event, count}] */
export async function liveHolds(exec) {
  const r = await exec.execute(`SELECT d.id AS day_id, d.date, e.name AS event, COUNT(*) AS n FROM tickets t
    JOIN days d ON d.id = t.day_id JOIN events e ON e.id = d.event_id WHERE t.status = 1 GROUP BY d.id ORDER BY d.date`);
  return r.rows.map((x) => ({ dayId: Number(x.day_id), date: x.date, event: x.event, count: Number(x.n) }));
}

export class HoldsConflict extends Error {
  constructor(holds) {
    const n = holds.reduce((s, h) => s + h.count, 0);
    super(`Şu an ${n} koltuk tutuluyor (${holds.length} gün). Tutulan koltuklar satılmadan ya da bırakılmadan içe aktarma yapılamaz.`);
    this.holds = holds;
  }
}

async function assertNoHolds(exec) {
  const holds = await liveHolds(exec);
  if (holds.length) throw new HoldsConflict(holds);
}

/** All rows of the backup file, via a read-only node:sqlite connection. */
export function readFileData(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const out = {};
    for (const [k, sql] of Object.entries(READ)) out[k] = db.prepare(sql).all().map((r) => ({ ...r }));
    return out;
  } finally { db.close(); }
}

export async function readLiveData(exec) {
  const out = {};
  for (const [k, sql] of Object.entries(READ)) out[k] = (await exec.execute(sql)).rows.map((r) => ({ ...r }));
  return out;
}

/** Row counts for the diff dialog: file vs live. */
export function countsOf(data) {
  const by = (s) => data.tickets.filter((t) => Number(t.status) === s).length;
  return { halls: data.halls.length, events: data.events.length, days: data.days.length, users: data.users.length,
    tickets: data.tickets.length, ticketsFree: by(0), ticketsHeld: by(1), ticketsSold: by(2), logs: data.logs.length };
}

const str = (v, max = 1e6) => typeof v === 'string' && v.length > 0 && v.length <= max;
const int = (v) => Number.isInteger(Number(v)) && v !== null && v !== '';
const VALID = {
  halls: (r) => str(r.uid, 100) && str(r.name, 1000) && str(r.seats) && typeof r.seat_plan === 'string' && typeof r.price_schema === 'string' && TS.test(r.updated_at),
  events: (r) => str(r.uid, 100) && str(r.name, 1000) && TS.test(r.updated_at),
  days: (r) => str(r.uid, 100) && str(r.date, 40) && typeof r.tickets_dict === 'string' && TS.test(r.updated_at),
  users: (r) => str(r.uid, 100) && str(r.username, 150) && str(r.hash, 500) && ROLES.includes(r.role) && [0, 1].includes(Number(r.disabled)) && TS.test(r.updated_at) && str(r.created_at, 40),
  tickets: (r) => str(r.uid, 100) && str(r.row, 20) && typeof r.num === 'string' && r.num.length <= 20 && int(r.price) && int(r.category) && [0, 1, 2].includes(Number(r.status)) && typeof r.last_modified_by === 'string' && TS.test(r.updated_at),
  logs: (r) => str(r.uid, 100) && ['satış', 'satış iptal'].includes(r.action) && typeof r.username === 'string' && TS.test(r.at),
  tombstones: (r) => str(r.uid, 100) && SYNC_TOMB.includes(r.tbl) && TS.test(r.deleted_at),
};

const stamp = (tbl, r) => (tbl === 'logs' ? r.at : r.updated_at);
const TOMB_UPSERT = `INSERT INTO tombstones (uid, tbl, deleted_at) VALUES (?, ?, ?)
  ON CONFLICT(tbl, uid) DO UPDATE SET deleted_at = excluded.deleted_at WHERE excluded.deleted_at > tombstones.deleted_at`;

/**
 * Pure: live + file data -> {report, warnings, stmts, touchedDays}. importer = {username, role} | null (CLI = superuser rights).
 * report[table] = {added, updated, deleted, kept, skipped:{reason:n}}; report.tombstones = {added}.
 */
export function planMerge(live, file, importer = null) {
  const report = Object.fromEntries(TABLES.map((t) => [t, { added: 0, updated: 0, deleted: 0, kept: 0, skipped: {} }]));
  report.tombstones = { added: 0 };
  const skip = (tbl, reason) => { report[tbl].skipped[reason] = (report[tbl].skipped[reason] || 0) + 1; };
  const warn = {};
  const del = []; const ups = []; const tombs = []; const touchedDays = new Set();
  const index = (rows, key = 'uid') => new Map(rows.map((r) => [r[key], r]));
  const L = Object.fromEntries(TABLES.map((t) => [t, index(live[t], t === 'users' ? 'username' : 'uid')]));
  const liveTomb = new Map(live.tombstones.map((r) => [`${r.tbl}:${r.uid}`, r.deleted_at]));
  const future = new Date(Date.now() + 86400000).toISOString();

  // file rows, validated + de-duplicated (first wins)
  const F = {};
  for (const t of [...TABLES, 'tombstones']) {
    const seen = new Set(); F[t] = [];
    for (const r of file[t]) {
      const tbl = t === 'tombstones' ? 'tombstones' : t;
      if (!VALID[tbl](r)) { if (t !== 'tombstones') skip(t, 'invalid'); continue; }
      const k = t === 'tombstones' ? `${r.tbl}:${r.uid}` : t === 'users' ? r.username : r.uid;
      if (seen.has(k)) { if (t !== 'tombstones') skip(t, 'invalid'); continue; }
      seen.add(k); F[t].push(r);
      if (stamp(t, r) > future || (t === 'tombstones' && r.deleted_at > future)) warn.futureDates = (warn.futureDates || 0) + 1;
    }
  }

  // live tree (for cascades and the "newer than every descendant" check)
  const kids = { halls: new Map(), events: new Map(), days: new Map(), tickets: new Map() };
  const push = (m, k, v) => { if (k == null) return; if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const e of live.events) push(kids.halls, e.hall_uid, ['events', e]);
  for (const d of live.days) push(kids.events, d.event_uid, ['days', d]);
  for (const t of live.tickets) push(kids.days, t.day_uid, ['tickets', t]);
  for (const l of live.logs) { if (l.ticket_uid) push(kids.tickets, l.ticket_uid, ['logs', l]); else push(kids.days, l.day_uid, ['logs', l]); }
  const subtree = (tbl, row, acc = []) => {
    acc.push([tbl, row]);
    for (const [ct, c] of kids[tbl]?.get(row.uid) || []) subtree(ct, c, acc);
    return acc;
  };

  const boss = !importer || importer.role === 'superuser'; // the CLI (importer null) counts as superuser

  // 1. file tombstones -> deletes of live rows (children first in the statement list); superuser imports only
  const dead = new Set(); // `${tbl}:${uid}` removed from live by this merge
  const tombByTbl = Object.fromEntries(SYNC_TOMB.map((t) => [t, []]));
  for (const tb of F.tombstones) tombByTbl[tb.tbl].push(tb);
  const delRows = Object.fromEntries(SYNC_TOMB.map((t) => [t, []]));
  for (const tbl of PARENT_FIRST) {
    for (const tb of tombByTbl[tbl]) {
      const key = `${tbl}:${tb.uid}`;
      const row = L[tbl].get(tb.uid);
      if (dead.has(key)) { tombs.push([tb.uid, tbl, tb.deleted_at]); continue; } // cascaded already; upsert keeps the newest
      if (!row) {
        if (!liveTomb.has(key) || tb.deleted_at > liveTomb.get(key)) { tombs.push([tb.uid, tbl, tb.deleted_at]); if (!liveTomb.has(key)) report.tombstones.added++; }
        continue;
      }
      const tree = subtree(tbl, row);
      if (tree.every(([t, r]) => tb.deleted_at > stamp(t, r))) {
        if (!boss) { skip(tbl, 'needs-superuser'); warn.deletesNeedSuperuser = (warn.deletesNeedSuperuser || 0) + 1; continue; }
        for (const [t, r] of tree) {
          const k = `${t}:${r.uid}`;
          if (dead.has(k)) continue;
          dead.add(k); delRows[t].push(r); report[t].deleted++;
          if (t === 'tickets' && Number(r.status) === 2) warn.soldDeleted = (warn.soldDeleted || 0) + 1;
          tombs.push([r.uid, t, tb.deleted_at]);
          if (!liveTomb.has(k)) report.tombstones.added++;
        }
      } else skip(tbl, 'live-newer');
    }
  }
  for (const t of [...PARENT_FIRST].reverse()) {
    for (const r of delRows[t]) {
      if (t === 'days') del.push({ sql: 'DELETE FROM day_versions WHERE day_id = (SELECT id FROM days WHERE uid = ?)', args: [r.uid] });
      if (t === 'tickets' && r.day_uid && !dead.has(`days:${r.day_uid}`)) touchedDays.add(r.day_uid);
      del.push({ sql: `DELETE FROM ${t} WHERE uid = ?`, args: [r.uid] });
    }
  }

  // rows that exist after the merge, per table (live minus dead, plus inserted)
  const exists = Object.fromEntries(PARENT_FIRST.map((t) => [t, new Set(live[t].map((r) => r.uid).filter((u) => !dead.has(`${t}:${u}`)))]));
  const liveRow = (t, uid) => (dead.has(`${t}:${uid}`) ? null : L[t].get(uid));
  const insertable = (t, r) => {
    const k = `${t}:${r.uid}`;
    if (liveTomb.has(k) && liveTomb.get(k) >= stamp(t, r)) { skip(t, 'deleted'); return false; }
    if (liveTomb.has(k)) ups.push({ sql: 'DELETE FROM tombstones WHERE tbl = ? AND uid = ?', args: [t, r.uid] }); // newer row resurrects
    return true;
  };

  // 2. halls / events / days
  // Parents never move (an event keeps its hall, a day its event, as in the app), so an update leaves the FK alone;
  // the parent only matters for an insert.
  const sync = (tbl, r, parent, update, insert) => {
    const l = liveRow(tbl, r.uid);
    if (l) {
      if (stamp(tbl, r) > stamp(tbl, l)) { ups.push(update); report[tbl].updated++; return 'updated'; }
      report[tbl].kept++; return 'kept';
    }
    if (L[tbl].has(r.uid)) { skip(tbl, 'deleted'); return null; } // deleted by a file tombstone in this merge
    if (parent && !exists[parent[0]].has(parent[1])) { skip(tbl, 'orphan'); return null; }
    if (!insertable(tbl, r)) return null;
    ups.push(insert); exists[tbl].add(r.uid); report[tbl].added++; return 'added';
  };
  for (const h of F.halls) {
    sync('halls', h, null,
      { sql: 'UPDATE halls SET name = ?, seats = ?, seat_plan = ?, price_schema = ?, updated_at = ? WHERE uid = ?', args: [h.name, h.seats, h.seat_plan, h.price_schema, h.updated_at, h.uid] },
      { sql: 'INSERT INTO halls (uid, name, seats, seat_plan, price_schema, updated_at) VALUES (?, ?, ?, ?, ?, ?)', args: [h.uid, h.name, h.seats, h.seat_plan, h.price_schema, h.updated_at] });
  }
  for (const e of F.events) {
    sync('events', e, ['halls', e.hall_uid],
      { sql: 'UPDATE events SET name = ?, updated_at = ? WHERE uid = ?', args: [e.name, e.updated_at, e.uid] },
      { sql: 'INSERT INTO events (uid, name, hall_id, updated_at) VALUES (?, ?, (SELECT id FROM halls WHERE uid = ?), ?)', args: [e.uid, e.name, e.hall_uid, e.updated_at] });
  }
  for (const d of F.days) {
    const did = sync('days', d, ['events', d.event_uid],
      { sql: 'UPDATE days SET date = ?, tickets_dict = ?, updated_at = ? WHERE uid = ?', args: [d.date, d.tickets_dict, d.updated_at, d.uid] },
      { sql: 'INSERT INTO days (uid, event_id, date, tickets_dict, updated_at) VALUES (?, (SELECT id FROM events WHERE uid = ?), ?, ?, ?)', args: [d.uid, d.event_uid, d.date, d.tickets_dict, d.updated_at] });
    if (did === 'updated') touchedDays.add(d.uid);
  }

  // 3. users (by username)
  const liveUids = new Set(live.users.map((u) => u.uid));
  for (const u of F.users) {
    const l = L.users.get(u.username);
    if (importer && u.username === importer.username) { skip('users', 'own-account'); continue; }
    if (l && !(u.updated_at > l.updated_at)) { report.users.kept++; continue; }
    if (!boss && (u.role !== 'sales' || (l && l.role !== 'sales'))) { skip('users', 'needs-superuser'); continue; }
    if (l) {
      ups.push({ sql: 'UPDATE users SET hash = ?, role = ?, disabled = ?, updated_at = ? WHERE username = ?', args: [u.hash, u.role, Number(u.disabled), u.updated_at, u.username] });
      if (u.hash !== l.hash || u.role !== l.role || Number(u.disabled) !== Number(l.disabled)) {
        ups.push({ sql: 'DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)', args: [u.username] });
      }
      report.users.updated++;
    } else {
      const uid = liveUids.has(u.uid) ? newUid() : u.uid;
      liveUids.add(uid);
      ups.push({ sql: 'INSERT INTO users (uid, username, hash, role, disabled, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [uid, u.username, u.hash, u.role, Number(u.disabled), u.updated_at, u.created_at] });
      report.users.added++;
    }
  }

  // 4. tickets
  const seatKey = (t) => `${t.day_uid}|${t.row}|${t.num}`;
  const seats = new Set(live.tickets.filter((t) => !dead.has(`tickets:${t.uid}`)).map(seatKey));
  const soldKept = []; // live sales the file (newer) shows cancelled: never un-sold, listed for a manual cancel
  for (const t of F.tickets) {
    let status = Number(t.status);
    if (status === 1) { status = 0; warn.holdsDropped = (warn.holdsDropped || 0) + 1; }
    const owner = status === 2 ? t.owner_name ?? null : null;
    const l = liveRow('tickets', t.uid);
    if (l) {
      if (!(t.updated_at > l.updated_at)) { report.tickets.kept++; continue; }
      if (Number(l.status) === 2 && status !== 2) { skip('tickets', 'sold-kept'); soldKept.push(l); continue; }
      ups.push({ sql: 'UPDATE tickets SET price = ?, category = ?, status = ?, owner = (SELECT id FROM users WHERE username = ?), last_modified_by = ?, updated_at = ? WHERE uid = ?',
        args: [Number(t.price), Number(t.category), status, owner, t.last_modified_by, t.updated_at, t.uid] });
      report.tickets.updated++; touchedDays.add(l.day_uid);
    } else if (L.tickets.has(t.uid)) {
      skip('tickets', 'deleted'); // deleted by a file tombstone in this merge
    } else {
      if (!exists.days.has(t.day_uid)) { skip('tickets', 'orphan'); continue; }
      if (seats.has(seatKey(t))) { skip('tickets', 'conflict'); continue; }
      if (!insertable('tickets', t)) continue;
      ups.push({ sql: `INSERT INTO tickets (uid, day_id, event_id, row, num, price, category, status, owner, last_modified_by, updated_at)
        SELECT ?, d.id, d.event_id, ?, ?, ?, ?, ?, (SELECT id FROM users WHERE username = ?), ?, ? FROM days d WHERE d.uid = ?`,
      args: [t.uid, t.row, t.num, Number(t.price), Number(t.category), status, owner, t.last_modified_by, t.updated_at, t.day_uid] });
      seats.add(seatKey(t)); exists.tickets.add(t.uid); report.tickets.added++; touchedDays.add(t.day_uid);
    }
  }

  // 5. logs: append-only union
  for (const g of F.logs) {
    if (L.logs.has(g.uid)) { if (dead.has(`logs:${g.uid}`)) skip('logs', 'deleted'); else report.logs.kept++; continue; }
    if (!exists.tickets.has(g.ticket_uid) || !exists.days.has(g.day_uid)) { skip('logs', 'orphan'); continue; }
    if (!insertable('logs', g)) continue;
    ups.push({ sql: `INSERT INTO logs (uid, ticket_id, day_id, action, username, at)
      VALUES (?, (SELECT id FROM tickets WHERE uid = ?), (SELECT id FROM days WHERE uid = ?), ?, ?, ?)`, args: [g.uid, g.ticket_uid, g.day_uid, g.action, g.username, g.at] });
    report.logs.added++;
  }

  const stmts = [...del, ...tombs.map((a) => ({ sql: TOMB_UPSERT, args: a })), ...ups];
  for (const d of touchedDays) {
    if (dead.has(`days:${d}`)) continue;
    stmts.push({ sql: 'INSERT INTO day_versions (day_id, version) SELECT id, 1 FROM days WHERE uid = ? ON CONFLICT(day_id) DO UPDATE SET version = version + 1', args: [d] });
  }
  const warnings = Object.entries(warn).map(([code, count]) => ({ code, count }));
  if (soldKept.length) warnings.push({ code: 'soldCancelledInFile', count: soldKept.length, days: soldKeptByDay(live, soldKept) });
  return { report, warnings, stmts, touchedDays: [...touchedDays] };
}

/** Group kept sales by day: [{dayUid, date, event, count, seats: ['A-12', …] | null (count hall)}], by date. */
function soldKeptByDay(live, tickets) {
  const days = new Map(live.days.map((d) => [d.uid, d]));
  const events = new Map(live.events.map((e) => [e.uid, e.name]));
  const isCount = (d) => { try { return !Object.keys(JSON.parse(d?.tickets_dict || '{}')).length; } catch { return false; } };
  const out = new Map();
  for (const t of tickets) {
    const d = days.get(t.day_uid);
    if (!out.has(t.day_uid)) out.set(t.day_uid, { dayUid: t.day_uid, date: d?.date ?? null, event: events.get(d?.event_uid) ?? null, count: 0, seats: isCount(d) ? null : [] });
    const g = out.get(t.day_uid);
    g.count++;
    if (g.seats) g.seats.push(`${String(t.row).toUpperCase()}-${t.num}`);
  }
  const num = (s) => s.split('-').map((x, i) => (i ? Number(x) : x));
  for (const g of out.values()) g.seats?.sort((a, b) => { const [ra, na] = num(a); const [rb, nb] = num(b); return ra.localeCompare(rb) || na - nb; });
  return [...out.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

async function run(t, stmts) {
  for (let i = 0; i < stmts.length; i += CHUNK) await t.batch(stmts.slice(i, i + CHUNK));
}

/** Diff without writing. Throws HoldsConflict. -> {report, warnings, counts:{live, file}} */
export async function previewMerge(db, filePath, importer) {
  await assertNoHolds(db);
  const file = readFileData(filePath);
  const live = await readLiveData(db);
  const { report, warnings } = planMerge(live, file, importer);
  return { report, warnings, counts: { live: countsOf(live), file: countsOf(file) } };
}

/** The merge, all or nothing, holds re-checked inside the write tx. -> {report, warnings} */
export async function applyMerge(db, filePath, importer) {
  const file = readFileData(filePath);
  return tx(db, async (t) => {
    await assertNoHolds(t);
    const live = await readLiveData(t);
    const { report, warnings, stmts } = planMerge(live, file, importer);
    await run(t, stmts);
    return { report, warnings };
  });
}

/**
 * Full replace from a snapshot (superuser restore): halls/events/days/tickets/logs/tombstones become exactly the
 * file's rows (ids kept: snapshots come from this DB). Accounts are never touched: users, sessions, user_logins and
 * audit stay as they are live, so a password reset or a disable made after the snapshot survives and nobody is logged
 * out (users are never deleted, so every user id the restored rows name still exists). -> {table: rows}
 */
export async function replaceAll(db, filePath) {
  const src = new DatabaseSync(filePath, { readOnly: true });
  const data = {};
  try {
    for (const tbl of ['halls', 'events', 'days', 'tickets', 'logs', 'tombstones']) {
      const rows = src.prepare(`SELECT * FROM "${tbl}" ORDER BY rowid`).all();
      data[tbl] = { cols: Object.keys(rows[0] ?? {}), rows };
    }
  } finally { src.close(); }
  return tx(db, async (t) => {
    await assertNoHolds(t);
    const counts = {};
    await t.batch(['DELETE FROM logs', 'DELETE FROM tickets', 'DELETE FROM days', 'DELETE FROM events', 'DELETE FROM halls', 'DELETE FROM tombstones']);
    for (const [tbl, { cols, rows }] of Object.entries(data)) {
      const have = new Set((await t.execute(`PRAGMA table_info("${tbl}")`)).rows.map((c) => c.name));
      const use = cols.filter((c) => have.has(c));
      const sql = `INSERT INTO "${tbl}" (${use.map((c) => `"${c}"`).join(', ')}) VALUES (${use.map(() => '?').join(', ')})`;
      await run(t, rows.map((r) => ({ sql, args: use.map((c) => r[c] ?? null) })));
      counts[tbl] = rows.length;
    }
    // every day's version moves on, so open seat maps refetch on their next poll (no logout needed)
    await t.batch([
      'DELETE FROM day_versions WHERE day_id NOT IN (SELECT id FROM days)',
      'INSERT INTO day_versions (day_id, version) SELECT id, 1 FROM days WHERE true ON CONFLICT(day_id) DO UPDATE SET version = version + 1',
    ]);
    return counts;
  });
}
