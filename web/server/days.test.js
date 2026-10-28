// Port of CreateDayTests (ticketsystem/tests.py) 1:1, plus hall/event/day CRUD (F3-F6).
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './test-helpers.js';
import { istanbulToUtc } from './seats.js';

const SEATS = { all: [{ a: ['1', '2', '-1', '3'] }, { '-': [] }, { b: ['1', '2'] }, { c: ['1'] }] };

describe('CreateDayTests', () => {
  let t, admin, hallId, eventId, url;
  beforeEach(async () => {
    t = await makeApp();
    admin = await t.login('superuser', 'root');
    hallId = await t.seedHall({ seats: SEATS, priceSchema: 'a:75,b-c:60' });
    eventId = await t.seedEvent(hallId);
    url = `/api/events/${eventId}/days`;
  });
  afterEach(() => t.close());
  const days = () => t.count('SELECT COUNT(*) AS n FROM days');

  test('form prefilled from hall', async () => {
    const r = await admin.get(`/api/halls/${hallId}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.hall.prices, { a: 75, b: 60, c: 60 });
    assert.deepEqual(r.body.hall.rows, ['a', 'b', 'c']);
    assert.equal(r.body.hall.kind, 'seated');
    assert.equal(r.body.hall.seatCount, 6);
  });

  test('creates tickets and remembers', async () => {
    const r = await admin.post(url, { date: '2026-11-01T20:00', prices: { a: 90, b: 60, c: 60 }, remember: true });
    assert.equal(r.status, 201);
    const dayId = r.body.day.id;
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets WHERE day_id = ?', [dayId]), 3 + 2 + 1); // -1 gap skipped
    const pa = await t.db.execute("SELECT DISTINCT price FROM tickets WHERE row = 'a'");
    assert.deepEqual(pa.rows.map((x) => Number(x.price)), [90]);
    const a1 = (await t.db.execute("SELECT * FROM tickets WHERE row = 'a' AND num = '1'")).rows[0];
    assert.equal(Number(a1.category), 1);
    assert.equal(Number(a1.status), 0);
    assert.equal(a1.owner, null);
    assert.equal(a1.event_id, eventId);
    const h = (await t.db.execute({ sql: 'SELECT price_schema FROM halls WHERE id = ?', args: [hallId] })).rows[0];
    assert.equal(h.price_schema, 'a:90,b-c:60');
    assert.deepEqual(r.body.day.ticketsDict, { a: { '-1': [90, 360] }, b: { '-1': [60, 150] }, c: { '-1': [60, 150] } });
    assert.equal(r.body.day.date, '2026-11-01T17:00:00.000Z'); // Istanbul 20:00 = UTC 17:00
    const ev = await admin.get(`/api/events/${eventId}`);
    assert.equal(ev.status, 200);
    assert.deepEqual(ev.body.event.days.map((d) => d.id), [dayId]);
  });

  test('without remember the hall schema is unchanged', async () => {
    assert.equal((await admin.post(url, { date: '2026-11-01T20:00', prices: { a: 1, b: 2, c: 3 } })).status, 201);
    const h = (await t.db.execute({ sql: 'SELECT price_schema FROM halls WHERE id = ?', args: [hallId] })).rows[0];
    assert.equal(h.price_schema, 'a:75,b-c:60');
  });

  test('missing row price rejected', async () => {
    const r = await admin.post(url, { date: '2026-11-01T20:00', prices: { a: 90, b: 60 } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /sırası için geçerli bir fiyat/);
    assert.equal(await days(), 0);
  });

  test('bad date and negative price', async () => {
    const base = { prices: { a: 1, b: 1, c: 1 } };
    const r1 = await admin.post(url, { ...base, date: 'nope' });
    assert.equal(r1.status, 400);
    assert.match(r1.body.error, /tarih/);
    const r2 = await admin.post(url, { date: '2026-11-01T20:00', prices: { ...base.prices, a: -5 } });
    assert.equal(r2.status, 400);
    assert.match(r2.body.error, /sırası için/);
    assert.equal(await days(), 0);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets'), 0);
  });

  test('count hall', async () => {
    const hid = await t.seedHall({ name: 'Mimarlık', seats: { count: 4 }, priceSchema: '60' });
    const ev = await t.seedEvent(hid, 'M');
    const g = await admin.get(`/api/halls/${hid}`);
    assert.equal(g.body.hall.kind, 'count');
    assert.equal(g.body.hall.price, '60');
    const r = await admin.post(`/api/events/${ev}/days`, { date: '2026-11-01T20:00', price: '55' });
    assert.equal(r.status, 201);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets WHERE event_id = ? AND price = 55', [ev]), 4);
    const rows = await t.db.execute({ sql: 'SELECT row, num, category FROM tickets WHERE event_id = ? ORDER BY id', args: [ev] });
    assert.deepEqual(rows.rows.map((x) => [x.row, x.num, Number(x.category)]), [['m', '0', 0], ['m', '1', 0], ['m', '2', 0], ['m', '3', 0]]);
    assert.deepEqual(r.body.day.ticketsDict, {});
    const bad = await admin.post(`/api/events/${ev}/days`, { date: '2026-11-01T20:00', price: 'x' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'Geçerli bir fiyat girin');
  });

  test('only başkan+ (sales 403, anon 401)', async () => {
    const anon = t.client();
    assert.equal((await anon.post(url, {})).status, 401);
    const seller = await t.login('sales', 'carsi');
    assert.equal((await seller.post(url, { date: '2026-11-01T20:00' })).status, 403);
    assert.equal((await seller.put(`/api/halls/${hallId}/prices`, {})).status, 403);
    assert.equal(await days(), 0);
    const h = (await t.db.execute('SELECT price_schema FROM halls')).rows[0];
    assert.equal(h.price_schema, 'a:75,b-c:60');
    const baskan = await t.login('baskan');
    assert.equal((await baskan.post(url, { date: '2026-11-01T20:00', prices: { a: 1, b: 1, c: 1 } })).status, 201);
  });

  test('hall prices edit', async () => {
    const r = await admin.put(`/api/halls/${hallId}/prices`, { prices: { a: 10, b: 10, c: 5 } });
    assert.equal(r.status, 200);
    assert.equal((await t.db.execute('SELECT price_schema FROM halls')).rows[0].price_schema, 'a-b:10,c:5');
    const bad = await admin.put(`/api/halls/${hallId}/prices`, { prices: { a: 10, b: 10 } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, '"C" sırası için geçerli bir fiyat girin');
  });

  test('hall price edit does not change existing days', async () => {
    const d = await admin.post(url, { date: '2026-11-01T20:00', prices: { a: 90, b: 60, c: 60 } });
    await admin.put(`/api/halls/${hallId}/prices`, { prices: { a: 1, b: 1, c: 1 } });
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets WHERE day_id = ? AND price = 1', [d.body.day.id]), 0);
  });

  test('a failure mid-transaction leaves nothing behind', async () => {
    // Corrupt hall seats so ticket insert hits UNIQUE(day_id,row,num) after the day row was inserted.
    await t.db.execute({ sql: 'UPDATE halls SET seats = ? WHERE id = ?', args: [JSON.stringify({ all: [{ a: ['1', '1'] }, { b: ['1'] }, { c: ['1'] }] }), hallId] });
    const r = await admin.post(url, { date: '2026-11-01T20:00', prices: { a: 1, b: 1, c: 1 }, remember: true });
    assert.equal(r.status, 500);
    assert.equal(await days(), 0);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets'), 0);
    assert.equal((await t.db.execute('SELECT price_schema FROM halls')).rows[0].price_schema, 'a:75,b-c:60');
  });
});

describe('halls / events / days CRUD', () => {
  let t, b;
  beforeEach(async () => { t = await makeApp(); b = await t.login('baskan'); });
  afterEach(() => t.close());

  test('create seated hall, list, rename', async () => {
    const r = await b.post('/api/halls', { name: '  Salon 1 ', seats: SEATS, seatPlan: { x: 1 } });
    assert.equal(r.status, 201);
    assert.equal(r.body.hall.name, 'Salon 1');
    assert.equal(r.body.hall.priceSchema, '');
    assert.deepEqual(r.body.hall.seatPlan, { x: 1 });
    assert.match(r.body.hall.uid, /^[0-9a-f-]{36}$/);
    const l = await b.get('/api/halls');
    assert.deepEqual(l.body.halls.map((h) => [h.name, h.kind, h.seatCount]), [['Salon 1', 'seated', 6]]);
    const before = r.body.hall.updatedAt;
    await new Promise((ok) => setTimeout(ok, 5));
    const p = await b.put(`/api/halls/${r.body.hall.id}`, { name: 'Salon 2' });
    assert.equal(p.status, 200);
    assert.equal(p.body.hall.name, 'Salon 2');
    assert.ok(p.body.hall.updatedAt > before);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM audit WHERE action = 'hall.rename' AND username = 'baskan'"), 1);
  });

  test('create count hall; single price edit', async () => {
    const r = await b.post('/api/halls', { name: 'M', seats: { count: 280 } });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.hall.seatPlan, {});
    assert.equal((await b.put(`/api/halls/${r.body.hall.id}/prices`, { price: 60 })).body.hall.priceSchema, '60');
    assert.equal((await b.put(`/api/halls/${r.body.hall.id}/prices`, { price: -1 })).status, 400);
  });

  test('hall seats validation', async () => {
    const bad = [
      undefined, null, [], 'x', {}, { count: 0 }, { count: 5001 }, { count: 1.5 }, { count: '5' }, { count: 5, all: [] },
      { all: [] }, { all: {} }, { all: [{ A: ['1'] }] }, { all: [{ ab: ['1'] }] }, { all: [{ a: ['1'], b: ['1'] }] },
      { all: [{ a: '1' }] }, { all: [{ a: [1] }] }, { all: [{ a: ['1', '1'] }] }, { all: [{ a: ['1'] }, { a: ['2'] }] },
      { all: [{ a: ['-1'] }] }, { all: [{ '-': [] }] }, { all: [null] }, { all: [{ a: ['x y'] }] },
    ];
    for (const seats of bad) {
      const r = await b.post('/api/halls', { name: 'X', seats });
      assert.equal(r.status, 400, JSON.stringify(seats));
      assert.ok(r.body.error);
    }
    assert.equal((await b.post('/api/halls', { name: '', seats: { count: 5 } })).status, 400);
    assert.equal((await b.post('/api/halls', { name: 'x'.repeat(201), seats: { count: 5 } })).status, 400);
    assert.equal((await b.post('/api/halls', { name: 'X', seats: { count: 5 }, seatPlan: 'str' })).status, 400);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM halls'), 0);
  });

  test('events: create, list, get with days ordered by date, rename', async () => {
    const h = (await b.post('/api/halls', { name: 'H', seats: { count: 3 } })).body.hall;
    assert.equal((await b.post('/api/events', { name: 'E', hallId: 999 })).status, 400);
    assert.equal((await b.post('/api/events', { name: 'E' })).status, 400);
    const e = await b.post('/api/events', { name: 'Show', hallId: String(h.id) });
    assert.equal(e.status, 201);
    const id = e.body.event.id;
    assert.equal(e.body.event.hallName, 'H');
    for (const date of ['2026-11-03T20:00', '2026-11-01T20:00', '2026-11-02T14:30']) {
      assert.equal((await b.post(`/api/events/${id}/days`, { date, price: 5 })).status, 201);
    }
    const g = await b.get(`/api/events/${id}`);
    assert.deepEqual(g.body.event.days.map((d) => d.date), ['2026-11-01T17:00:00.000Z', '2026-11-02T11:30:00.000Z', '2026-11-03T17:00:00.000Z']);
    const l = await b.get('/api/events');
    assert.equal(l.body.events[0].dayCount, 3);
    assert.equal((await b.put(`/api/events/${id}`, { name: 'Renamed' })).body.event.name, 'Renamed');
    assert.equal((await b.get('/api/events/999')).status, 404);
  });

  test('day date change', async () => {
    const h = (await b.post('/api/halls', { name: 'H', seats: { count: 3 } })).body.hall;
    const e = (await b.post('/api/events', { name: 'Show', hallId: h.id })).body.event;
    const d = (await b.post(`/api/events/${e.id}/days`, { date: '2026-11-01T20:00', price: 5 })).body.day;
    const r = await b.put(`/api/days/${d.id}`, { date: '2026-12-31T23:30' });
    assert.equal(r.status, 200);
    assert.equal(r.body.day.date, '2026-12-31T20:30:00.000Z');
    assert.equal((await b.put(`/api/days/${d.id}`, { date: '2026-02-30T10:00' })).status, 400);
    assert.equal((await b.put('/api/days/999', { date: '2026-12-31T23:30' })).status, 404);
  });
});

test('istanbulToUtc', () => {
  assert.equal(istanbulToUtc('2026-11-01T20:00'), '2026-11-01T17:00:00.000Z');
  assert.equal(istanbulToUtc('2026-01-01T01:00'), '2025-12-31T22:00:00.000Z');
  for (const bad of ['nope', '', null, 5, '2026-13-01T20:00', '2026-02-29T10:00', '2026-11-01T24:00', '2026-11-01 20:00', '2026-11-01T20:00:00']) {
    assert.equal(istanbulToUtc(bad), null, String(bad));
  }
});
