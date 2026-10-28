// Test helpers: a fresh app on a temp file: DB, listening on 127.0.0.1:0, plus a cookie+CSRF client.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.js';
import { createUser } from './auth.js';
import { now, newUid, openDb } from './db.js';
import { createDay } from './seats.js';

/** TEST_DB_URL (npm run test:sqld): every makeApp wipes that DB instead of using a temp file. */
const REMOTE = process.env.TEST_DB_URL;

async function wipe(url) {
  const db = openDb(url);
  try {
    const r = await db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
    const ORDER = ['logs', 'sessions', 'tickets', 'days', 'events', 'halls', 'users']; // children first (FKs are on)
    const rank = (n) => { const i = ORDER.indexOf(n); return i < 0 ? -1 : i; };
    const names = r.rows.map((x) => x.name).sort((a, b) => rank(a) - rank(b));
    const drops = names.map((n) => `DROP TABLE IF EXISTS "${n}"`);
    const seq = await db.execute("SELECT name FROM sqlite_master WHERE name = 'sqlite_sequence'");
    if (seq.rows.length) drops.push('DELETE FROM sqlite_sequence');
    if (drops.length) await db.batch(drops, 'write');
  } finally { db.close(); }
}

export const PASSWORD = 'test-pass-123';

/** -> {base, db, app, ctx, url(path), client(), user(role, name?), login(role, name?), seedHall(opts), close()} */
export async function makeApp({ env = {}, distDir = null } = {}) {
  let dir = null;
  if (REMOTE) await wipe(REMOTE);
  else dir = mkdtempSync(join(tmpdir(), 'ct-test-'));
  const { app, db, ctx } = await createApp({ dbUrl: REMOTE || `file:${join(dir, 'test.db')}`, env, distDir });
  const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const t = {
    base, db, app, ctx,
    client: () => makeClient(base),
    /** Creates (once) a user with this role; default username = role. */
    async user(role, name = role) {
      const r = await db.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: [name] });
      if (r.rows.length) return Number(r.rows[0].id);
      return createUser(db, { username: name, password: PASSWORD, role });
    },
    /** Logged-in client (cookie + csrf) for a user of this role. */
    async login(role, name = role) {
      await t.user(role, name);
      const c = makeClient(base);
      const r = await c.post('/api/login', { username: name, password: PASSWORD });
      if (r.status !== 200) throw new Error(`login ${name} -> ${r.status} ${JSON.stringify(r.body)}`);
      c.csrf = r.body.csrf;
      c.user = r.body.user;
      return c;
    },
    /** Inserts a hall directly. seats = object; priceSchema text. -> id */
    async seedHall({ name = 'KKM', seats, seatPlan = {}, priceSchema = '' }) {
      const r = await db.execute({
        sql: 'INSERT INTO halls (uid, name, seats, seat_plan, price_schema, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [newUid(), name, JSON.stringify(seats), JSON.stringify(seatPlan), priceSchema, now()],
      });
      return Number(r.lastInsertRowid);
    },
    async seedEvent(hallId, name = 'Show') {
      const r = await db.execute({ sql: 'INSERT INTO events (uid, name, hall_id, updated_at) VALUES (?, ?, ?, ?)', args: [newUid(), name, hallId, now()] });
      return Number(r.lastInsertRowid);
    },
    /** Hall + event + day through createDay. seats {count:N} with price, or {all:[…]} with prices {row:p}. -> {hallId, eventId, dayId} */
    async seedDay({ seats, price = 50, prices, date = '2026-11-01T20:00', hallId, eventId } = {}) {
      hallId ??= await t.seedHall({ name: 'H', seats });
      eventId ??= await t.seedEvent(hallId);
      const hall = (await db.execute({ sql: 'SELECT * FROM halls WHERE id = ?', args: [hallId] })).rows[0];
      const event = (await db.execute({ sql: 'SELECT * FROM events WHERE id = ?', args: [eventId] })).rows[0];
      const dayId = await createDay(db, event, hall, prices ? { date, prices } : { date, price });
      return { hallId, eventId, dayId };
    },
    async count(sql, args = []) { return Number((await db.execute({ sql, args })).rows[0].n); },
    async close() {
      await new Promise((ok) => server.close(ok));
      db.close();
      if (dir) rmSync(dir, { recursive: true, force: true });
    },
  };
  return t;
}

/** Minimal fetch client: keeps the ct_sid cookie, sends X-CSRF-Token when csrf is set. */
export function makeClient(base) {
  const c = {
    cookie: '', csrf: '', user: null,
    /** -> {status, body (parsed JSON or text), headers} */
    async request(method, path, body, { headers = {}, raw } = {}) {
      const h = { ...headers };
      if (c.cookie) h.cookie = c.cookie;
      if (c.csrf && !('x-csrf-token' in h)) h['x-csrf-token'] = c.csrf;
      let payload;
      if (raw !== undefined) { payload = raw; h['content-type'] ??= 'application/json'; }
      else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
      const res = await fetch(base + path, { method, headers: h, body: payload, redirect: 'manual' });
      for (const sc of res.headers.getSetCookie()) {
        const m = /^ct_sid=([^;]*)/.exec(sc);
        if (m) c.cookie = m[1] ? `ct_sid=${m[1]}` : '';
      }
      const text = await res.text();
      let parsed = text;
      if ((res.headers.get('content-type') || '').includes('json')) parsed = JSON.parse(text);
      return { status: res.status, body: parsed, headers: res.headers };
    },
    get: (p, o) => c.request('GET', p, undefined, o),
    post: (p, b, o) => c.request('POST', p, b, o),
    put: (p, b, o) => c.request('PUT', p, b, o),
    del: (p, b, o) => c.request('DELETE', p, b, o),
  };
  return c;
}
