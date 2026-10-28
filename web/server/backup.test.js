// Phase 5 backup: export, upload validation, newer-wins merge, holds, snapshots, restore, crypto, CLI.
// Fixtures: the live app DB is exported to a temp file, then the FILE is edited with node:sqlite to stage each rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { makeApp, PASSWORD } from './test-helpers.js';
import { exportTo, exportFilename } from './backup/export.js';
import { uploadDir, inside, tempPath, MAX_UPLOAD } from './backup/validate.js';
import { takeSnapshot, KEEP_SNAPSHOTS } from './backup/snapshots.js';
import { encrypt, decrypt, parseKey } from './backup/crypto.js';
import { openDb, migrate } from './db.js';
import { createUser } from './auth.js';

const run = promisify(execFile);
const WEB = fileURLToPath(new URL('..', import.meta.url));
const LATER = () => new Date(Date.now() + 60_000).toISOString();
const OLD = '2000-01-01T00:00:00.000Z';

const scratch = () => mkdtempSync(join(tmpdir(), 'ct-bk-test-'));

/** Live DB -> file (path), optionally edited through a writable node:sqlite handle. */
async function snapshotFile(t, edit) {
  const dir = scratch();
  const path = join(dir, 'b.db');
  await exportTo(t.db, path);
  if (edit) { const f = new DatabaseSync(path); try { edit(f); } finally { f.close(); } }
  const buf = readFileSync(path);
  rmSync(dir, { recursive: true, force: true });
  return buf;
}

const upload = (c, buf, headers = {}) => c.request('POST', '/api/backup/import/preview', undefined, { raw: buf, headers: { 'content-type': 'application/octet-stream', ...headers } });
const commit = (c, token, confirm = 'İÇE AKTAR') => c.post('/api/backup/import/commit', { token, confirm });

async function importFile(c, buf) {
  const p = await upload(c, buf);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const r = await commit(c, p.body.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { preview: p.body, ...r.body };
}

async function download(c, path = '/api/backup/export') {
  const res = await fetch(c.base + path, { headers: { cookie: c.cookie } });
  return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
}

/** App + baskan client + a 4-ticket count day. */
async function setup() {
  const t = await makeApp();
  const b = await t.login('baskan');
  b.base = t.base;
  const day = await t.seedDay({ seats: { count: 4 }, price: 50 });
  return { t, b, ...day };
}
const one = async (t, sql, args = []) => (await t.db.execute({ sql, args })).rows[0];

test('export: başkan+ only (sales 403); full SQLite file; 1 per 30 s per user; audited; no sessions/snapshots', async () => {
  const { t } = await setup();
  try {
    const sales = await t.login('sales', 'desk1');
    sales.base = t.base;
    assert.equal((await download(sales)).status, 403, 'the file holds every password hash');
    const s = await t.login('baskan', 'boss1');
    s.base = t.base;
    await takeSnapshot(t.db, 'x', 'import');
    const r = await download(s);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="company-ticket-\d{8}-\d{4}\.db"$/);
    assert.ok(r.buf.length > 0 && r.buf.subarray(0, 15).toString() === 'SQLite format 3');
    const dir = scratch();
    writeFileSync(join(dir, 'x.db'), r.buf);
    const f = new DatabaseSync(join(dir, 'x.db'), { readOnly: true });
    assert.equal(f.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    assert.equal(f.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n, 0);
    assert.equal(f.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 4);
    assert.ok(f.prepare("SELECT hash FROM users WHERE username = 'desk1'").get().hash.length > 20);
    f.close(); rmSync(dir, { recursive: true });
    const again = await download(s);
    assert.equal(again.status, 429);
    assert.ok(Number(again.headers.get('retry-after')) > 0);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM audit WHERE action = 'backup.export' AND username = 'boss1'"), 1);
    t.ctx.clock = () => Date.now() + 31_000;
    assert.equal((await download(s)).status, 200);
    assert.equal(exportFilename(new Date('2026-10-28T21:05:00Z')), 'company-ticket-20261029-0005.db'); // Istanbul = UTC+3
  } finally { await t.close(); }
});

test('merge: newer wins, older loses, tie keeps local; preview writes nothing', async () => {
  const { t, b, eventId, hallId } = await setup();
  try {
    const later = LATER();
    const buf = await snapshotFile(t, (f) => {
      f.prepare('UPDATE events SET name = ?, updated_at = ?').run('From file', later);   // newer
      f.prepare('UPDATE halls SET name = ?, updated_at = ?').run('Old hall', OLD);       // older
      f.prepare("UPDATE days SET tickets_dict = '{\"x\":1}'").run();                    // tie (same updated_at)
    });
    const p = await upload(b, buf);
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(p.body.report.events.updated, 1);
    assert.equal(p.body.report.halls.kept, 1);
    assert.equal(p.body.report.days.kept, 1);
    assert.equal(p.body.counts.file.tickets, 4);
    assert.equal((await one(t, 'SELECT name FROM events WHERE id = ?', [eventId])).name, 'Show'); // preview: no writes
    const r = await commit(b, p.body.token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await one(t, 'SELECT name FROM events WHERE id = ?', [eventId])).name, 'From file');
    assert.equal((await one(t, 'SELECT name FROM halls WHERE id = ?', [hallId])).name, 'H');
    assert.equal((await one(t, 'SELECT tickets_dict FROM days')).tickets_dict, '{}');
    assert.ok(r.body.snapshotId > 0);
    const a = await one(t, "SELECT detail FROM audit WHERE action = 'backup.import'");
    assert.equal(JSON.parse(a.detail).report.events.updated, 1);
    assert.equal((await commit(b, p.body.token)).status, 400, 'token is single-use');
  } finally { await t.close(); }
});

test('merge: rows only in the file are added with re-mapped ids; logs union', async () => {
  const { t, b } = await setup();
  try {
    const s = await t.login('sales', 'desk1');
    const dayId = Number((await one(t, 'SELECT id FROM days')).id);
    const h = await s.post(`/api/days/${dayId}/count/hold`, {});
    assert.equal((await s.post(`/api/days/${dayId}/sell`, { ticketIds: h.body.state.mine.list.map((x) => x.id) })).status, 200);
    const buf = await snapshotFile(t);
    // wipe live day data so the file is the only copy, then bump ids so they differ from the file's
    await t.db.batch(['DELETE FROM logs', 'DELETE FROM tickets', 'DELETE FROM days', 'DELETE FROM day_versions'], 'write');
    await t.seedDay({ seats: { count: 2 }, price: 10 });
    const r = await importFile(b, buf);
    assert.equal(r.report.days.added, 1);
    assert.equal(r.report.tickets.added, 4);
    assert.equal(r.report.logs.added, 1);
    const sold = await one(t, `SELECT t.status, u.username, l.action, d.id AS day FROM tickets t JOIN users u ON u.id = t.owner
      JOIN logs l ON l.ticket_id = t.id JOIN days d ON d.id = t.day_id AND d.id = l.day_id WHERE t.status = 2`);
    assert.equal(sold.username, 'desk1');
    assert.equal(sold.action, 'satış');
    assert.notEqual(Number(sold.day), dayId);
  } finally { await t.close(); }
});

test('merge: a newer file tombstone deletes the live row and its children; an older one is ignored', async () => {
  const { t, b, dayId } = await setup();
  try {
    const uid = (await one(t, 'SELECT uid FROM days WHERE id = ?', [dayId])).uid;
    const dropDay = (at) => (f) => {
      f.prepare('DELETE FROM tickets').run(); f.prepare('DELETE FROM days').run();
      f.prepare("INSERT INTO tombstones (uid, tbl, deleted_at) VALUES (?, 'days', ?)").run(uid, at);
    };
    const old = await importFile(b, await snapshotFile(t, dropDay(OLD)));
    assert.equal(old.report.days.skipped['live-newer'], 1);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM days'), 1);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tombstones'), 0);
    // başkan: the delete is skipped and flagged, nothing removed
    const later = LATER();
    const bk = await importFile(b, await snapshotFile(t, dropDay(later)));
    assert.equal(bk.preview.report.days.skipped['needs-superuser'], 1);
    assert.deepEqual(bk.preview.warnings.find((w) => w.code === 'deletesNeedSuperuser'), { code: 'deletesNeedSuperuser', count: 1 });
    assert.equal(bk.report.days.deleted, 0);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM days'), 1);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tombstones'), 0);
    // superuser: applied
    const su = await t.login('superuser', 'root');
    const r = await importFile(su, await snapshotFile(t, dropDay(later)));
    assert.equal(r.report.days.deleted, 1);
    assert.equal(r.report.tickets.deleted, 4);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM days'), 0);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets'), 0);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM tombstones WHERE tbl = 'days' AND uid = ?", [uid]), 1);
    // and the deleted day is not resurrected by an older file that still has it
    const again = await importFile(b, await snapshotFile(t, (f) => f.prepare("INSERT INTO halls (uid, name, seats, updated_at) VALUES ('h2', 'X', '{}', ?)").run(OLD)));
    assert.equal(again.report.halls.added, 1);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM days'), 0);
  } finally { await t.close(); }
});

test('merge: a live tombstone keeps an older file row deleted', async () => {
  const { t, b } = await setup();
  try {
    const buf = await snapshotFile(t); // still has the day
    const d = await one(t, 'SELECT id, date FROM days');
    const { istanbulLabel } = await import('./admin.js');
    const su = await t.login('superuser', 'root');
    assert.equal((await su.del(`/api/days/${d.id}`, { confirm: istanbulLabel(d.date) })).status, 200);
    const r = await importFile(b, buf);
    assert.equal(r.report.days.skipped.deleted, 1);
    assert.equal(r.report.tickets.skipped.orphan, 4);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM days'), 0);
  } finally { await t.close(); }
});

test('merge: a sold ticket never reverts to free, whatever the file says; file holds arrive free', async () => {
  const { t, b, dayId } = await setup();
  try {
    const buf = await snapshotFile(t, (f) => {
      f.prepare('UPDATE tickets SET updated_at = ? WHERE id IN (SELECT id FROM tickets ORDER BY id LIMIT 1)').run(LATER()); // newer + free
      f.prepare("UPDATE tickets SET status = 1, owner = (SELECT id FROM users WHERE username = 'baskan'), updated_at = ? WHERE id = (SELECT MAX(id) FROM tickets)").run(LATER());
    });
    const s = await t.login('sales', 'desk1');
    const first = Number((await one(t, 'SELECT MIN(id) AS id FROM tickets')).id);
    await t.db.execute({ sql: 'UPDATE tickets SET status = 2, owner = (SELECT id FROM users WHERE username = ?), updated_at = ? WHERE id = ?', args: ['desk1', new Date().toISOString(), first] });
    const v0 = (await s.get(`/api/days/${dayId}/state`)).body.version;
    const r = await importFile(b, buf);
    assert.equal(r.report.tickets.skipped['sold-kept'], 1);
    assert.deepEqual(r.warnings.find((w) => w.code === 'holdsDropped'), { code: 'holdsDropped', count: 1 });
    const flagged = r.preview.warnings.find((w) => w.code === 'soldCancelledInFile');
    assert.equal(flagged.count, 1);
    assert.deepEqual(flagged.days.map(({ count, seats, event }) => ({ count, seats, event })), [{ count: 1, seats: null, event: 'Show' }]); // count hall: a count per day
    assert.ok(flagged.days[0].date.startsWith('2026-11-01'));
    assert.equal(Number((await one(t, 'SELECT status FROM tickets WHERE id = ?', [first])).status), 2);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets WHERE status = 1'), 0);
    assert.notEqual((await s.get(`/api/days/${dayId}/state`)).body.version, v0, 'touched day bumps its version');
  } finally { await t.close(); }
});

test('merge: seated-hall sales cancelled in a newer file stay sold and are listed by seat label in the preview', async () => {
  const t = await makeApp();
  try {
    const b = await t.login('baskan');
    await t.user('sales', 'desk1');
    const { dayId } = await t.seedDay({ seats: { all: [{ a: ['1', '2', '10'] }, { b: ['1', '2'] }] }, prices: { a: 75, b: 60 } });
    const sell = (where) => t.db.execute({ sql: `UPDATE tickets SET status = 2, owner = (SELECT id FROM users WHERE username = 'desk1'), updated_at = ? WHERE day_id = ? AND ${where}`, args: [new Date().toISOString(), dayId] });
    const buf = await snapshotFile(t, (f) => f.prepare("UPDATE tickets SET updated_at = ? WHERE (row = 'a' AND num IN ('2', '10')) OR (row = 'b' AND num = '1')").run(LATER()));
    await sell("((row = 'a' AND num IN ('2', '10')) OR (row = 'b' AND num = '1'))");
    const p = await upload(b, buf);
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const w = p.body.warnings.find((x) => x.code === 'soldCancelledInFile');
    assert.equal(w.count, 3);
    assert.deepEqual(w.days[0].seats, ['A-2', 'A-10', 'B-1']);
    assert.equal(w.days[0].count, 3);
    assert.equal(p.body.report.tickets.skipped['sold-kept'], 3);
  } finally { await t.close(); }
});

test('merge: the importer\'s own account is untouched; başkan cannot add or change a non-sales account', async () => {
  const { t, b } = await setup();
  try {
    await t.user('sales', 'desk1');
    await t.user('superuser', 'root');
    const later = LATER();
    const buf = await snapshotFile(t, (f) => {
      f.prepare("UPDATE users SET role = 'sales', disabled = 1, hash = 'x', updated_at = ? WHERE username = 'baskan'").run(later);
      f.prepare("UPDATE users SET disabled = 1, updated_at = ? WHERE username = 'desk1'").run(later);
      f.prepare("UPDATE users SET disabled = 1, updated_at = ? WHERE username = 'root'").run(later);
      f.prepare("INSERT INTO users (uid, username, hash, role, disabled, updated_at, created_at) VALUES ('u-evil', 'evil', 'h', 'superuser', 0, ?, ?)").run(later, later);
      f.prepare("INSERT INTO users (uid, username, hash, role, disabled, updated_at, created_at) VALUES ('u-new', 'desk9', 'h', 'sales', 0, ?, ?)").run(later, later);
    });
    const r = await importFile(b, buf);
    assert.equal(r.report.users.skipped['own-account'], 1);
    assert.equal(r.report.users.skipped['needs-superuser'], 2);
    assert.equal(r.report.users.updated, 1);
    assert.equal(r.report.users.added, 1);
    const me = await one(t, "SELECT role, disabled FROM users WHERE username = 'baskan'");
    assert.deepEqual([me.role, Number(me.disabled)], ['baskan', 0]);
    assert.equal((await t.client().post('/api/login', { username: 'baskan', password: PASSWORD })).status, 200);
    assert.equal(Number((await one(t, "SELECT disabled FROM users WHERE username = 'desk1'")).disabled), 1);
    assert.equal(Number((await one(t, "SELECT disabled FROM users WHERE username = 'root'")).disabled), 0);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM users WHERE username = 'evil'"), 0);
    // a superuser importer may change other başkan/superuser accounts (still never its own)
    const su = await t.login('superuser', 'root2');
    const r2 = await importFile(su, buf);
    assert.equal(r2.report.users.added, 1); // evil
    assert.equal(Number((await one(t, "SELECT disabled FROM users WHERE username = 'root'")).disabled), 1);
  } finally { await t.close(); }
});

test('held seats block preview and commit (409 with days/counts); the upload stays pending', async () => {
  const { t, b, dayId } = await setup();
  try {
    const buf = await snapshotFile(t);
    const s = await t.login('sales', 'desk1');
    await s.post(`/api/days/${dayId}/count/hold`, {});
    const p = await upload(b, buf);
    assert.equal(p.status, 409);
    assert.deepEqual(p.body.holds.map((h) => [h.dayId, h.count]), [[dayId, 1]]);
    await s.post(`/api/days/${dayId}/count/release`, {});
    const ok = await upload(b, buf);
    assert.equal(ok.status, 200);
    await s.post(`/api/days/${dayId}/count/hold`, {});
    const c = await commit(b, ok.body.token);
    assert.equal(c.status, 409);
    assert.equal(c.body.holds[0].count, 1);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM snapshots'), 0);
    await s.post(`/api/days/${dayId}/count/release`, {});
    assert.equal((await commit(b, ok.body.token)).status, 200);
  } finally { await t.close(); }
});

test('upload validation: bad magic, truncated, newer schema, missing tables -> 400; oversize -> 413', async () => {
  const { t, b } = await setup();
  try {
    const good = await snapshotFile(t);
    const bad = await upload(b, Buffer.from('hello, this is not a database at all'.repeat(10)));
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /bozuk|SQLite/);
    const trunc = await upload(b, good.subarray(0, Math.floor(good.length / 2)));
    assert.equal(trunc.status, 400, JSON.stringify(trunc.body));
    const flipped = Buffer.from(good); flipped.fill(0x41, 4096, 8192);
    assert.equal((await upload(b, flipped)).status, 400);
    const newer = await upload(b, await snapshotFile(t, (f) => f.prepare("UPDATE meta SET value = '99' WHERE key = 'schema_version'").run()));
    assert.equal(newer.status, 400);
    assert.match(newer.body.error, /daha yeni.*şema 99/);
    const noTable = await upload(b, await snapshotFile(t, (f) => f.exec('DROP TABLE logs')));
    assert.equal(noTable.status, 400);
    assert.match(noTable.body.error, /logs/);
    const big = await upload(b, Buffer.alloc(MAX_UPLOAD + 1));
    assert.equal(big.status, 413);
    assert.deepEqual(readdirSync(uploadDir()).filter((n) => !/^[0-9a-f]{32}\.db$/.test(n)), []);
  } finally { await t.close(); }
});

test('an older-schema backup is migrated on the server-side copy and imported', async () => {
  const { t, b } = await setup();
  try {
    const buf = await snapshotFile(t, (f) => { f.exec('ALTER TABLE snapshots DROP COLUMN reason'); f.prepare("UPDATE meta SET value = '3' WHERE key = 'schema_version'").run(); });
    const p = await upload(b, buf);
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.deepEqual(p.body.warnings[0], { code: 'olderSchema', count: 3 });
  } finally { await t.close(); }
});

test('no user-supplied path: a path-like body, JSON {path} or a filename header cannot escape the temp dir', async () => {
  const { t, b } = await setup();
  try {
    const before = new Set(readdirSync(uploadDir()));
    const asText = await upload(b, Buffer.from('../../../../etc/passwd'), { 'x-filename': '../../../evil.db', 'content-disposition': 'attachment; filename="../../evil.db"' });
    assert.equal(asText.status, 400);
    const asJson = await b.post('/api/backup/import/preview', { path: '/etc/passwd', filename: '../../evil.db' });
    assert.equal(asJson.status, 400);
    assert.match(asJson.body.error, /Yedek dosyası bekleniyordu/);
    const query = await b.request('POST', '/api/backup/import/preview?path=../../etc/passwd', undefined, { raw: Buffer.from('x'), headers: { 'content-type': 'application/octet-stream' } });
    assert.equal(query.status, 400);
    assert.ok(!existsSync(resolve(uploadDir(), '../../evil.db')) && !existsSync(resolve(uploadDir(), '../evil.db')));
    assert.deepEqual(readdirSync(uploadDir()).filter((n) => !before.has(n)), [], 'rejected uploads are removed');
    assert.equal(inside(uploadDir(), join(uploadDir(), '../x.db')), false);
    assert.equal(inside(uploadDir(), tempPath()), true);
    assert.equal((await commit(b, '../../etc/passwd')).status, 400);
  } finally { await t.close(); }
});

test('authz: sales 403 on import + snapshots, başkan 403 on restore; CSRF missing -> 403; commit needs the typed text and own token', async () => {
  const { t, b } = await setup();
  try {
    const s = await t.login('sales', 'desk1');
    const buf = await snapshotFile(t);
    assert.equal((await upload(s, buf)).status, 403);
    assert.equal((await commit(s, 'x')).status, 403);
    assert.equal((await s.get('/api/backup/snapshots')).status, 403);
    const snap = await takeSnapshot(t.db, 'x', 'import');
    assert.equal((await s.get(`/api/backup/snapshots/${snap.id}/download`)).status, 403);
    assert.equal((await b.post(`/api/backup/snapshots/${snap.id}/restore`, { confirm: 'GERİ YÜKLE' })).status, 403);
    assert.equal((await upload(b, buf, { 'x-csrf-token': '' })).status, 403);
    const p = await upload(b, buf);
    const other = await t.login('baskan', 'baskan2');
    assert.equal((await commit(other, p.body.token)).status, 400, 'token bound to the uploader');
    const wrong = await commit(b, p.body.token, 'ice aktar');
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error, /İÇE AKTAR/);
    assert.equal((await b.post('/api/backup/import/commit', { token: p.body.token, confirm: 'İÇE AKTAR' }, { headers: { 'x-csrf-token': '' } })).status, 403);
    t.ctx.clock = () => Date.now() + 11 * 60_000;
    assert.equal((await commit(b, p.body.token)).status, 400, 'expired after 10 min');
  } finally { await t.close(); }
});

test('import commit: the token is claimed, so two parallel commits apply once (other gets 409)', async () => {
  const { t, b } = await setup();
  try {
    const p = await upload(b, await snapshotFile(t));
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const rs = await Promise.all([commit(b, p.body.token), commit(b, p.body.token)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409], JSON.stringify(rs.map((r) => r.body)));
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM audit WHERE action = 'backup.import'"), 1);
    assert.equal((await commit(b, p.body.token)).status, 400, 'used token is gone');
  } finally { await t.close(); }
});

test('snapshots: prune keeps the last 5; list has no blobs; download is the export file', async () => {
  const { t, b } = await setup();
  try {
    b.base = t.base;
    const ids = [];
    for (let i = 0; i < KEEP_SNAPSHOTS + 2; i++) ids.push((await takeSnapshot(t.db, 'baskan', 'import')).id);
    const l = await b.get('/api/backup/snapshots');
    assert.deepEqual(l.body.snapshots.map((s) => s.id), ids.slice(-5).reverse());
    assert.ok(!('data' in l.body.snapshots[0]) && l.body.snapshots[0].size > 0 && l.body.snapshots[0].reason === 'import');
    const d = await download(b, `/api/backup/snapshots/${ids.at(-1)}/download`);
    assert.equal(d.status, 200);
    assert.match(d.headers.get('content-disposition'), /company-ticket-snapshot-\d+-\d{8}-\d{4}\.db/);
    assert.equal(d.buf.subarray(0, 15).toString(), 'SQLite format 3');
    assert.equal((await b.get('/api/backup/snapshots/999/download')).status, 404);
  } finally { await t.close(); }
});

test('restore: superuser only, typed GERİ YÜKLE, snapshot first, data replaced, accounts + sessions untouched, blocked by holds', async () => {
  const { t, dayId, eventId } = await setup();
  try {
    const su = await t.login('superuser', 'root');
    const s = await t.login('sales', 'desk1');
    const reset = await t.login('sales', 'desk2');
    const off = await t.login('sales', 'desk3');
    const snap = await takeSnapshot(t.db, 'root', 'import');
    // account changes after the snapshot: a password reset, a disable, a new account
    const uid = async (n) => Number((await one(t, 'SELECT id FROM users WHERE username = ?', [n])).id);
    assert.equal((await su.post(`/api/users/${await uid('desk2')}/password`, { password: 'new-pass-12345' })).status, 200);
    assert.equal((await su.put(`/api/users/${await uid('desk3')}`, { disabled: true })).status, 200);
    await t.user('sales', 'late');
    await su.put(`/api/events/${eventId}`, { name: 'Renamed' });
    await t.seedDay({ seats: { count: 2 }, price: 10 });
    assert.equal((await su.post(`/api/backup/snapshots/${snap.id}/restore`, { confirm: 'geri yükle' })).status, 400);
    await s.post(`/api/days/${dayId}/count/hold`, {});
    assert.equal((await su.post(`/api/backup/snapshots/${snap.id}/restore`, { confirm: 'GERİ YÜKLE' })).status, 409);
    await s.post(`/api/days/${dayId}/count/release`, {});
    const r = await su.post(`/api/backup/snapshots/${snap.id}/restore`, { confirm: 'GERİ YÜKLE' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await one(t, 'SELECT name FROM events WHERE id = ?', [eventId])).name, 'Show');
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM days'), 1);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM tickets'), 4);
    assert.ok(r.body.snapshotId > snap.id);
    assert.equal((await su.get('/api/me')).status, 200, 'restorer keeps its session');
    assert.equal((await s.get('/api/me')).status, 200, 'other sessions survive (accounts are not restored)');
    assert.equal(r.body.restored.users, undefined);
    assert.equal((await t.client().post('/api/login', { username: 'desk2', password: PASSWORD })).status, 401, 'old password stays dead');
    assert.equal((await t.client().post('/api/login', { username: 'desk2', password: 'new-pass-12345' })).status, 200, 'reset password survives');
    assert.equal(Number((await one(t, "SELECT disabled FROM users WHERE username = 'desk3'")).disabled), 1, 'disable survives');
    assert.equal((await off.get('/api/me')).status, 401);
    assert.equal((await reset.get('/api/me')).status, 401);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM users WHERE username = 'late'"), 1);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM audit WHERE action = 'backup.restore'"), 1);
  } finally { await t.close(); }
});

test('crypto: roundtrip, tamper and wrong key fail, key formats validated', () => {
  const key = parseKey(Buffer.alloc(32, 7).toString('base64'));
  assert.deepEqual(parseKey('07'.repeat(32)), key);
  for (const badKey of ['', 'short', Buffer.alloc(16).toString('base64'), 'zz'.repeat(32)]) assert.throws(() => parseKey(badKey), /BACKUP_KEY/);
  const plain = Buffer.from('SQLite format 3\0 payload');
  const enc = encrypt(plain, key);
  assert.equal(enc.subarray(0, 4).toString(), 'CTB1');
  assert.equal(enc.length, 4 + 12 + plain.length + 16);
  assert.deepEqual(decrypt(enc, key), plain);
  const badTag = Buffer.from(enc); badTag[badTag.length - 1] ^= 1;
  assert.throws(() => decrypt(badTag, key), /decryption failed/);
  const badBody = Buffer.from(enc); badBody[20] ^= 1;
  assert.throws(() => decrypt(badBody, key), /decryption failed/);
  assert.throws(() => decrypt(enc, parseKey(Buffer.alloc(32, 8).toString('base64'))), /decryption failed/);
  assert.throws(() => decrypt(plain, key), /CTB1/);
});

test('CLI: backup.mjs -> encrypted file; restore.mjs dry run changes nothing, --apply merges with a snapshot', async () => {
  const dir = scratch();
  try {
    const src = `file:${join(dir, 'src.db')}`;
    const dst = `file:${join(dir, 'dst.db')}`;
    const a = openDb(src);
    await migrate(a);
    await createUser(a, { username: 'desk1', password: PASSWORD, role: 'sales' });
    await a.execute("INSERT INTO halls (uid, name, seats, updated_at) VALUES ('h1', 'KKM', '{\"count\":3}', '2026-01-01T00:00:00.000Z')");
    a.close();
    const key = Buffer.alloc(32, 3).toString('base64');
    const env = { ...process.env, DATABASE_URL: src, BACKUP_KEY: key, DATABASE_AUTH_TOKEN: '' };
    delete env.TEST_DB_URL;
    const out = join(dir, 'b.bak.enc');
    const bk = await run(process.execPath, ['server/cli/backup.mjs', out], { cwd: WEB, env });
    assert.match(bk.stdout, /wrote/);
    assert.ok(!bk.stdout.includes(key) && !bk.stderr.includes(key));
    assert.equal(readFileSync(out).subarray(0, 4).toString(), 'CTB1');
    const renv = { ...env, DATABASE_URL: dst };
    const dry = await run(process.execPath, ['server/cli/restore.mjs', out], { cwd: WEB, env: renv });
    assert.match(dry.stdout, /DRY RUN/);
    assert.match(dry.stdout, /halls\s+added 1/);
    const b = openDb(dst);
    assert.equal(Number((await b.execute('SELECT COUNT(*) AS n FROM halls')).rows[0].n), 0);
    b.close();
    const ap = await run(process.execPath, ['server/cli/restore.mjs', out, '--apply'], { cwd: WEB, env: renv });
    assert.match(ap.stdout, /APPLIED/);
    const c = openDb(dst);
    assert.equal(Number((await c.execute('SELECT COUNT(*) AS n FROM halls')).rows[0].n), 1);
    assert.equal(Number((await c.execute("SELECT COUNT(*) AS n FROM snapshots WHERE reason = 'cli'")).rows[0].n), 1);
    assert.equal(Number((await c.execute("SELECT COUNT(*) AS n FROM audit WHERE action = 'backup.import' AND username = 'cli'")).rows[0].n), 1);
    c.close();
    await assert.rejects(run(process.execPath, ['server/cli/restore.mjs', out], { cwd: WEB, env: { ...renv, BACKUP_KEY: Buffer.alloc(32, 4).toString('base64') } }), /wrong BACKUP_KEY/);
    await assert.rejects(run(process.execPath, ['server/cli/backup.mjs', out], { cwd: WEB, env: { ...env, BACKUP_KEY: 'nope' } }), /BACKUP_KEY must be 32 bytes/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
