// Reservation core parity (F7-F11 + quirks 5-10): hold/unhold, count ±, sell, cancel, state polling.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './test-helpers.js';
import { parseSeatList } from './reserve.js';

const SEATS = { all: [{ a: ['1', '2', '-1', '3'] }, { '-': [] }, { b: ['1', '2'] }] };
const PRICES = { a: 75, b: 60 };

let t, s1, s2, boss, day, other;
const tid = async (row, num, d = day) => Number((await t.db.execute({ sql: 'SELECT id FROM tickets WHERE day_id = ? AND row = ? AND num = ?', args: [d, row, num] })).rows[0].id);
const ticket = async (id) => (await t.db.execute({ sql: 'SELECT status, owner, last_modified_by FROM tickets WHERE id = ?', args: [id] })).rows[0];
const toggle = (c, id, d = day) => c.post(`/api/days/${d}/toggle`, { ticketId: id });
const logs = (action) => t.count('SELECT COUNT(*) AS n FROM logs WHERE action = ?', [action]);

describe('seated day', () => {
  beforeEach(async () => {
    t = await makeApp();
    s1 = await t.login('sales', 'satis1');
    s2 = await t.login('sales', 'satis2');
    boss = await t.login('baskan');
    const d = await t.seedDay({ seats: SEATS, prices: PRICES });
    day = d.dayId;
    other = (await t.seedDay({ hallId: d.hallId, eventId: d.eventId, prices: PRICES, date: '2026-11-02T20:00' })).dayId;
  });
  afterEach(() => t.close());

  test('GET day: layout, siblings, state', async () => {
    const r = await s1.get(`/api/days/${day}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.day.kind, 'seated');
    assert.deepEqual(r.body.day.seats, SEATS.all);
    assert.deepEqual(r.body.day.ticketsDict.a, { '-1': [75, 360] });
    assert.equal(r.body.day.event.name, 'Show');
    assert.deepEqual(r.body.days.map((x) => x.id), [day, other]);
    assert.equal(r.body.state.seats.length, 5);
    assert.equal(r.body.state.free, 5);
    assert.equal(r.body.state.sold, null);
    assert.deepEqual(r.body.state.mine, { count: 0, total: 0, list: [] });
    assert.equal((await s1.get('/api/days/999')).status, 404);
  });

  test('hold free -> mine; click own -> free; others/sold -> 409 unchanged; other day -> 404', async () => {
    const a1 = await tid('a', '1');
    let r = await toggle(s1, a1);
    assert.equal(r.status, 200);
    assert.equal(r.body.action, 'held');
    assert.deepEqual(r.body.state.mine.list, [{ id: a1, row: 'a', num: '1', price: 75 }]);
    let row = await ticket(a1);
    assert.equal(Number(row.status), 1);
    assert.equal(Number(row.owner), s1.user.id);
    assert.equal(row.last_modified_by, 'satis1');

    r = await toggle(s2, a1);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'Bu koltuğu başkası tuttu');
    assert.ok(r.body.state.seats.find((x) => x[0] === a1)[5] === 1);
    assert.equal(Number((await ticket(a1)).owner), s1.user.id);

    r = await toggle(s1, a1);
    assert.equal(r.body.action, 'released');
    row = await ticket(a1);
    assert.equal(Number(row.status), 0);
    assert.equal(row.owner, null);

    await toggle(s1, a1);
    assert.equal((await s1.post(`/api/days/${day}/sell`, { ticketIds: [a1] })).status, 200);
    for (const c of [s1, s2]) {
      r = await toggle(c, a1);
      assert.equal(r.status, 409);
      assert.equal(r.body.error, 'Bu koltuk satıldı');
    }
    assert.equal(Number((await ticket(a1)).status), 2);

    const foreign = await tid('a', '2', other);
    r = await toggle(s1, foreign); // quirk 5
    assert.equal(r.status, 404);
    assert.equal(Number((await ticket(foreign)).status), 0);
    for (const bad of [undefined, 'x', -1, 0, 1.5, null, [1]]) assert.equal((await s1.post(`/api/days/${day}/toggle`, { ticketId: bad })).status, 400);
  });

  test('count endpoints rejected on a seated day', async () => {
    const r = await s1.post(`/api/days/${day}/count/hold`, {});
    assert.equal(r.status, 400);
    assert.equal((await s1.post(`/api/days/${day}/count/release`, {})).status, 400);
  });

  test('sell sells exactly the listed held seats and logs each', async () => {
    const [a1, a3, b1] = [await tid('a', '1'), await tid('a', '3'), await tid('b', '1')];
    await toggle(s1, a1); await toggle(s1, b1); await toggle(s2, a3);
    const r = await s1.post(`/api/days/${day}/sell`, { ticketIds: [b1, a1] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.sold, [{ row: 'a', num: '1', price: 75 }, { row: 'b', num: '1', price: 60 }]);
    assert.equal(r.body.total, 135);
    assert.equal(r.body.state.mine.count, 0);
    assert.equal(Number((await ticket(a3)).status), 1); // satis2's hold untouched
    const l = await t.db.execute("SELECT ticket_id, username, action, uid FROM logs ORDER BY ticket_id");
    assert.deepEqual(l.rows.map((x) => [Number(x.ticket_id), x.username, x.action]), [[a1, 'satis1', 'satış'], [b1, 'satis1', 'satış']]);
    assert.ok(l.rows.every((x) => x.uid));
  });

  test('sell with a stale list -> 409, nothing sold; empty -> 400', async () => {
    const [a1, a2] = [await tid('a', '1'), await tid('a', '2')];
    await toggle(s1, a1); await toggle(s1, a2);
    for (const ids of [[a1], [a1, a2, 999], [a1, await tid('b', '1')]]) {
      const r = await s1.post(`/api/days/${day}/sell`, { ticketIds: ids });
      assert.equal(r.status, 409, JSON.stringify(ids));
      assert.equal(r.body.error, 'Tuttuğunuz koltuklar değişti, listeyi kontrol edin');
      assert.equal(r.body.state.mine.count, 2);
    }
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets WHERE status = 2'), 0);
    assert.equal(await logs('satış'), 0);
    const e = await s2.post(`/api/days/${day}/sell`, { ticketIds: [] }); // quirk 9
    assert.equal(e.status, 400);
    assert.equal(e.body.error, 'Satılacak koltuk yok');
    assert.equal((await s2.post(`/api/days/${day}/sell`, {})).status, 400);
    assert.equal((await s1.post(`/api/days/${day}/sell`, { ticketIds: [a1, a1] })).status, 400);
    assert.equal((await s1.post(`/api/days/${day}/sell`, { ticketIds: [a1, a2] })).status, 200);
  });

  async function sold(...seats) {
    const ids = [];
    for (const [row, num] of seats) { const id = await tid(row, num); ids.push(id); await toggle(s1, id); }
    assert.equal((await s1.post(`/api/days/${day}/sell`, { ticketIds: ids })).status, 200);
    return ids;
  }
  const cancel = (body, c = boss) => c.post(`/api/days/${day}/cancel`, body);

  test('cancel: forms accepted, owner reset, canceller recorded, logged', async () => {
    const [a1, b2] = await sold(['a', '1'], ['b', '2']);
    const r = await cancel({ tickets: ' A-1 , b-2 ' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.cancelled, [{ row: 'a', num: '1', price: 75 }, { row: 'b', num: '2', price: 60 }]);
    for (const id of [a1, b2]) {
      const x = await ticket(id);
      assert.equal(Number(x.status), 0);
      assert.equal(x.owner, null);
      assert.equal(x.last_modified_by, 'baskan'); // quirk 8
    }
    assert.equal(await logs('satış iptal'), 2);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM audit WHERE action = 'sale.cancel'"), 1);
    await sold(['a', '1']);
    assert.equal((await cancel({ tickets: 'a-1' })).status, 200);
  });

  test('cancel: bad input rejects everything', async () => {
    await sold(['a', '1'], ['b', '1']);
    const cases = [
      [{ tickets: 'a32' }, /Anlaşılmayan: "a32"/],
      [{ tickets: 'a-1,' }, /Anlaşılmayan: \(boş\)/],
      [{ tickets: 'a-1,,b-1' }, /Anlaşılmayan: \(boş\)/],
      [{ tickets: 'a-1, a-1' }, /Tekrarlanan: A-1/],
      [{ tickets: 'A-1, a-1' }, /Tekrarlanan: A-1/],
      [{ tickets: 'a-1, z-9' }, /Bu günde yok: Z-9/],
      [{ tickets: 'b-1, a-2' }, /Satılmamış: A-2/],
      [{ tickets: 'a-1, z-9, a-2' }, /Bu günde yok: Z-9 · Satılmamış: A-2/],
      [{ tickets: '' }, /koltukları girin/],
      [{}, /koltukları girin/],
      [{ tickets: 5 }, /koltukları girin/],
    ];
    for (const [body, re] of cases) {
      const r = await cancel(body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match(r.body.error, re, JSON.stringify(body));
    }
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets WHERE status = 2'), 2);
    assert.equal(await logs('satış iptal'), 0);
  });

  test('cancel by sales -> 403', async () => {
    await sold(['a', '1']);
    assert.equal((await cancel({ tickets: 'a-1' }, s1)).status, 403);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets WHERE status = 2'), 1);
  });

  test('state: 204 when unchanged, 200 after every change; holder names only for baskan', async () => {
    const v0 = (await s1.get(`/api/days/${day}/state`)).body.version;
    assert.equal((await s1.get(`/api/days/${day}/state?since=${v0}`)).status, 204);
    const a1 = await tid('a', '1');
    let v = v0;
    const changed = async () => {
      const r = await s2.get(`/api/days/${day}/state?since=${encodeURIComponent(v)}`);
      assert.equal(r.status, 200);
      assert.notEqual(r.body.version, v);
      v = r.body.version;
      return r.body;
    };
    await toggle(s1, a1); await changed(); // hold
    await toggle(s1, a1); await changed(); // unhold
    await toggle(s1, a1);
    await changed();
    assert.equal((await s1.post(`/api/days/${day}/sell`, { ticketIds: [a1] })).status, 200);
    await changed(); // sell
    await cancel({ tickets: 'a-1' }); await changed(); // cancel
    assert.equal((await toggle(s2, 999999)).status, 404);
    assert.equal((await s2.get(`/api/days/${day}/state?since=${encodeURIComponent(v)}`)).status, 204); // failure = no change

    await toggle(s1, a1);
    const asSales = (await s2.get(`/api/days/${day}/state`)).body;
    assert.ok(asSales.seats.every((x) => x[7] === null));
    assert.equal(asSales.sold, null);
    assert.ok(!JSON.stringify(asSales).includes('satis1'));
    const asBoss = (await boss.get(`/api/days/${day}/state`)).body;
    assert.equal(asBoss.seats.find((x) => x[0] === a1)[7], 'satis1');
    assert.equal(asBoss.seats.find((x) => x[0] === a1)[6], false);
    assert.deepEqual(asBoss.sold, { count: 0, revenue: 0 });
    assert.equal((await s1.get(`/api/days/${day}/state`)).body.seats.find((x) => x[0] === a1)[6], true);
  });
});

describe('count day', () => {
  beforeEach(async () => {
    t = await makeApp();
    s1 = await t.login('sales', 'satis1');
    s2 = await t.login('sales', 'satis2');
    boss = await t.login('superuser', 'root');
    day = (await t.seedDay({ seats: { count: 4 }, price: 55 })).dayId;
  });
  afterEach(() => t.close());
  const hold = (c) => c.post(`/api/days/${day}/count/hold`, {});
  const release = (c) => c.post(`/api/days/${day}/count/release`, {});

  test('hold/release, exhaustion, revenue, cancel N', async () => {
    let r = await s1.get(`/api/days/${day}`);
    assert.equal(r.body.day.kind, 'count');
    assert.equal(r.body.day.seatCount, 4);
    assert.equal(r.body.day.seats, null);
    assert.equal((await toggle(s1, await tid('m', '0'))).status, 400); // seated endpoint on count day

    r = await release(s1);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'Tuttuğunuz bilet yok');
    for (let i = 0; i < 3; i++) assert.equal((await hold(s1)).status, 200);
    r = await hold(s2);
    assert.equal(r.body.state.free, 0);
    assert.equal(r.body.state.mine.count, 1);
    r = await hold(s2);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'Boş bilet kalmadı');
    r = await release(s1);
    assert.equal(r.body.action, 'released');
    assert.equal(r.body.state.mine.count, 2);
    assert.equal(r.body.state.free, 1);

    const ids = r.body.state.mine.list.map((x) => x.id);
    r = await s1.post(`/api/days/${day}/sell`, { ticketIds: ids });
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 110);
    r = await boss.get(`/api/days/${day}/state`);
    assert.deepEqual(r.body.sold, { count: 2, revenue: 110 }); // quirk 10

    for (const bad of [0, -1, 'x', 3, 1.5, '', null, undefined]) {
      const c = await boss.post(`/api/days/${day}/cancel`, { count: bad });
      assert.equal(c.status, 400, String(bad));
    }
    assert.match((await boss.post(`/api/days/${day}/cancel`, { count: 3 })).body.error, /En fazla 2/);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets WHERE status = 2'), 2);
    r = await boss.post(`/api/days/${day}/cancel`, { count: '1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.cancelled.length, 1);
    assert.deepEqual(r.body.state.sold, { count: 1, revenue: 55 });
    r = await boss.post(`/api/days/${day}/cancel`, { count: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.state.sold, { count: 0, revenue: 0 });
    assert.match((await boss.post(`/api/days/${day}/cancel`, { count: 1 })).body.error, /satılmış bilet yok/);
    assert.equal(await logs('satış iptal'), 2);
  });

  test('cancel N takes the most recently sold', async () => {
    const lo = (await hold(s2)).body.state.mine.list[0];
    const hi = (await hold(s1)).body.state.mine.list[0];
    assert.ok(hi.id > lo.id);
    assert.equal((await s1.post(`/api/days/${day}/sell`, { ticketIds: [hi.id] })).status, 200);
    await new Promise((ok) => setTimeout(ok, 5));
    assert.equal((await s2.post(`/api/days/${day}/sell`, { ticketIds: [lo.id] })).status, 200);
    const r = await boss.post(`/api/days/${day}/cancel`, { count: 1 });
    assert.deepEqual(r.body.cancelled, [{ row: 'm', num: lo.num, price: 55 }]);
  });
});

test('parseSeatList unit', () => {
  assert.deepEqual(parseSeatList('a-32'), [{ row: 'a', num: '32' }]);
  assert.deepEqual(parseSeatList('A-32'), [{ row: 'a', num: '32' }]);
  assert.deepEqual(parseSeatList(' a-32 , b-25 '), [{ row: 'a', num: '32' }, { row: 'b', num: '25' }]);
  assert.deepEqual(parseSeatList('a-1A'), [{ row: 'a', num: '1A' }]);
  for (const bad of ['a32', 'a-32,', 'a-32,,b-1', ',', 'aa-1', 'a-', '-1', 'a-1-2', 'ç-1', 'a - 1']) assert.throws(() => parseSeatList(bad), { status: 400 }, bad);
});
