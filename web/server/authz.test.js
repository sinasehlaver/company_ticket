// Walks the central route table for anon / sales / baskan / superuser and asserts 401/403 vs allowed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './test-helpers.js';
import { ROUTES } from './routes/index.js';
import { RANK } from './auth.js';

let t, ids;
before(async () => {
  t = await makeApp();
  const hall = await t.seedHall({ name: 'H', seats: { count: 3 }, priceSchema: '5' });
  const event = await t.seedEvent(hall);
  const d = await t.db.execute({ sql: "INSERT INTO days (uid, event_id, date, tickets_dict, updated_at) VALUES ('d1', ?, '2026-11-01T17:00:00.000Z', '{}', '2026-01-01T00:00:00.000Z')", args: [event] });
  ids = { hall, event, day: Number(d.lastInsertRowid), user: await t.user('sales', 'victim') };
});
after(() => t.close());

function concrete(path) {
  if (path.startsWith('/api/halls/')) return path.replace(':id', ids.hall);
  if (path.startsWith('/api/events/')) return path.replace(':id', ids.event);
  if (path.startsWith('/api/days/')) return path.replace(':id', ids.day);
  if (path.startsWith('/api/users/')) return path.replace(':id', ids.user);
  if (path.startsWith('/api/backup/snapshots/')) return path.replace(':id', '424242'); // none: 404 / typed-confirm 400
  assert.ok(!path.includes(':'), `no id mapping for ${path}`);
  return path;
}

const BODIES = { 'POST /api/halls': { name: 'N', seats: { count: 2 } }, 'POST /api/events': { name: 'E', hallId: 1 }, 'POST /api/events/:id/days': { date: '2026-11-05T20:00', price: 5 } };

test('route table is complete and sane', () => {
  assert.ok(ROUTES.length >= 15);
  const keys = ROUTES.map((r) => `${r.method} ${r.path}`);
  assert.equal(new Set(keys).size, keys.length, 'duplicate route');
  const pub = ROUTES.filter((r) => !r.minRole).map((r) => `${r.method} ${r.path}`).sort();
  assert.deepEqual(pub, ['GET /healthz', 'POST /api/login'], 'only healthz and login are public');
  for (const r of ROUTES) if (r.minRole) assert.ok(RANK[r.minRole], `${r.path} has a valid role`);
});

for (const who of ['anon', 'sales', 'baskan', 'superuser']) {
  test(`authz matrix: ${who}`, async () => {
    for (const r of ROUTES) {
      const c = who === 'anon' ? t.client() : await t.login(who, `${who}-mx`); // fresh session per route (logout kills it)
      const res = await c.request(r.method, concrete(r.path), r.method === 'GET' ? undefined : (BODIES[`${r.method} ${r.path}`] ?? {}));
      const label = `${who} ${r.method} ${r.path} -> ${res.status} ${JSON.stringify(res.body)}`;
      if (!r.minRole) assert.ok(![401, 403].includes(res.status), label);
      else if (who === 'anon') assert.equal(res.status, 401, label);
      else if (RANK[who] < RANK[r.minRole]) assert.equal(res.status, 403, label);
      else assert.ok(![401, 403].includes(res.status) && res.status < 500, label);
      if (res.status >= 400) assert.equal(typeof res.body.error, 'string', label);
    }
  });
}

test('anon and sales can never mutate', async () => {
  assert.equal(await t.count("SELECT COUNT(*) AS n FROM audit WHERE username IN ('sales-mx')"), 0); // sales can't even export (başkan+)
});

test('sales get 403 on logs and hall listing; hall detail stays (day page needs it); başkan allowed', async () => {
  const s = await t.login('sales', 'sales-sel');
  for (const p of ['/api/logs/days', `/api/days/${ids.day}/logs`, '/api/halls']) assert.equal((await s.request('GET', p)).status, 403, p);
  for (const [m, p] of [['POST', '/api/halls'], ['PUT', `/api/halls/${ids.hall}`], ['PUT', `/api/halls/${ids.hall}/prices`], ['DELETE', `/api/halls/${ids.hall}`]]) assert.equal((await s.request(m, p, {})).status, 403, `${m} ${p}`);
  assert.equal((await s.request('GET', `/api/halls/${ids.hall}`)).status, 200);
  const b = await t.login('baskan', 'baskan-sel');
  assert.equal((await b.request('GET', '/api/halls')).status, 200);
});
