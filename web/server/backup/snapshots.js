// Snapshots = portable exports of the live DB stored as a blob row, taken before every import / restore; last 5 kept.
import { writeFile } from 'node:fs/promises';
import { exportBuffer } from './export.js';
import { newUid, now } from '../db.js';
import { tempPath, removeTemp } from './validate.js';

export const KEEP_SNAPSHOTS = 5;

/** -> {id, size} */
export async function takeSnapshot(db, by, reason) {
  const buf = await exportBuffer(db);
  const r = await db.execute({
    sql: 'INSERT INTO snapshots (uid, created_at, created_by, size, data, reason) VALUES (?, ?, ?, ?, ?, ?)',
    args: [newUid(), now(), by, buf.length, buf, reason],
  });
  await db.execute({ sql: 'DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT ?)', args: [KEEP_SNAPSHOTS] });
  return { id: Number(r.lastInsertRowid), size: buf.length };
}

export async function listSnapshots(db) {
  const r = await db.execute('SELECT id, created_at, created_by, size, reason FROM snapshots ORDER BY id DESC');
  return r.rows.map((s) => ({ id: Number(s.id), createdAt: s.created_at, createdBy: s.created_by, size: Number(s.size), reason: s.reason }));
}

/** -> {meta, data: Buffer} | null */
export async function getSnapshot(db, id) {
  const r = await db.execute({ sql: 'SELECT id, created_at, created_by, size, reason, data FROM snapshots WHERE id = ?', args: [id] });
  if (!r.rows.length) return null;
  const s = r.rows[0];
  return { id: Number(s.id), createdAt: s.created_at, createdBy: s.created_by, reason: s.reason, data: Buffer.from(s.data) };
}

/** Writes a snapshot blob to a private temp file, runs fn(path), removes it. */
export async function withSnapshotFile(snap, fn) {
  const p = tempPath();
  try {
    await writeFile(p, snap.data, { mode: 0o600, flag: 'wx' });
    return await fn(p);
  } finally { await removeTemp(p); }
}
