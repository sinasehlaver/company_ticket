// Walks the central route table for anon / sales / baskan / superuser / a custom role and asserts 401/403 vs allowed.
// Expected caps per identity are spelled out here (not read from the DB), so a wrong default or a wrong route cap fails.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './test-helpers.js';
import { ROUTES } from './routes/index.js';
import { CAP_KEYS } from './roles.js';

const DOOR = { cancel: 'off', releaseOthers: false, events: false, reprice: false, halls: false, logs: true, report: true, accounts: false, backup: false, roles: false };
const EXPECT = {
  sales: { cancel: 'own' },
  baskan: Object.fromEntries(CAP_KEYS.map((k) => [k, k === 'cancel' ? 'any' : true])),
  superuser: Object.fromEntries(CAP_KEYS.map((k) => [k, k === 'cancel' ? 'any' : true])),
  'r-kapi': DOOR,
};
const has = (who, cap) => (cap === 'cancel' ? (EXPECT[who].cancel ?? 'off') !== 'off' : EXPECT[who][cap] === true);
const allowed = (who, cap) => cap === 'login' || (cap === 'superuser' ? who === 'superuser' : [].concat(cap).some((c) => has(who, c)));

let t, ids;
before(async () => {
  t = await makeApp();
  await t.db.execute({ sql: "INSERT INTO roles (uid, key, name, caps, updated_at) VALUES ('u-kapi', 'r-kapi', 'Kapı görevlisi', ?, '2026-01-01T00:00:00.000Z')", args: [JSON.stringify(DOOR)] });
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
  if (path.startsWith('/api/roles/')) return path.replace(':key', 'r-kapi'); // has accounts: DELETE -> 409, PUT {} -> 400
  if (path.startsWith('/api/backup/snapshots/')) return path.replace(':id', '424242'); // none: 404 / typed-confirm 400
  assert.ok(!path.includes(':'), `no id mapping for ${path}`);
  return path;
}

const BODIES = { 'POST /api/halls': { name: 'N', seats: { count: 2 } }, 'POST /api/events': { name: 'E', hallId: 1 }, 'POST /api/events/:id/days': { date: '2026-11-05T20:00', price: 5 } };

test('route table is complete and sane', () => {
  assert.ok(ROUTES.length >= 15);
  const keys = ROUTES.map((r) => `${r.method} ${r.path}`);
  assert.equal(new Set(keys).size, keys.length, 'duplicate route');
  const pub = ROUTES.filter((r) => !r.cap).map((r) => `${r.method} ${r.path}`).sort();
  assert.deepEqual(pub, ['GET /healthz', 'POST /api/login'], 'only healthz and login are public');
  for (const r of ROUTES) if (r.cap) for (const c of [].concat(r.cap)) assert.ok(c === 'login' || c === 'superuser' || CAP_KEYS.includes(c), `${r.path} has a valid cap (${c})`);
  // the superuser-only set never becomes a toggle
  const sup = ROUTES.filter((r) => r.cap === 'superuser').map((r) => `${r.method} ${r.path}`).sort();
  assert.deepEqual(sup, ['DELETE /api/days/:id', 'DELETE /api/events/:id', 'DELETE /api/halls/:id', 'POST /api/backup/snapshots/:id/restore']);
});

test('/api/me carries the caller\'s caps (custom role)', async () => {
  const c = await t.login('r-kapi', 'kapi-me');
  const me = (await c.get('/api/me')).body.user;
  assert.deepEqual(me.caps, DOOR);
  assert.equal(me.roleName, 'Kapı görevlisi');
});

for (const who of ['anon', 'sales', 'baskan', 'superuser', 'r-kapi']) {
  test(`authz matrix: ${who}`, async () => {
    for (const r of ROUTES) {
      const c = who === 'anon' ? t.client() : await t.login(who, `${who}-mx`); // fresh session per route (logout kills it)
      const res = await c.request(r.method, concrete(r.path), r.method === 'GET' ? undefined : (BODIES[`${r.method} ${r.path}`] ?? {}));
      const label = `${who} ${r.method} ${r.path} -> ${res.status} ${JSON.stringify(res.body)}`;
      if (!r.cap) assert.ok(![401, 403].includes(res.status), label);
      else if (who === 'anon') assert.equal(res.status, 401, label);
      else if (!allowed(who, r.cap)) assert.equal(res.status, 403, label);
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
