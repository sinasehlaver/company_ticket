import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeClient } from './test-helpers.js';
import { bootstrap, SEED_HALLS } from './bootstrap.js';
import { hashPassword, verifyPassword } from './auth.js';
import { migrate, SCHEMA_VERSION } from './db.js';

const quiet = () => {};

test('bootstrap: idempotent and never touches existing users (port of BootstrapTests)', async () => {
  const t = await makeApp();
  try {
    const env = { ADMIN_PASSWORD: 'admin-pass-123', TICKET_USER_PASSWORD: 'seller-pass-123', BASKAN_PASSWORD: 'baskan-pass-123' };
    const first = await bootstrap(t.db, env, quiet);
    assert.deepEqual(first, ['sina', 'baskan', 'mimarlik', 'kutuphane', 'carsi', 'hazirlik', 'disari', 'hall:KKM', 'hall:Mimarlık']);
    await t.db.execute({ sql: "UPDATE users SET hash = ? WHERE username = 'carsi'", args: [await hashPassword('changed')] });
    assert.deepEqual(await bootstrap(t.db, env, quiet), []);
    const carsi = (await t.db.execute("SELECT hash FROM users WHERE username = 'carsi'")).rows[0];
    assert.equal(await verifyPassword('changed', carsi.hash), true);
    const roles = Object.fromEntries((await t.db.execute('SELECT username, role FROM users')).rows.map((r) => [r.username, r.role]));
    assert.equal(roles.sina, 'superuser');
    assert.equal(roles.baskan, 'baskan');
    assert.equal(roles.disari, 'sales');
    assert.equal(Object.keys(roles).length, 7);
    const c = makeClient(t.base);
    assert.equal((await c.post('/api/login', { username: 'baskan', password: 'baskan-pass-123' })).status, 200);
  } finally { await t.close(); }
});

test('bootstrap: unset admin/başkan passwords skip them; sales get random printed passwords', async () => {
  const t = await makeApp();
  try {
    const lines = [];
    await bootstrap(t.db, { ADMIN_USERNAME: 'root', BASKAN_USERNAME: 'pres' }, (l) => lines.push(l));
    const names = (await t.db.execute('SELECT username FROM users ORDER BY id')).rows.map((r) => r.username);
    assert.deepEqual(names, ['mimarlik', 'kutuphane', 'carsi', 'hazirlik', 'disari']);
    const m = lines.find((l) => l.startsWith('created carsi with password '));
    assert.ok(m);
    const pw = m.split(' ').at(-1);
    const c = makeClient(t.base);
    assert.equal((await c.post('/api/login', { username: 'carsi', password: pw })).status, 200);
    await bootstrap(t.db, { ADMIN_USERNAME: 'root', ADMIN_PASSWORD: 'p-123456' }, quiet);
    assert.equal((await t.db.execute("SELECT role FROM users WHERE username = 'root'")).rows[0].role, 'superuser');
  } finally { await t.close(); }
});

test('bootstrap: NODE_ENV=production never logs a generated password', async () => {
  const t = await makeApp();
  try {
    const lines = [];
    await bootstrap(t.db, { NODE_ENV: 'production' }, (l) => lines.push(l));
    const pws = (await t.db.execute("SELECT COUNT(*) AS n FROM users WHERE role = 'sales'")).rows[0].n;
    assert.equal(Number(pws), 5);
    assert.ok(lines.some((l) => l === 'created carsi with a random password (set it in Hesaplar)'), lines.join('\n'));
    assert.ok(!lines.some((l) => / with password /.test(l)), lines.join('\n'));
  } finally { await t.close(); }
});

test('seed halls: KKM + Mimarlık with empty price schema, once; tombstones respected', async () => {
  const t = await makeApp();
  try {
    await bootstrap(t.db, {}, quiet);
    const halls = (await t.db.execute('SELECT uid, name, seats, seat_plan, price_schema FROM halls ORDER BY id')).rows;
    assert.deepEqual(halls.map((h) => [h.name, h.price_schema]), [['KKM', ''], ['Mimarlık', '']]);
    assert.equal(JSON.parse(halls[0].seats).all.length, 24);
    assert.ok(JSON.parse(halls[0].seat_plan).z);
    assert.deepEqual(JSON.parse(halls[1].seats), { count: 280 });
    assert.deepEqual(JSON.parse(halls[1].seat_plan), { all: [{ count: 280 }] });
    assert.deepEqual(halls.map((h) => h.uid), SEED_HALLS.map((h) => h.uid));
    await bootstrap(t.db, {}, quiet);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM halls'), 2);
    // KKM seats pass the API validator and produce a full day
    const b = await t.login('baskan', 'b');
    const kkm = (await b.get('/api/halls/1')).body.hall;
    assert.equal(kkm.rows.length, 21);
    const e = (await b.post('/api/events', { name: 'Show', hallId: 1 })).body.event;
    const prices = Object.fromEntries(kkm.rows.map((r, i) => [r, i < 5 ? 100 : 80]));
    const d = await b.post(`/api/events/${e.id}/days`, { date: '2026-11-01T20:00', prices });
    assert.equal(d.status, 201);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets WHERE day_id = ?', [d.body.day.id]), kkm.seatCount);
    assert.ok(kkm.seatCount > 700);
    const v = await b.post('/api/halls', { name: 'KKM copy', seats: kkm.seats });
    assert.equal(v.status, 201);
  } finally { await t.close(); }

  const t2 = await makeApp();
  try {
    await t2.db.execute({ sql: "INSERT INTO tombstones (uid, tbl, deleted_at) VALUES (?, 'halls', '2026-01-01T00:00:00.000Z')", args: [SEED_HALLS[0].uid] });
    await bootstrap(t2.db, {}, quiet);
    assert.deepEqual((await t2.db.execute('SELECT name FROM halls')).rows.map((r) => r.name), ['Mimarlık']);
  } finally { await t2.close(); }
});

test('migrate is idempotent and records schema_version', async () => {
  const t = await makeApp();
  try {
    assert.equal(await migrate(t.db), SCHEMA_VERSION);
    assert.equal(await migrate(t.db), SCHEMA_VERSION);
    const v = (await t.db.execute("SELECT value FROM meta WHERE key = 'schema_version'")).rows[0].value;
    assert.equal(Number(v), SCHEMA_VERSION);
    await t.db.execute("UPDATE meta SET value = '999' WHERE key = 'schema_version'");
    await assert.rejects(migrate(t.db), /newer/);
  } finally { await t.close(); }
});
