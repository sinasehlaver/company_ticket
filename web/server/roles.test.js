// Roles as data (docs/ROLES_PLAN.md): roles API input + privilege-escalation guards, accounts with custom roles,
// the v5 users-table rebuild, and roles through backup export/merge.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeApp } from './test-helpers.js';
import { openDb, migrate, MIGRATIONS, splitSql, SCHEMA_VERSION } from './db.js';
import { exportTo } from './backup/export.js';
import { applyMerge } from './backup/merge.js';
import { DatabaseSync } from 'node:sqlite';
import { parseCaps, parseRoleName, capsWithin, roleChangeProblem, ALL_CAPS, NO_CAPS, DEFAULTS } from './roles.js';

const caps = (o = {}) => ({ ...NO_CAPS, ...o });

describe('roles: pure', () => {
  test('parseCaps whitelists keys and values', () => {
    assert.deepEqual(parseCaps({ cancel: 'own', logs: true }), caps({ cancel: 'own', logs: true }));
    for (const bad of [null, [], 'x', { admin: true }, { cancel: 'all' }, { logs: 1 }, { __proto__: { roles: true }, x: 1 }]) {
      assert.equal(typeof parseCaps(bad), 'string', JSON.stringify(bad));
    }
    assert.equal(typeof parseCaps(JSON.parse('{"__proto__": {"roles": true}}')), 'string', 'own __proto__ key = unknown cap');
  });
  test('parseRoleName: trims, Turkish letters ok, junk/long rejected', () => {
    assert.equal(parseRoleName('  Kapı   görevlisi ').name, 'Kapı görevlisi');
    for (const bad of ['', '   ', 'x'.repeat(41), '<script>', 'a;b', '-lead', 5, null]) assert.ok(parseRoleName(bad).error, String(bad));
  });
  test('capsWithin: cancel off < own < any', () => {
    assert.ok(capsWithin(caps({ cancel: 'own' }), caps({ cancel: 'any' })));
    assert.ok(!capsWithin(caps({ cancel: 'any' }), caps({ cancel: 'own' })));
    assert.ok(!capsWithin(caps({ backup: true }), caps({ cancel: 'any' })));
  });
  test('roleChangeProblem: superuser locked; baskan only by superuser; no granting what you lack', () => {
    const sup = { role: 'superuser', caps: ALL_CAPS };
    const boss = { role: 'baskan', caps: ALL_CAPS };
    const lead = { role: 'r-lead', caps: caps({ roles: true, logs: true, cancel: 'own' }) };
    assert.match(roleChangeProblem(sup, 'superuser', ALL_CAPS, ALL_CAPS), /değiştirilemez/);
    assert.equal(roleChangeProblem(sup, 'baskan', ALL_CAPS, NO_CAPS), null);
    assert.match(roleChangeProblem(boss, 'baskan', ALL_CAPS, ALL_CAPS), /yalnızca süper/);
    assert.equal(roleChangeProblem(boss, 'sales', DEFAULTS.sales, ALL_CAPS), null);
    assert.equal(roleChangeProblem(lead, '', null, caps({ logs: true })), null);
    assert.match(roleChangeProblem(lead, '', null, caps({ report: true })), /Kendinizde olmayan/);
    assert.match(roleChangeProblem(lead, 'sales', DEFAULTS.sales, caps({ cancel: 'any' })), /Kendinizde olmayan/);
    assert.match(roleChangeProblem(lead, 'r-x', caps({ backup: true }), NO_CAPS), /sizde olmayan/);
    assert.match(roleChangeProblem({ role: 'sales', caps: DEFAULTS.sales }, '', null, NO_CAPS), /yetkiniz yok/);
  });
});

describe('roles: API', () => {
  let t, root, boss, sales;
  before(async () => {
    t = await makeApp();
    root = await t.login('superuser', 'root');
    boss = await t.login('baskan');
    sales = await t.login('sales', 'satis1');
  });
  after(() => t.close());

  test('GET lists superuser (locked) + built-ins with defaults and editability per caller', async () => {
    const r = await boss.get('/api/roles');
    assert.equal(r.status, 200);
    const by = Object.fromEntries(r.body.roles.map((x) => [x.key, x]));
    assert.deepEqual(Object.keys(by).slice(0, 3), ['superuser', 'baskan', 'sales']);
    assert.deepEqual(by.sales.caps, DEFAULTS.sales);
    assert.deepEqual(by.baskan.caps, ALL_CAPS);
    assert.equal(by.superuser.editable, false);
    assert.equal(by.baskan.editable, false);
    assert.equal(by.sales.editable, true);
    assert.deepEqual(r.body.roles.filter((x) => x.assignable).map((x) => x.key), ['sales']);
    assert.equal((await root.get('/api/roles')).body.roles.find((x) => x.key === 'baskan').editable, true);
    assert.equal((await sales.get('/api/roles')).status, 403);
  });

  test('create / rename / edit / delete a custom role; input validated; audit written', async () => {
    let r = await boss.post('/api/roles', { name: 'Kapı görevlisi', caps: { logs: true } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const key = r.body.role.key;
    assert.match(key, /^r-[0-9a-f]{12}$/);
    assert.deepEqual(r.body.role.caps, caps({ logs: true }));
    for (const [body, st] of [
      [{ name: 'kapı GÖREVLİSİ' }, 409], [{ name: 'Süper kullanıcı' }, 409], [{ name: '' }, 400], [{ name: 'x'.repeat(41) }, 400],
      [{ name: 'Ok', caps: { superpower: true } }, 400], [{ name: 'Ok', caps: { cancel: 'everything' } }, 400], [{ name: 'Ok', caps: 'all' }, 400],
    ]) assert.equal((await boss.post('/api/roles', body)).status, st, JSON.stringify(body));
    r = await boss.put(`/api/roles/${key}`, { name: 'Kapı', caps: { logs: true, cancel: 'own' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.role.name, 'Kapı');
    assert.equal((await boss.put(`/api/roles/${key}`, { name: 'Kapı', caps: { logs: true, cancel: 'own' } })).status, 400); // no change
    assert.equal((await boss.put('/api/roles/sales', { name: 'Satıcı' })).status, 400, 'built-in names are fixed');
    assert.equal((await boss.put('/api/roles/r-nope', { caps: {} })).status, 404);
    assert.equal((await boss.put('/api/roles/..%2Fx', { caps: {} })).status, 404);
    assert.equal((await boss.del('/api/roles/sales')).status, 400);
    assert.equal((await boss.del(`/api/roles/${key}`)).status, 200);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM audit WHERE action LIKE 'role.%'"), 3);
  });

  test('baskan cannot edit baskan or superuser; superuser edits baskan; superuser role never editable', async () => {
    assert.equal((await boss.put('/api/roles/baskan', { caps: { ...ALL_CAPS, backup: false } })).status, 403);
    assert.equal((await boss.put('/api/roles/superuser', { caps: {} })).status, 403);
    assert.equal((await root.put('/api/roles/superuser', { caps: {} })).status, 403);
    assert.equal((await root.del('/api/roles/baskan')).status, 400);
    const r = await root.put('/api/roles/baskan', { caps: { ...ALL_CAPS, backup: false } });
    assert.equal(r.status, 200);
    // caps apply on the next request (read through the session join), no re-login
    assert.equal((await boss.get('/api/backup/snapshots')).status, 403);
    assert.equal((await boss.get('/api/me')).body.user.caps.backup, false);
    // and now baskan can't grant backup either
    assert.equal((await boss.post('/api/roles', { name: 'Yedekçi', caps: { backup: true } })).status, 403);
    assert.equal((await root.put('/api/roles/baskan', { caps: ALL_CAPS })).status, 200);
  });

  test('a non-baskan role manager: only caps it has, only roles within its caps', async () => {
    const lead = (await root.post('/api/roles', { name: 'Ekip lideri', caps: { roles: true, accounts: true, logs: true, cancel: 'own' } })).body.role.key;
    const rich = (await root.post('/api/roles', { name: 'Muhasebe', caps: { report: true } })).body.role.key;
    const c = await t.login(lead, 'lider1');
    assert.equal((await c.post('/api/roles', { name: 'Gözcü', caps: { logs: true } })).status, 201);
    assert.equal((await c.post('/api/roles', { name: 'Gözcü2', caps: { report: true } })).status, 403);
    assert.equal((await c.put('/api/roles/sales', { caps: { cancel: 'any' } })).status, 403);
    assert.equal((await c.put(`/api/roles/${rich}`, { caps: {} })).status, 403, 'role with caps beyond the editor');
    assert.equal((await c.del(`/api/roles/${rich}`)).status, 403);
    // its own role: can't add caps it lacks
    assert.equal((await c.put(`/api/roles/${lead}`, { caps: { roles: true, accounts: true, logs: true, cancel: 'any' } })).status, 403);
    // accounts: can create users of a role within its caps, not of a richer one, never baskan/superuser
    assert.equal((await c.post('/api/users', { username: 'gozcu1', role: 'sales', generate: true })).status, 201);
    assert.equal((await c.post('/api/users', { username: 'muh1', role: rich, generate: true })).status, 400);
    assert.equal((await c.post('/api/users', { username: 'b9', role: 'baskan', generate: true })).status, 400);
    const list = (await c.get('/api/users')).body.users;
    assert.equal(list.find((u) => u.username === 'baskan').canManage, false);
    assert.equal(list.find((u) => u.username === 'gozcu1').canManage, true);
    assert.equal(list.find((u) => u.username === 'lider1').canManage, false, 'never self');
  });

  test('accounts: custom role assignable; unknown role 400; superuser not creatable via POST; delete blocked while in use', async () => {
    const key = (await boss.post('/api/roles', { name: 'Kasiyer', caps: { cancel: 'any' } })).body.role.key;
    let r = await boss.post('/api/users', { username: 'kasa1', role: key, generate: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.user.roleName, 'Kasiyer');
    assert.equal((await boss.post('/api/users', { username: 'x1', role: 'r-ghost', generate: true })).status, 400);
    assert.equal((await boss.post('/api/users', { username: 'x2', role: { $ne: 1 }, generate: true })).status, 400);
    assert.equal((await root.post('/api/users', { username: 'x3', role: 'superuser', generate: true })).status, 400);
    r = await boss.del(`/api/roles/${key}`);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /1 hesap bu rolde/);
    assert.equal((await boss.put(`/api/users/${r.body.id ?? (await t.user(key, 'kasa1'))}`, { role: 'sales' })).status, 200);
    assert.equal((await boss.del(`/api/roles/${key}`)).status, 200);
    // the user with a sales role can be moved to a custom role by baskan (role changes are no longer superuser-only)
    const k2 = (await boss.post('/api/roles', { name: 'Gişe', caps: { cancel: 'own' } })).body.role.key;
    assert.equal((await boss.put(`/api/users/${await t.user('sales', 'kasa1')}`, { role: k2 })).body.user.role, k2);
    assert.equal((await boss.put(`/api/users/${await t.user('sales', 'kasa1')}`, { role: 'baskan' })).status, 400);
  });
});

test('migration v5: users keep ids/roles/sessions, CHECK gone, built-in roles seeded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ct-mig-'));
  const db = openDb(`file:${join(dir, 'v4.db')}`);
  try {
    await db.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    for (const m of MIGRATIONS.filter((x) => x.version <= 4)) await db.batch([...splitSql(m.sql), { sql: "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [String(m.version)] }], 'write');
    await db.batch([
      "INSERT INTO users (id, uid, username, hash, role, updated_at, created_at) VALUES (7, 'u7', 'eski', 'h', 'baskan', 't', 't')",
      "INSERT INTO sessions (id_hash, user_id, csrf, expires_at, created_at) VALUES ('s', 7, 'c', 'x', 'x')",
    ], 'write');
    await assert.rejects(db.execute("INSERT INTO users (uid, username, hash, role, updated_at, created_at) VALUES ('u8', 'n', 'h', 'r-x', 't', 't')"));
    assert.equal(await migrate(db), SCHEMA_VERSION);
    const u = (await db.execute('SELECT id, role FROM users WHERE username = ?', ['eski'])).rows[0];
    assert.deepEqual([Number(u.id), u.role], [7, 'baskan']);
    assert.equal((await db.execute('SELECT COUNT(*) AS n FROM sessions WHERE user_id = 7')).rows[0].n, 1);
    await db.execute("INSERT INTO users (uid, username, hash, role, updated_at, created_at) VALUES ('u8', 'n', 'h', 'r-x', 't', 't')");
    assert.deepEqual((await db.execute('SELECT key FROM roles ORDER BY key')).rows.map((x) => x.key), ['baskan', 'sales']);
    assert.equal((await db.execute('PRAGMA foreign_keys')).rows[0].foreign_keys, 1);
    await assert.rejects(db.execute("INSERT INTO sessions (id_hash, user_id, csrf, expires_at, created_at) VALUES ('s2', 999, 'c', 'x', 'x')"), /FOREIGN KEY/);
    assert.equal(await migrate(db), SCHEMA_VERSION, 'idempotent');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('backup: custom roles + their users travel; a baskan import cannot change baskan; unknown-role users skipped', async () => {
  const t = await makeApp();
  const dir = mkdtempSync(join(tmpdir(), 'ct-rbk-'));
  try {
    const path = join(dir, 'a.db');
    await exportTo(t.db, path);
    const LATER = new Date(Date.now() + 60_000).toISOString();
    const f = new DatabaseSync(path);
    try {
      const ins = f.prepare('INSERT INTO roles (uid, key, name, caps, updated_at) VALUES (?, ?, ?, ?, ?)');
      ins.run('ru1', 'r-kapi', 'Kapı', JSON.stringify(caps({ logs: true })), LATER);
      ins.run('ru2', 'r-rich', 'Yedekçi', JSON.stringify(caps({ backup: true, roles: true })), LATER);
      f.prepare("UPDATE roles SET caps = ?, updated_at = ? WHERE key = 'baskan'").run(JSON.stringify({ ...ALL_CAPS, backup: false }), LATER);
      f.prepare("INSERT INTO users (uid, username, hash, role, disabled, updated_at, created_at) VALUES ('uu1', 'kapi1', 'h', 'r-kapi', 0, ?, ?)").run(LATER, LATER);
      f.prepare("INSERT INTO users (uid, username, hash, role, disabled, updated_at, created_at) VALUES ('uu2', 'ghost1', 'h', 'r-ghost', 0, ?, ?)").run(LATER, LATER);
    } finally { f.close(); }
    const bk = await t.login('baskan');
    let out = await applyMerge(t.db, path, bk.user);
    assert.equal(out.report.roles.added, 2, JSON.stringify(out.report.roles));
    assert.equal(out.report.roles.skipped['needs-superuser'], 1);
    assert.equal(out.report.users.skipped['unknown-role'], 1);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM users WHERE username = 'kapi1' AND role = 'r-kapi'"), 1);
    assert.deepEqual(JSON.parse((await t.db.execute("SELECT caps FROM roles WHERE key = 'baskan'")).rows[0].caps), ALL_CAPS);
    // CLI (superuser rights): the rest comes in
    out = await applyMerge(t.db, path, null);
    assert.equal(out.report.roles.updated, 1, JSON.stringify(out.report.roles));
    assert.equal(JSON.parse((await t.db.execute("SELECT caps FROM roles WHERE key = 'baskan'")).rows[0].caps).backup, false);
  } finally { await t.close(); rmSync(dir, { recursive: true, force: true }); }
});
