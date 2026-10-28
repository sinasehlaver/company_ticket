// Logs (F12 + quirk 12): day list, day log newest first, strict seat lookup.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './test-helpers.js';

const SEATS = { all: [{ a: ['1', '2'] }, { b: ['1'] }] };
let t, s, boss, d1, d2, ev;
before(async () => {
  t = await makeApp();
  s = await t.login('sales', 'satis1');
  boss = await t.login('baskan');
  const a = await t.seedDay({ seats: SEATS, prices: { a: 20, b: 10 }, date: '2026-11-02T20:00' });
  ev = a.eventId;
  d1 = a.dayId;
  d2 = (await t.seedDay({ hallId: a.hallId, eventId: ev, prices: { a: 20, b: 10 }, date: '2026-11-01T20:00' })).dayId;
  const id = async (row, num) => Number((await t.db.execute({ sql: 'SELECT id FROM tickets WHERE day_id = ? AND row = ? AND num = ?', args: [d1, row, num] })).rows[0].id);
  const [a1, b1] = [await id('a', '1'), await id('b', '1')];
  await s.post(`/api/days/${d1}/toggle`, { ticketId: a1 });
  await s.post(`/api/days/${d1}/sell`, { ticketIds: [a1] });
  await new Promise((ok) => setTimeout(ok, 5));
  await s.post(`/api/days/${d1}/toggle`, { ticketId: b1 });
  await s.post(`/api/days/${d1}/sell`, { ticketIds: [b1] });
  await new Promise((ok) => setTimeout(ok, 5));
  await boss.post(`/api/days/${d1}/cancel`, { tickets: 'a-1' });
});
after(() => t.close());

test('GET /api/logs/days: newest first with event + hall', async () => {
  const r = await boss.get('/api/logs/days');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.days.map((x) => x.id), [d1, d2]);
  assert.equal(r.body.days[0].eventName, 'Show');
  assert.equal(r.body.days[0].hallName, 'H');
});

test('day log newest first, siblings by date', async () => {
  const r = await boss.get(`/api/days/${d1}/logs`);
  assert.equal(r.status, 200);
  assert.equal(r.body.seat, null);
  assert.deepEqual(r.body.logs.map((x) => [x.action, x.username, x.row, x.num, x.price]), [
    ['satış iptal', 'baskan', 'a', '1', 20],
    ['satış', 'satis1', 'b', '1', 10],
    ['satış', 'satis1', 'a', '1', 20],
  ]);
  assert.ok(r.body.logs.every((x) => typeof x.at === 'string'));
  assert.deepEqual(r.body.days.map((x) => x.id), [d2, d1]);
  assert.deepEqual((await boss.get(`/api/days/${d2}/logs`)).body.logs, []);
});

test('seat lookup: case-insensitive, strict, no silent fallback', async () => {
  const r = await boss.get(`/api/days/${d1}/logs?seat=A-1`);
  assert.equal(r.status, 200);
  assert.equal(r.body.seat, 'a-1');
  assert.deepEqual(r.body.logs.map((x) => x.action), ['satış iptal', 'satış']);
  assert.deepEqual((await boss.get(`/api/days/${d1}/logs?seat=a-2`)).body.logs, []);
  const miss = await boss.get(`/api/days/${d1}/logs?seat=z-9`);
  assert.equal(miss.status, 404);
  assert.equal(miss.body.error, 'Bu günde böyle bir koltuk yok');
  for (const bad of ['a1', 'a-', 'a-1,b-1']) assert.equal((await boss.get(`/api/days/${d1}/logs?seat=${encodeURIComponent(bad)}`)).status, 400, bad);
  assert.equal((await boss.get(`/api/days/${d1}/logs?seat=`)).status, 200); // empty = whole day
  assert.equal((await boss.get('/api/days/999/logs')).status, 404);
});
