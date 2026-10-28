import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './test-helpers.js';

let t, b;
before(async () => { t = await makeApp(); b = await t.login('baskan'); });
after(() => t.close());

test('bad JSON -> 400 JSON error', async () => {
  const r = await b.request('POST', '/api/halls', undefined, { raw: '{"name": ' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Geçersiz JSON');
  const l = await t.client().request('POST', '/api/login', undefined, { raw: 'nope' });
  assert.equal(l.status, 400);
});

test('oversized body -> 413', async () => {
  const r = await b.post('/api/halls', { name: 'X', seats: { count: 1 }, seatPlan: { pad: 'x'.repeat(110 * 1024) } });
  assert.equal(r.status, 413);
  assert.ok(r.body.error);
});

test('non-numeric / odd ids -> 404 JSON', async () => {
  for (const id of ['abc', '0', '-1', '1.5', '1e3', '01', "1'%20OR%201=1", '99999999999999999999']) {
    const r = await b.get(`/api/halls/${id}`);
    assert.equal(r.status, 404, id);
    assert.equal(typeof r.body.error, 'string');
  }
  assert.equal((await b.put('/api/days/abc', { date: '2026-11-01T20:00' })).status, 404);
});

test('phase 4 routes: odd ids 404, oversize names / bad bodies 400, missing CSRF 403', async () => {
  const root = await t.login('superuser', 'root-v');
  for (const id of ['abc', '0', '1.5', '01', '99999999999999999999']) {
    assert.equal((await root.request('DELETE', `/api/days/${id}`, { confirm: 'x' })).status, 404, `DELETE day ${id}`);
    assert.equal((await root.request('DELETE', `/api/halls/${id}`, { confirm: 'x' })).status, 404, `DELETE hall ${id}`);
    assert.equal((await root.put(`/api/users/${id}`, { disabled: true })).status, 404, `PUT user ${id}`);
    assert.equal((await b.post(`/api/days/${id}/release`, { ticketId: 1 })).status, 404, `release ${id}`);
  }
  assert.equal((await root.put('/api/users/987654', { disabled: true })).status, 404);
  const hall = await t.seedHall({ name: 'V Salon', seats: { count: 5 } });
  const big = 'x'.repeat(5000);
  assert.equal((await b.put(`/api/halls/${hall}`, { name: big })).status, 400);
  assert.equal((await b.post('/api/users', { username: big, generate: true })).status, 400);
  assert.equal((await b.post('/api/users', { username: 'vv1', generate: true, role: 'root' })).status, 400);
  assert.equal((await root.request('DELETE', `/api/halls/${hall}`, { confirm: big })).status, 400);
  assert.equal((await b.get('/api/report?event=abc')).status, 400);
  const victim = await t.user('sales', 'victim-v');
  assert.equal((await root.put(`/api/users/${victim}`, { disabled: 'yes' })).status, 400);
  assert.equal((await root.put(`/api/users/${victim}`, { role: 'king' })).status, 400);
  assert.equal((await root.put(`/api/users/${victim}`, {})).status, 400);
  const noCsrf = { headers: { 'x-csrf-token': '' } };
  assert.equal((await root.request('PUT', `/api/users/${victim}`, { disabled: true }, noCsrf)).status, 403);
  assert.equal((await root.request('POST', `/api/users/${victim}/password`, { generate: true }, noCsrf)).status, 403);
  assert.equal((await b.request('POST', '/api/days/1/release', { ticketId: 1 }, noCsrf)).status, 403);
  assert.equal((await b.request('PUT', '/api/days/1/prices', { price: 10 }, noCsrf)).status, 403);
  assert.equal((await root.request('DELETE', `/api/halls/${hall}`, { confirm: 'V Salon' }, noCsrf)).status, 403);
  assert.equal((await root.request('DELETE', `/api/halls/${hall}`, { confirm: 'V Salon' })).status, 200); // leave the hall list as found
});

test('unknown /api -> 404 JSON; unknown method -> 404', async () => {
  const r = await b.get('/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'Bulunamadı');
  assert.equal((await b.request('PATCH', '/api/halls/1', {})).status, 404);
});

test('SQL-injection-ish strings are stored literally', async () => {
  const evil = "x'); DROP TABLE halls; --";
  const r = await b.post('/api/halls', { name: evil, seats: { count: 2 } });
  assert.equal(r.status, 201);
  assert.equal(r.body.hall.name, evil);
  const e = await b.post('/api/events', { name: `" OR 1=1 --`, hallId: r.body.hall.id });
  assert.equal(e.body.event.name, `" OR 1=1 --`);
  assert.equal((await b.get('/api/halls')).body.halls[0].name, evil);
  const u = await t.client().post('/api/login', { username: "' OR '1'='1", password: "' OR '1'='1" });
  assert.equal(u.status, 401);
});

test('wrong JSON types are rejected, not crashed on', async () => {
  for (const body of [[], 'str', 5, { name: ['a'] }, { name: { $ne: 1 } }]) {
    const r = await b.post('/api/halls', body);
    assert.ok([400].includes(r.status), `${JSON.stringify(body)} -> ${r.status}`);
  }
  const h = (await b.post('/api/halls', { name: 'H', seats: { all: [{ a: ['1'] }] } })).body.hall;
  for (const prices of [null, [], 'a:5', { a: { x: 1 } }, { a: [5] }]) {
    assert.equal((await b.put(`/api/halls/${h.id}/prices`, { prices })).status, 400, JSON.stringify(prices));
  }
  assert.equal((await b.put(`/api/halls/${h.id}/prices`, { prices: { a: 5, __proto__: { b: 1 } } })).status, 200);
});
