// Phase 5: backup download, two-step merge import (preview -> typed-confirm commit), snapshots (list/download/restore).
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { httpError } from '../auth.js';
import { audit } from '../db.js';
import { exportTo, exportFilename } from '../backup/export.js';
import { receiveUpload, validateFile, removeTemp } from '../backup/validate.js';
import { previewMerge, applyMerge, replaceAll, liveHolds, HoldsConflict } from '../backup/merge.js';
import { takeSnapshot, listSnapshots, getSnapshot, withSnapshotFile } from '../backup/snapshots.js';

export const CONFIRM_IMPORT = 'İÇE AKTAR';
export const CONFIRM_RESTORE = 'GERİ YÜKLE';
export const EXPORT_GAP_MS = 30 * 1000;
export const PENDING_MS = 10 * 60 * 1000;

/** Per-app state on ctx: export rate limit per user, pending uploads by token. ctx.clock overrides Date.now in tests. */
function state(ctx) {
  if (!ctx.backup) {
    const st = { lastExport: new Map(), pending: new Map(), clock: () => (ctx.clock ?? Date.now)() };
    st.sweep = async () => {
      for (const [k, e] of st.pending) if (!e.busy && e.expires <= st.clock()) { st.pending.delete(k); await removeTemp(e.path); }
    };
    setInterval(() => { st.sweep().catch(() => {}); }, 60 * 1000).unref();
    ctx.backup = st;
  }
  return ctx.backup;
}

const typed = (v) => (typeof v === 'string' ? v.trim().normalize('NFC') : '');

function holdsResponse(res, e) {
  res.status(409);
  return { error: e.message, holds: e.holds };
}

async function sendFile(res, path, name, size) {
  res.set({
    'Content-Type': 'application/vnd.sqlite3',
    'Content-Disposition': `attachment; filename="${name}"`,
    'Content-Length': String(size),
    'Cache-Control': 'no-store',
  });
  try { await pipeline(createReadStream(path), res); } catch { /* client went away */ }
}

export default function backupRoutes(route) {
  // başkan+ only: the file holds every account's password hash
  route('GET', '/api/backup/export', 'baskan', async (req, res, ctx) => {
    const st = state(ctx);
    const t = st.clock();
    const last = st.lastExport.get(req.user.id);
    if (last !== undefined && t - last < EXPORT_GAP_MS) {
      res.set('Retry-After', String(Math.ceil((EXPORT_GAP_MS - (t - last)) / 1000)));
      throw httpError(429, 'Yedek en fazla 30 saniyede bir indirilebilir. Biraz sonra tekrar deneyin.');
    }
    st.lastExport.set(req.user.id, t);
    const dir = await mkdtemp(join(tmpdir(), 'ct-export-'));
    try {
      const out = await exportTo(ctx.db, join(dir, 'export.db'));
      const name = exportFilename(new Date(t));
      await audit(ctx.db, req.user.username, 'backup.export', { size: out.size, counts: out.counts });
      await sendFile(res, out.path, name, out.size);
    } catch (e) {
      st.lastExport.delete(req.user.id);
      throw e;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  route('POST', '/api/backup/import/preview', 'baskan', async (req, res, ctx) => {
    const st = state(ctx);
    await st.sweep();
    const path = await receiveUpload(req, res);
    try {
      const schema = await validateFile(path);
      const out = await previewMerge(ctx.db, path, req.user);
      for (const [k, e] of st.pending) if (e.userId === req.user.id) { st.pending.delete(k); await removeTemp(e.path); }
      const token = randomBytes(24).toString('base64url');
      const expires = st.clock() + PENDING_MS;
      st.pending.set(token, { userId: req.user.id, path, expires });
      const warnings = [...(schema.migratedFrom ? [{ code: 'olderSchema', count: schema.migratedFrom }] : []), ...out.warnings];
      return { token, expiresAt: new Date(expires).toISOString(), report: out.report, counts: out.counts, warnings };
    } catch (e) {
      await removeTemp(path);
      if (e instanceof HoldsConflict) return holdsResponse(res, e);
      throw e;
    }
  });

  route('POST', '/api/backup/import/commit', 'baskan', async (req, res, ctx) => {
    const st = state(ctx);
    await st.sweep();
    if (typed(req.body?.confirm) !== CONFIRM_IMPORT) throw httpError(400, `Onaylamak için ${CONFIRM_IMPORT} yazın`);
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const entry = st.pending.get(token);
    if (!entry || entry.userId !== req.user.id) throw httpError(400, 'İçe aktarma oturumu bulunamadı ya da süresi doldu; dosyayı yeniden yükleyin');
    // claim the token synchronously (no await since the lookup) so a parallel commit can't apply the same file twice
    if (entry.busy) throw httpError(409, 'Bu içe aktarma zaten sürüyor');
    entry.busy = true;
    let snap, out;
    try {
      const holds = await liveHolds(ctx.db);
      if (holds.length) return holdsResponse(res, new HoldsConflict(holds)); // the upload stays pending: release, then retry
      snap = await takeSnapshot(ctx.db, req.user.username, 'import');
      out = await applyMerge(ctx.db, entry.path, req.user);
    } catch (e) {
      if (e instanceof HoldsConflict) return holdsResponse(res, e);
      throw e;
    } finally {
      entry.busy = false;
    }
    st.pending.delete(token);
    await removeTemp(entry.path);
    await audit(ctx.db, req.user.username, 'backup.import', { report: out.report, warnings: out.warnings, snapshotId: snap.id });
    return { report: out.report, warnings: out.warnings, snapshotId: snap.id };
  });

  route('GET', '/api/backup/snapshots', 'baskan', async (req, res, ctx) => ({ snapshots: await listSnapshots(ctx.db) }));

  route('GET', '/api/backup/snapshots/:id/download', 'baskan', async (req, res, ctx) => {
    const snap = await getSnapshot(ctx.db, Number(req.params.id));
    if (!snap) throw httpError(404, 'Anlık görüntü bulunamadı');
    await audit(ctx.db, req.user.username, 'backup.snapshot.download', { id: snap.id });
    res.set({
      'Content-Type': 'application/vnd.sqlite3',
      'Content-Disposition': `attachment; filename="${exportFilename(new Date(snap.createdAt), `company-ticket-snapshot-${snap.id}`)}"`,
      'Cache-Control': 'no-store',
    });
    res.send(snap.data);
  });

  route('POST', '/api/backup/snapshots/:id/restore', 'superuser', async (req, res, ctx) => {
    if (typed(req.body?.confirm) !== CONFIRM_RESTORE) throw httpError(400, `Onaylamak için ${CONFIRM_RESTORE} yazın`);
    const snap = await getSnapshot(ctx.db, Number(req.params.id));
    if (!snap) throw httpError(404, 'Anlık görüntü bulunamadı');
    const holds = await liveHolds(ctx.db);
    if (holds.length) return holdsResponse(res, new HoldsConflict(holds));
    try {
      return await withSnapshotFile(snap, async (path) => {
        await validateFile(path);
        const pre = await takeSnapshot(ctx.db, req.user.username, 'restore');
        const restored = await replaceAll(ctx.db, path);
        await audit(ctx.db, req.user.username, 'backup.restore', { id: snap.id, restored, snapshotId: pre.id });
        return { restored, snapshotId: pre.id };
      });
    } catch (e) {
      if (e instanceof HoldsConflict) return holdsResponse(res, e);
      throw e;
    }
  });
}
