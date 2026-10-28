// Phase 4: deletes (typed confirm, sold force, tombstones, cascade), day re-pricing, başkan release,
// Hesaplar (accounts) guards, report + CSV.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, PASSWORD } from './test-helpers.js';
import { istanbulLabel } from './admin.js';
import { userChangeProblem } from './routes/users.js';
import { csvCell } from './report.js';

const SEATS = { all: [{ a: ['1', '2', '3'] }, { '-': [] }, { b: ['1', '2'] }] };
const DATE = '2026-11-01T20:00';
const LABEL = '01.11.2026 20:00';

let t, root, boss, s1, s2;
const ids = async (dayId, where = '1=1') => (await t.db.execute({ sql: `SELECT id FROM tickets WHERE day_id = ? AND ${where} ORDER BY id`, args: [dayId] })).rows.map((r) => Number(r.id));
async function holdAndSell(c, dayId, n) {
  const free = await ids(dayId, 'status = 0');
  for (const id of free.slice(0, n)) assert.equal((await c.post(`/api/days/${dayId}/toggle`, { ticketId: id })).status, 200);
  const r = await c.post(`/api/days/${dayId}/sell`, { ticketIds: free.slice(0, n) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

beforeEach(async () => {
  t = await makeApp();
  root = await t.login('superuser', 'root');
  boss = await t.login('baskan');
  s1 = await t.login('sales', 'mimarlik');
  s2 = await t.login('sales', 'carsi');
});
afterEach(() => t.close());

describe('delete hall / event / day', () => {
  test('istanbulLabel', () => {
    assert.equal(istanbulLabel('2026-11-01T17:00:00.000Z'), LABEL);
    assert.equal(istanbulLabel('nope'), '');
  });

  test('day: typed confirm, sold needs force, cascade + tombstones + version row gone', async () => {
    const { dayId, eventId } = await t.seedDay({ seats: SEATS, prices: { a: 75, b: 60 }, date: DATE });
    await holdAndSell(s1, dayId, 2);
    const url = `/api/days/${dayId}`;
    assert.equal((await boss.del(url, { confirm: LABEL, force: true })).status, 403);
    assert.equal((await root.del(url, {})).status, 400);
    assert.equal((await root.del(url, { confirm: 'x' })).status, 400);
    const noCsrf = await root.request('DELETE', url, { confirm: LABEL, force: true }, { headers: { 'x-csrf-token': '' } });
    assert.equal(noCsrf.status, 403);
    const soft = await root.del(url, { confirm: LABEL });
    assert.equal(soft.status, 409);
    assert.equal(soft.body.sold, 2);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM days'), 1);
    const tickets = (await t.db.execute({ sql: 'SELECT uid FROM tickets WHERE day_id = ?', args: [dayId] })).rows.map((r) => r.uid);
    const r = await root.del(url, { confirm: ` ${LABEL} `, force: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.deleted, { halls: 0, events: 0, logs: 2, tickets: 5, days: 1 });
    for (const [tbl, n] of [['days', 0], ['tickets', 0], ['logs', 0], ['day_versions', 0]]) assert.equal(await t.count(`SELECT COUNT(*) AS n FROM ${tbl}`), n, tbl);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM tombstones WHERE tbl = 'tickets'"), 5);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM tombstones WHERE tbl = 'logs'"), 2);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM tombstones WHERE tbl = 'days'"), 1);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tombstones WHERE uid = ?', [tickets[0]]), 1);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM events WHERE id = ?', [eventId]), 1, 'event survives');
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM audit WHERE action = 'day.delete'"), 1);
    assert.equal((await root.del(url, { confirm: LABEL })).status, 404);
  });

  test('unsold day deletes without force', async () => {
    const { dayId } = await t.seedDay({ seats: { count: 4 }, price: 10, date: DATE });
    assert.equal((await root.del(`/api/days/${dayId}`, { confirm: LABEL })).status, 200);
  });

  test('event and hall cascade every level, tombstones for each row', async () => {
    const hallId = await t.seedHall({ name: 'Salon X', seats: SEATS });
    const e1 = await t.seedEvent(hallId, 'Show 1');
    const e2 = await t.seedEvent(hallId, 'Show 2');
    const d1 = (await t.seedDay({ hallId, eventId: e1, prices: { a: 1, b: 1 } })).dayId;
    await t.seedDay({ hallId, eventId: e1, prices: { a: 1, b: 1 }, date: '2026-11-02T20:00' });
    await t.seedDay({ hallId, eventId: e2, prices: { a: 1, b: 1 } });
    const other = await t.seedDay({ seats: { count: 3 }, price: 5 }); // different hall: must survive
    await holdAndSell(s1, d1, 1);
    const ev = await root.del(`/api/events/${e1}`, { confirm: 'Show 1' });
    assert.equal(ev.status, 409);
    assert.equal((await root.del(`/api/events/${e1}`, { confirm: 'Show 1', force: true })).status, 200);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM days WHERE event_id = ?', [e1]), 0);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM tombstones WHERE tbl = 'events'"), 1);
    const h = await root.del(`/api/halls/${hallId}`, { confirm: 'Salon X' });
    assert.equal(h.status, 200, JSON.stringify(h.body));
    assert.deepEqual(h.body.deleted, { halls: 1, events: 1, days: 1, tickets: 5, logs: 0 });
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM tombstones WHERE tbl = 'halls'"), 1);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM tombstones WHERE tbl = 'days'"), 3);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM days WHERE id = ?', [other.dayId]), 1);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets WHERE day_id = ?', [other.dayId]), 3);
  });
});

describe('day re-pricing', () => {
  test('only free tickets change; version bumps; tickets_dict rewritten', async () => {
    const { dayId } = await t.seedDay({ seats: SEATS, prices: { a: 75, b: 60 } });
    await holdAndSell(s1, dayId, 1); // a-1 sold at 75
    const a2 = (await ids(dayId, "row = 'a' AND num = '2'"))[0];
    await s2.post(`/api/days/${dayId}/toggle`, { ticketId: a2 }); // a-2 held at 75
    const v0 = (await boss.get(`/api/days/${dayId}`)).body.state.version;
    assert.equal((await s1.put(`/api/days/${dayId}/prices`, { prices: { a: 90, b: 60 } })).status, 403);
    assert.equal((await boss.put(`/api/days/${dayId}/prices`, { prices: { a: 90 } })).status, 400);
    const r = await boss.put(`/api/days/${dayId}/prices`, { prices: { a: 90, b: 100 } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.changed, 3); // a-3 + b-1 + b-2
    const rows = (await t.db.execute({ sql: 'SELECT row, num, price, category FROM tickets WHERE day_id = ? ORDER BY id', args: [dayId] })).rows;
    assert.deepEqual(rows.map((x) => Number(x.price)), [75, 75, 90, 100, 100]);
    assert.equal(Number(rows[3].category), 1);
    assert.deepEqual(r.body.day.ticketsDict.b['-1'][0], 100);
    assert.notEqual((await boss.get(`/api/days/${dayId}`)).body.state.version, v0);
  });

  // a-1 sold (75), a-2 held (75), a-3 free; new a = 90 -> every group changes.
  async function priced() {
    const { dayId } = await t.seedDay({ seats: SEATS, prices: { a: 75, b: 60 } });
    await holdAndSell(s1, dayId, 1);
    await s2.post(`/api/days/${dayId}/toggle`, { ticketId: (await ids(dayId, "row = 'a' AND num = '2'"))[0] });
    const price = async (num) => Number((await t.db.execute({ sql: "SELECT price FROM tickets WHERE day_id = ? AND row = 'a' AND num = ?", args: [dayId, num] })).rows[0].price);
    return { dayId, price, body: { prices: { a: 90, b: 60 } } };
  }

  test('preview counts free/held/sold + sold revenue delta, writes nothing; sales 403; bad enum 400', async () => {
    const { dayId, price, body } = await priced();
    const url = `/api/days/${dayId}/prices`;
    assert.equal((await s1.post(`${url}/preview`, body)).status, 403);
    assert.equal((await s1.put(url, { ...body, sold: 'apply' })).status, 403);
    const p = await boss.post(`${url}/preview`, body);
    assert.equal(p.status, 200);
    assert.deepEqual(p.body, { free: 1, held: 1, sold: 1, soldOld: 75, soldNew: 90 });
    assert.equal(await price('3'), 75);
    assert.equal((await boss.post(`${url}/preview`, { prices: { a: 75, b: 60 } })).body.held, 0);
    for (const bad of [{ held: 'yes' }, { sold: 'APPLY' }, { sold: 1 }, { held: null, sold: ['apply'] }]) {
      assert.equal((await boss.put(url, { ...body, ...bad })).status, 400, JSON.stringify(bad));
    }
    assert.equal(await price('1'), 75);
    assert.equal((await boss.post('/api/days/999999/prices/preview', body)).status, 404);
  });

  test('grouped chunked UPDATEs: 1201-ticket count hall + per-tier seated rows all repriced, other days untouched', async () => {
    const big = await t.seedDay({ seats: { count: 1201 }, price: 10 });
    const other = await t.seedDay({ seats: { count: 3 }, price: 10 });
    const r = await boss.put(`/api/days/${big.dayId}/prices`, { price: 25 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.changed, 1201);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets WHERE day_id = ? AND price = 25', [big.dayId]), 1201);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets WHERE day_id = ? AND price = 10', [other.dayId]), 3);
    const { dayId } = await t.seedDay({ seats: SEATS, prices: { a: 75, b: 60 } });
    const s = await boss.put(`/api/days/${dayId}/prices`, { prices: { a: 50, b: 80 } });
    assert.equal(s.body.changed, 5);
    const rows = (await t.db.execute({ sql: 'SELECT price, category FROM tickets WHERE day_id = ? ORDER BY id', args: [dayId] })).rows;
    assert.deepEqual(rows.map((x) => [Number(x.price), Number(x.category)]), [[50, 2], [50, 2], [50, 2], [80, 1], [80, 1]]);
  });

  for (const [held, sold] of [['keep', 'keep'], ['apply', 'keep'], ['keep', 'apply'], ['apply', 'apply']]) {
    test(`commit held=${held} sold=${sold}`, async () => {
      const { dayId, price, body } = await priced();
      const v0 = (await boss.get(`/api/days/${dayId}`)).body.state.version;
      const r = await boss.put(`/api/days/${dayId}/prices`, { ...body, held, sold });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.changed, 1 + (held === 'apply') + (sold === 'apply'));
      assert.deepEqual([await price('1'), await price('2'), await price('3')], [sold === 'apply' ? 90 : 75, held === 'apply' ? 90 : 75, 90]);
      assert.notEqual((await boss.get(`/api/days/${dayId}`)).body.state.version, v0);
      const a = (await t.db.execute("SELECT detail FROM audit WHERE action = 'day.reprice' ORDER BY id DESC LIMIT 1")).rows[0];
      assert.ok(a, 'audit day.reprice');
      const det = JSON.parse(a.detail);
      assert.deepEqual([det.held, det.sold, det.counts.sold], [held, sold, 1]);
      const rep = (await boss.get('/api/report')).body.events[0].days[0];
      assert.equal(rep.revenue, sold === 'apply' ? 90 : 75);
    });
  }
});

describe('başkan release', () => {
  test('one seat, all of a user, count limit; version bumps; audit; holders list', async () => {
    const { dayId } = await t.seedDay({ seats: SEATS, prices: { a: 75, b: 60 } });
    const all = await ids(dayId);
    for (const id of all.slice(0, 3)) await s1.post(`/api/days/${dayId}/toggle`, { ticketId: id });
    await s2.post(`/api/days/${dayId}/toggle`, { ticketId: all[3] });
    const st = (await boss.get(`/api/days/${dayId}`)).body.state;
    assert.deepEqual(st.holders.map((h) => [h.username, h.count]), [['mimarlik', 3], ['carsi', 1]]);
    assert.equal((await s1.get(`/api/days/${dayId}`)).body.state.holders, null);
    const url = `/api/days/${dayId}/release`;
    assert.equal((await s2.post(url, { ticketId: all[0] })).status, 403);
    assert.equal((await boss.post(url, {})).status, 400);
    assert.equal((await boss.post(url, { ticketId: 'x' })).status, 400);
    assert.equal((await boss.post(url, { userId: 1, count: 0 })).status, 400);
    const one = await boss.post(url, { ticketId: all[3] });
    assert.equal(one.status, 200);
    assert.equal(one.body.holder, 'carsi');
    assert.notEqual(one.body.state.version, st.version);
    assert.equal((await boss.post(url, { ticketId: all[3] })).status, 409);
    assert.equal((await boss.post(url, { ticketId: all[4] })).status, 409); // free
    const r = await boss.post(url, { userId: s1.user.id, count: 2 });
    assert.equal(r.body.released, 2);
    assert.deepEqual(await ids(dayId, 'status = 1'), [all[0]]); // the newest two went
    assert.equal((await boss.post(url, { userId: s1.user.id })).body.released, 1);
    assert.equal((await boss.post(url, { userId: s1.user.id })).status, 409);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM audit WHERE action = 'hold.release'"), 3);
    // the seller's own state no longer lists the seats as mine; selling them now fails
    const sell = await s1.post(`/api/days/${dayId}/sell`, { ticketIds: all.slice(0, 1) });
    assert.equal(sell.status, 409);
  });

  test('count hall: release a user\'s held count', async () => {
    const { dayId } = await t.seedDay({ seats: { count: 5 }, price: 10 });
    for (let i = 0; i < 3; i++) await s1.post(`/api/days/${dayId}/count/hold`);
    const r = await boss.post(`/api/days/${dayId}/release`, { userId: s1.user.id, count: 2 });
    assert.equal(r.status, 200);
    assert.equal(r.body.state.free, 4);
  });
});

describe('Hesaplar', () => {
  test('create: roles, validation, generated password, new user logs in', async () => {
    assert.equal((await s1.post('/api/users', { username: 'x1', password: 'longenough' })).status, 403);
    assert.equal((await s1.get('/api/users')).status, 403);
    for (const body of [
      { username: 'a', password: 'longenough' }, { username: 'x'.repeat(41), password: 'longenough' },
      { username: 'bad name', password: 'longenough' }, { username: 'ok1', password: 'short' },
      { username: 'ok1', password: 'longenough', role: 'superuser' }, { username: 'ok1', password: 'longenough', role: 'admin' },
      { username: 'ok1', password: 'x'.repeat(2000) },
    ]) assert.equal((await root.post('/api/users', body)).status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal((await boss.post('/api/users', { username: 'b2', password: 'longenough', role: 'baskan' })).status, 400);
    const noCsrf = await root.request('POST', '/api/users', { username: 'ok1', password: 'longenough' }, { headers: { 'x-csrf-token': '' } });
    assert.equal(noCsrf.status, 403);
    const g = await boss.post('/api/users', { username: 'kutuphane', generate: true });
    assert.equal(g.status, 201);
    assert.equal(g.body.user.role, 'sales');
    assert.match(g.body.password, /^[A-Za-z2-9]{14}$/);
    assert.equal((await root.post('/api/users', { username: 'KUTUPHANE', password: 'longenough' })).status, 409);
    const p = await root.post('/api/users', { username: 'baskan2', password: 'longenough', role: 'baskan' });
    assert.equal(p.status, 201);
    assert.equal(p.body.password, undefined, 'typed password is never echoed');
    const c = t.client();
    assert.equal((await c.post('/api/login', { username: 'kutuphane', password: g.body.password })).status, 200);
    const list = (await boss.get('/api/users')).body.users;
    assert.equal(list.find((u) => u.username === 'kutuphane').lastLogin !== null, true);
    assert.equal(list[0].role, 'superuser');
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM audit WHERE action = 'user.create'"), 2);
  });

  test('disable kills sessions, enable, reset password; guards', async () => {
    const victim = s1.user.id;
    assert.equal((await boss.put(`/api/users/${victim}`, {})).status, 400);
    assert.equal((await boss.put(`/api/users/${victim}`, { disabled: 'yes' })).status, 400);
    assert.equal((await boss.put(`/api/users/${victim}`, { role: 'baskan' })).status, 400, 'baskan cannot change roles');
    assert.equal((await boss.put(`/api/users/${victim}`, { disabled: true })).status, 200);
    assert.equal((await s1.get('/api/me')).status, 401, 'session killed');
    assert.equal((await t.client().post('/api/login', { username: 'mimarlik', password: PASSWORD })).status, 403);
    assert.equal((await boss.put(`/api/users/${victim}`, { disabled: false })).body.user.disabled, false);
    const reset = await boss.post(`/api/users/${victim}/password`, { generate: true });
    assert.equal(reset.status, 200);
    assert.equal((await t.client().post('/api/login', { username: 'mimarlik', password: PASSWORD })).status, 401);
    assert.equal((await t.client().post('/api/login', { username: 'mimarlik', password: reset.body.password })).status, 200);
    assert.equal((await boss.post(`/api/users/${victim}/password`, { password: 'short' })).status, 400);
    // baskan cannot touch baskan/superuser; nobody can touch themselves
    assert.equal((await boss.put(`/api/users/${root.user.id}`, { disabled: true })).status, 400);
    assert.equal((await boss.put(`/api/users/${boss.user.id}`, { disabled: true })).status, 400);
    assert.equal((await root.put(`/api/users/${root.user.id}`, { role: 'baskan' })).status, 400);
    assert.equal((await root.post(`/api/users/${root.user.id}/password`, { generate: true })).status, 400);
    // superuser can promote/demote others
    assert.equal((await root.put(`/api/users/${boss.user.id}`, { role: 'sales' })).body.user.role, 'sales');
    assert.equal((await root.put('/api/users/99999', { disabled: true })).status, 404);
  });

  test('last-superuser guard (pure)', () => {
    const actor = { id: 1, role: 'superuser' };
    const sup = { id: 2, role: 'superuser', disabled: false };
    assert.match(userChangeProblem(actor, sup, { disabled: true }, 1), /Son süper/);
    assert.match(userChangeProblem(actor, sup, { role: 'baskan' }, 1), /Son süper/);
    assert.equal(userChangeProblem(actor, sup, { disabled: true }, 2), null);
    assert.equal(userChangeProblem(actor, sup, { role: 'superuser' }, 1), null);
    assert.match(userChangeProblem(actor, { ...sup, id: 1 }, { disabled: true }, 5), /Kendi/);
    assert.match(userChangeProblem({ id: 3, role: 'baskan' }, sup, { disabled: true }, 5), /yalnızca satış/);
  });
});

describe('Rapor', () => {
  test('per day, per sales point, per price; event totals; role', async () => {
    const { dayId, eventId } = await t.seedDay({ seats: SEATS, prices: { a: 75, b: 60 } });
    const all = await ids(dayId);
    for (const id of all.slice(0, 2)) await s1.post(`/api/days/${dayId}/toggle`, { ticketId: id });
    await s1.post(`/api/days/${dayId}/sell`, { ticketIds: all.slice(0, 2) });
    for (const id of all.slice(2, 4)) await s2.post(`/api/days/${dayId}/toggle`, { ticketId: id });
    await s2.post(`/api/days/${dayId}/sell`, { ticketIds: all.slice(2, 4) }); // a-3 75 + b-1 60
    await s2.post(`/api/days/${dayId}/toggle`, { ticketId: all[4] }); // held, not sold
    assert.equal((await s1.get('/api/report')).status, 403);
    const r = await boss.get('/api/report');
    assert.equal(r.status, 200);
    const d = r.body.events[0].days[0];
    assert.deepEqual([d.sold, d.revenue, d.held, d.free, d.capacity], [4, 285, 1, 0, 5]);
    assert.deepEqual(d.byUser, [{ username: 'mimarlik', count: 2, revenue: 150 }, { username: 'carsi', count: 2, revenue: 135 }]);
    assert.deepEqual(d.byPrice, [{ price: 75, count: 3, revenue: 225 }, { price: 60, count: 1, revenue: 60 }]);
    assert.deepEqual(r.body.totals, { sold: 4, revenue: 285 });
    assert.equal(r.body.events[0].id, eventId);
    assert.equal((await boss.get(`/api/report?event=${eventId + 1}`)).body.events.length, 0);
    assert.equal((await boss.get('/api/report?event=abc')).status, 400);
  });

  test('CSV: BOM, attachment, ; separated, formula injection neutralised', async () => {
    const hallId = await t.seedHall({ name: '@salon', seats: { count: 3 } });
    const eventId = await t.seedEvent(hallId, '=HYPERLINK("http://x")');
    const { dayId } = await t.seedDay({ hallId, eventId, price: 20 });
    await t.user('sales', '-minus');
    const m = await t.login('sales', '-minus');
    await m.post(`/api/days/${dayId}/count/hold`);
    const held = await ids(dayId, 'status = 1');
    await m.post(`/api/days/${dayId}/sell`, { ticketIds: held });
    const r = await boss.get('/api/report.csv');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="rapor-\d{8}-\d{4}\.csv"$/);
    const raw = Buffer.from(await (await fetch(`${t.base}/api/report.csv`, { headers: { cookie: boss.cookie } })).arrayBuffer());
    assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const lines = r.body.replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(lines[0], 'Etkinlik;Salon;Gün;Satış noktası;Fiyat;Adet;Tutar');
    assert.equal(lines[1], `"'=HYPERLINK(""http://x"")";'@salon;01.11.2026 20:00;'-minus;20;1;20`);
    assert.equal(lines[2], `"'=HYPERLINK(""http://x"")";'@salon;01.11.2026 20:00;TOPLAM;;1;20`);
    assert.equal((await s1.get('/api/report.csv')).status, 403);
  });

  test('csvCell', () => {
    assert.equal(csvCell('+1'), "'+1");
    assert.equal(csvCell('\tx'), "'\tx");
    assert.equal(csvCell('a;b'), '"a;b"');
    assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
    assert.equal(csvCell(-5), "'-5");
    assert.equal(csvCell(null), '');
  });
});
