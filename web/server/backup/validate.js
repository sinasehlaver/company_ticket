// Upload + validation of a backup .db before anything touches live data (PORT_PLAN backup steps 1-2).
// No user-supplied path or filename is ever used: the body is raw bytes, the temp name is random and server-made,
// and every path is containment-checked against the private temp dir.
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, existsSync } from 'node:fs';
import { open, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { httpError } from '../auth.js';
import { openDb, migrate, SCHEMA_VERSION } from '../db.js';

export const MAX_UPLOAD = 50 * 1024 * 1024;
export const MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

/** Columns every backup must have (schema v1; later versions only add). */
export const REQUIRED = {
  meta: ['key', 'value'],
  halls: ['uid', 'name', 'seats', 'seat_plan', 'price_schema', 'updated_at'],
  events: ['uid', 'name', 'hall_id', 'updated_at'],
  days: ['uid', 'event_id', 'date', 'tickets_dict', 'updated_at'],
  users: ['uid', 'username', 'hash', 'role', 'disabled', 'updated_at', 'created_at'],
  tickets: ['uid', 'day_id', 'event_id', 'row', 'num', 'price', 'category', 'status', 'owner', 'last_modified_by', 'updated_at'],
  logs: ['uid', 'ticket_id', 'day_id', 'action', 'username', 'at'],
  tombstones: ['uid', 'tbl', 'deleted_at'],
};

let shared = null;
/** One private mkdtemp dir per process for uploads and pending imports. */
export function uploadDir() {
  if (!shared || !existsSync(shared)) shared = mkdtempSync(join(tmpdir(), 'ct-upload-'));
  return shared;
}

/** true when p is strictly inside dir (after resolving `..`). */
export function inside(dir, p) {
  const d = resolve(dir) + sep;
  return resolve(p).startsWith(d);
}

/** Random server-made file name inside dir. */
export function tempPath(dir = uploadDir()) {
  const p = join(dir, `${randomBytes(16).toString('hex')}.db`);
  if (!inside(dir, p)) throw new Error('temp path escaped its dir');
  return p;
}

export async function removeTemp(p, dir = uploadDir()) {
  if (p && inside(dir, p)) await rm(p, { force: true });
}

const raw = express.raw({ type: () => true, limit: MAX_UPLOAD });

/**
 * Reads the request body as raw bytes (any content type except JSON, which the app's JSON parser already took)
 * and writes it to a fresh temp file. -> path. 413 over 50 MB; 400 when the body isn't bytes (e.g. a JSON
 * `{path: …}`: a path is never accepted) or is empty.
 */
export async function receiveUpload(req, res, dir = uploadDir()) {
  try {
    await new Promise((ok, ko) => raw(req, res, (e) => (e ? ko(e) : ok())));
  } catch (e) {
    if (e.type === 'entity.too.large') throw httpError(413, 'Dosya çok büyük (en fazla 50 MB)');
    throw httpError(400, 'Dosya okunamadı');
  }
  if (!Buffer.isBuffer(req.body)) throw httpError(400, 'Yedek dosyası bekleniyordu (.db dosyası yükleyin)');
  if (!req.body.length) throw httpError(400, 'Dosya boş');
  const p = tempPath(dir);
  await writeFile(p, req.body, { mode: 0o600, flag: 'wx' });
  return p;
}

const bad = (msg = 'Dosya bozuk ya da bir SQLite yedeği değil') => httpError(400, msg);

/**
 * Validates a backup file in place (read-only connection): SQLite magic, integrity_check, required tables/columns,
 * meta.schema_version <= ours. An older schema is migrated (the file is our private temp copy, never the user's).
 * -> {schemaVersion, migratedFrom|null}
 */
export async function validateFile(path) {
  const fh = await open(path, 'r');
  let head;
  try {
    head = Buffer.alloc(100);
    const { bytesRead } = await fh.read(head, 0, 100, 0);
    if (bytesRead < 100 || !head.subarray(0, 16).equals(MAGIC)) throw bad();
  } finally { await fh.close(); }

  let version;
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const ic = db.prepare('PRAGMA integrity_check').all();
    if (ic.length !== 1 || ic[0].integrity_check !== 'ok') throw bad();
    for (const [table, cols] of Object.entries(REQUIRED)) {
      const have = new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name));
      if (!have.size) throw bad(`Yedekte “${table}” tablosu yok; bu dosya bu uygulamanın yedeği değil`);
      const missing = cols.filter((c) => !have.has(c));
      if (missing.length) throw bad(`Yedekte “${table}” tablosunun sütunları eksik (${missing.join(', ')})`);
    }
    const v = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    version = Number(v?.value);
  } catch (e) {
    if (e.status) throw e;
    throw bad();
  } finally {
    try { db?.close(); } catch { /* not opened */ }
  }
  if (!Number.isInteger(version) || version < 1) throw bad('Yedekte şema sürümü yok; bu dosya bu uygulamanın yedeği değil');
  if (version > SCHEMA_VERSION) {
    throw bad(`Bu yedek uygulamanın daha yeni bir sürümüyle alınmış (şema ${version}, bu sunucu ${SCHEMA_VERSION}). Önce uygulamayı güncelleyin.`);
  }
  if (version < SCHEMA_VERSION) {
    const c = openDb(`file:${path}`);
    try { await migrate(c); } catch { throw bad(); } finally { c.close(); }
    return { schemaVersion: SCHEMA_VERSION, migratedFrom: version };
  }
  return { schemaVersion: version, migratedFrom: null };
}
