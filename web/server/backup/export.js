// Portable export: a NEW local SQLite file (libsql file:) with the full schema (all migrations, so meta.schema_version =
// ours) and every syncable row copied from the source inside ONE read transaction. Works the same whether the source
// is a file: DB or Turso/sqld (no VACUUM INTO, no file copy). Never exported: sessions (live logins), snapshots (would
// nest), day_versions / user_logins (local bookkeeping, rebuilt). Users go in WITH password hashes (PORT_PLAN: the
// file is sensitive). Integer ids are kept so a snapshot restore can put rows back verbatim; merge matches by uid.
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate } from '../db.js';
import { IST_OFFSET_MIN } from '../seats.js';

/** Parent-first: inserts into the export respect the FK order. */
export const EXPORT_TABLES = ['halls', 'events', 'days', 'users', 'tickets', 'logs', 'tombstones', 'audit'];
const CHUNK = 300;

async function columnsOf(exec, table) {
  const r = await exec.execute(`PRAGMA table_info("${table}")`);
  return r.rows.map((c) => String(c.name));
}

/** Copies every EXPORT_TABLES row of `db` into a fresh SQLite file at `path`. -> {path, size, counts} */
export async function exportTo(db, path) {
  const out = openDb(`file:${path}`);
  const counts = {};
  try {
    await migrate(out);
    const t = await db.transaction('read');
    const data = [];
    try {
      for (const table of EXPORT_TABLES) {
        const r = await t.execute(`SELECT * FROM "${table}" ORDER BY rowid`);
        data.push([table, r.columns, r.rows]);
      }
    } finally { t.close(); }
    for (const [table, srcCols, rows] of data) {
      // Only columns both sides have: a source on an older schema still exports (new columns take their defaults).
      const want = new Set(await columnsOf(out, table));
      const idx = srcCols.map((c, i) => [c, i]).filter(([c]) => want.has(c));
      const sql = `INSERT INTO "${table}" (${idx.map(([c]) => `"${c}"`).join(', ')}) VALUES (${idx.map(() => '?').join(', ')})`;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await out.batch(rows.slice(i, i + CHUNK).map((row) => ({ sql, args: idx.map(([, j]) => row[j] ?? null) })), 'write');
      }
      counts[table] = rows.length;
    }
    await out.execute({ sql: "INSERT INTO meta (key, value) VALUES ('exported_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [new Date().toISOString()] });
  } finally {
    out.close();
  }
  return { path, size: (await stat(path)).size, counts };
}

/** Runs fn(path) with a fresh export in a private mkdtemp dir; the dir is always removed afterwards. */
export async function withExport(db, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'ct-export-'));
  try {
    const path = join(dir, 'export.db');
    await exportTo(db, path);
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Export as bytes (snapshots, CLI). */
export async function exportBuffer(db) {
  return withExport(db, (p) => readFile(p));
}

/** 'company-ticket-YYYYMMDD-HHMM.db' in Istanbul time (fixed UTC+3). */
export function exportFilename(date = new Date(), prefix = 'company-ticket') {
  const d = new Date(date.getTime() + IST_OFFSET_MIN * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${prefix}-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}.db`;
}
