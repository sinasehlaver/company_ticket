// libsql client (file: locally, libsql:// / https:// for Turso), migrations, tx() helper.
import { createClient } from '@libsql/client';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));

// Ordered list; a migration's statements + the version bump run in one atomic batch.
export const MIGRATIONS = [
  { version: 1, sql: readFileSync(resolve(here, 'schema.sql'), 'utf8') },
  // Per-day change counter for GET /api/days/:id/state (not syncable: no uid/updated_at, rebuilt on demand).
  { version: 2, sql: 'CREATE TABLE IF NOT EXISTS day_versions (day_id INTEGER PRIMARY KEY, version INTEGER NOT NULL)' },
  // Last successful login per user (not syncable, not in backups' merge: local bookkeeping only).
  { version: 3, sql: 'CREATE TABLE IF NOT EXISTS user_logins (user_id INTEGER PRIMARY KEY, at TEXT NOT NULL)' },
  // Why a snapshot was taken ('import' | 'restore' | 'cli'); snapshots themselves are never exported.
  { version: 4, sql: "ALTER TABLE snapshots ADD COLUMN reason TEXT NOT NULL DEFAULT ''" },
];
export const SCHEMA_VERSION = MIGRATIONS.at(-1).version;

export const now = () => new Date().toISOString();
export const newUid = () => randomUUID();

export function splitSql(sql) {
  return sql
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
}

export function openDb(url, authToken) {
  if (url.startsWith('file:')) {
    const path = url.slice(5).split('?')[0];
    if (path && path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const client = createClient(authToken ? { url, authToken } : { url });
  return url.startsWith('file:') ? serializeWrites(client) : client;
}

/**
 * file: mode only. The libsql client pools connections and opens them with busy timeout 0, so two
 * write transactions in flight (or an autocommit write while a tx awaits) fail with SQLITE_BUSY, and a
 * busy timeout would block the event loop the tx holder needs. One in-process FIFO lock over every
 * write (non-SELECT execute, non-read batch, write transaction until commit/rollback/close) fixes both.
 * Remote (sqld/Turso) clients are returned as is: the server serializes writers.
 */
function serializeWrites(client) {
  let tail = Promise.resolve();
  const lock = () => {
    let release;
    const held = new Promise((r) => { release = r; });
    const ready = tail.then(() => release);
    tail = tail.then(() => held);
    return ready;
  };
  const isRead = (stmt) => /^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(typeof stmt === 'string' ? stmt : stmt.sql);
  const locked = async (fn) => { const release = await lock(); try { return await fn(); } finally { release(); } };
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'execute') return (stmt, args) => (isRead(stmt) ? target.execute(stmt, args) : locked(() => target.execute(stmt, args)));
      if (prop === 'batch') return (stmts, mode) => (mode === 'read' ? target.batch(stmts, mode) : locked(() => target.batch(stmts, mode)));
      if (prop === 'executeMultiple') return (sql) => locked(() => target.executeMultiple(sql));
      if (prop === 'transaction') {
        return async (mode = 'write') => {
          if (mode === 'read') return target.transaction(mode);
          const release = await lock();
          let t;
          try { t = await target.transaction(mode); } catch (e) { release(); throw e; }
          let done = false;
          const end = () => { if (!done) { done = true; release(); } };
          return new Proxy(t, {
            get(tt, p) {
              const v = Reflect.get(tt, p);
              if (typeof v !== 'function') return v;
              if (p === 'commit' || p === 'rollback') return async (...a) => { try { return await v.apply(tt, a); } finally { end(); } };
              if (p === 'close') return (...a) => { try { return v.apply(tt, a); } finally { end(); } };
              return v.bind(tt);
            },
          });
        };
      }
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

export async function schemaVersion(db) {
  await db.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const r = await db.execute("SELECT value FROM meta WHERE key = 'schema_version'");
  return r.rows.length ? Number(r.rows[0].value) : 0;
}

/** Applies every migration newer than meta.schema_version. Idempotent. */
export async function migrate(db) {
  const current = await schemaVersion(db);
  if (current > SCHEMA_VERSION) throw new Error(`DB schema ${current} is newer than this server (${SCHEMA_VERSION})`);
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.batch([
      ...splitSql(m.sql),
      { sql: "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [String(m.version)] },
    ], 'write');
  }
  return SCHEMA_VERSION;
}

/** Runs fn(t) in one interactive write transaction; commits on success, rolls back on throw. */
export async function tx(db, fn) {
  const t = await db.transaction('write');
  try {
    const out = await fn(t);
    await t.commit();
    return out;
  } catch (e) {
    try { await t.rollback(); } catch { /* already closed */ }
    throw e;
  } finally {
    t.close();
  }
}

/** Appends an audit row. detail is any JSON-able value. */
export async function audit(db, username, action, detail = {}) {
  await db.execute({ sql: 'INSERT INTO audit (at, username, action, detail) VALUES (?, ?, ?, ?)', args: [now(), username, action, JSON.stringify(detail)] });
}
