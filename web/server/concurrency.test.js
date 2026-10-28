// Races the reservation core (quirks 1-3): N parallel requests -> exactly the right number of winners.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './test-helpers.js';

const SEATS = { all: [{ a: ['1', '2', '3'] }] };
let t, users, boss2;
before(async () => {
  t = await makeApp();
  users = await Promise.all(Array.from({ length: 20 }, (_, i) => t.login('sales', `s${i}`)));
  boss2 = await Promise.all([t.login('baskan', 'b1'), t.login('superuser', 'b2')]);
});
after(() => t.close());

const tid = async (day, row, num) => Number((await t.db.execute({ sql: 'SELECT id FROM tickets WHERE day_id = ? AND row = ? AND num = ?', args: [day, row, num] })).rows[0].id);
const tally = (rs) => rs.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});

test('20 users hold the same seat at once -> 1 winner, 19 x 409', async () => {
  const { dayId } = await t.seedDay({ seats: SEATS, prices: { a: 10 } });
  const id = await tid(dayId, 'a', '1');
  const rs = await Promise.all(users.map((c) => c.post(`/api/days/${dayId}/toggle`, { ticketId: id })));
  assert.deepEqual(tally(rs), { 200: 1, 409: 19 });
  const winner = users[rs.findIndex((r) => r.status === 200)];
  assert.equal(rs.find((r) => r.status === 200).body.action, 'held');
  for (const r of rs.filter((x) => x.status === 409)) assert.equal(r.body.error, 'Bu koltuğu başkası tuttu');
  const row = (await t.db.execute({ sql: 'SELECT status, owner FROM tickets WHERE id = ?', args: [id] })).rows[0];
  assert.equal(Number(row.status), 1);
  assert.equal(Number(row.owner), winner.user.id);
});

test('20 parallel count holds with 5 free -> exactly 5 winners', async () => {
  const { dayId } = await t.seedDay({ seats: { count: 5 }, price: 30 });
  const rs = await Promise.all(users.map((c) => c.post(`/api/days/${dayId}/count/hold`, {})));
  assert.deepEqual(tally(rs), { 200: 5, 409: 15 });
  const owners = await t.db.execute({ sql: 'SELECT DISTINCT owner FROM tickets WHERE day_id = ? AND status = 1', args: [dayId] });
  assert.equal(owners.rows.length, 5);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets WHERE day_id = ? AND status = 0', [dayId]), 0);
});

test('two parallel sells of the same held set -> one succeeds, logs once', async () => {
  const { dayId } = await t.seedDay({ seats: SEATS, prices: { a: 10 } });
  const c = users[0];
  const ids = [await tid(dayId, 'a', '1'), await tid(dayId, 'a', '2')];
  for (const id of ids) assert.equal((await c.post(`/api/days/${dayId}/toggle`, { ticketId: id })).status, 200);
  const rs = await Promise.all([1, 2].map(() => c.post(`/api/days/${dayId}/sell`, { ticketIds: ids })));
  assert.deepEqual(tally(rs), { 200: 1, 409: 1 });
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM logs WHERE day_id = ?', [dayId]), 2);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets WHERE day_id = ? AND status = 2', [dayId]), 2);
});

test('stolen hold: B cannot take A\'s seat, A sells; B selling it -> 409', async () => {
  const { dayId } = await t.seedDay({ seats: SEATS, prices: { a: 10 } });
  const [a, b] = users;
  const id = await tid(dayId, 'a', '3');
  const seen = (await a.get(`/api/days/${dayId}/state`)).body;
  assert.equal(seen.free, 3);
  assert.equal((await a.post(`/api/days/${dayId}/toggle`, { ticketId: id })).status, 200);
  const [rb, rbSell] = await Promise.all([
    b.post(`/api/days/${dayId}/toggle`, { ticketId: id }),
    b.post(`/api/days/${dayId}/sell`, { ticketIds: [id] }),
  ]);
  assert.equal(rb.status, 409);
  assert.equal(rbSell.status, 409);
  const sold = await a.post(`/api/days/${dayId}/sell`, { ticketIds: [id] });
  assert.equal(sold.status, 200);
  assert.deepEqual(sold.body.sold, [{ row: 'a', num: '3', price: 10 }]);
  const logs = await t.db.execute({ sql: 'SELECT username FROM logs WHERE day_id = ?', args: [dayId] });
  assert.deepEqual(logs.rows.map((x) => x.username), ['s0']);
});

test('parallel holds and sells across many users never double-sell', async () => {
  const { dayId } = await t.seedDay({ seats: SEATS, prices: { a: 10 } });
  const ids = [await tid(dayId, 'a', '1'), await tid(dayId, 'a', '2'), await tid(dayId, 'a', '3')];
  const rs = await Promise.all(users.flatMap((c, i) => [c.post(`/api/days/${dayId}/toggle`, { ticketId: ids[i % 3] })]));
  assert.equal(rs.filter((r) => r.status === 200).length, 3);
  const sells = await Promise.all(users.map((c) => c.post(`/api/days/${dayId}/sell`, { ticketIds: ids.filter((_, k) => k === users.indexOf(c) % 3) })));
  assert.equal(sells.filter((r) => r.status === 200).length, 3);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM logs WHERE day_id = ?', [dayId]), 3);
});

test('two baskans cancel the same seat at once -> one success, one log', async () => {
  const { dayId } = await t.seedDay({ seats: SEATS, prices: { a: 10 } });
  const id = await tid(dayId, 'a', '1');
  await users[0].post(`/api/days/${dayId}/toggle`, { ticketId: id });
  assert.equal((await users[0].post(`/api/days/${dayId}/sell`, { ticketIds: [id] })).status, 200);
  const rs = await Promise.all(boss2.map((c) => c.post(`/api/days/${dayId}/cancel`, { tickets: 'a-1' })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  const loser = rs.find((r) => r.status !== 200);
  assert.ok([400, 409].includes(loser.status), String(loser.status));
  assert.equal(await t.count("SELECT COUNT(*) AS n FROM logs WHERE day_id = ? AND action = 'satış iptal'", [dayId]), 1);
});
