#!/usr/bin/env node
// Merge-restore a backup into DATABASE_URL (the same newer-wins merge as the in-app import): used by
// .github/workflows/restore.yml. Dry run by default (prints the diff report, writes nothing but migrations);
// --apply takes a snapshot (reason 'cli') and merges, audited as user 'cli'.
// The CLI has superuser rights in the merge (importer null): file tombstones may delete.
//   DATABASE_URL=… DATABASE_AUTH_TOKEN=… BACKUP_KEY=… node server/cli/restore.mjs in.bak.enc [--apply]
// Accepts an encrypted CTB1 file or a plain .db (an in-app download). Never prints secrets; row contents only as day/event/seat labels of flagged sales.
import { readFile, writeFile } from 'node:fs/promises';
import { openDb, migrate, audit } from '../db.js';
import { decrypt, isEncrypted, parseKey } from '../backup/crypto.js';
import { validateFile, tempPath, removeTemp, MAGIC } from '../backup/validate.js';
import { previewMerge, applyMerge, liveHolds, HoldsConflict } from '../backup/merge.js';
import { takeSnapshot } from '../backup/snapshots.js';
import { DEFAULT_DB_URL } from '../app.js';

function printReport(report) {
  for (const [tbl, r] of Object.entries(report)) {
    if (tbl === 'tombstones') { console.log(`  ${tbl.padEnd(10)} added ${r.added}`); continue; }
    const sk = Object.entries(r.skipped).map(([k, n]) => `${k} ${n}`).join(', ');
    console.log(`  ${tbl.padEnd(10)} added ${r.added} · updated ${r.updated} · deleted ${r.deleted} · kept ${r.kept}${sk ? ` · skipped: ${sk}` : ''}`);
  }
}

function printWarnings(warnings) {
  for (const w of warnings) {
    console.log(`  warning: ${w.code} ${w.count}`);
    // soldCancelledInFile: sold here, cancelled in the file -> kept sold; cancel by hand if needed
    for (const d of w.days ?? []) console.log(`    ${d.date} ${d.event ?? ''}: ${d.seats ? d.seats.join(', ') : `${d.count} tickets`}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) throw new Error('usage: node server/cli/restore.mjs <backup.bak.enc|.db> [--apply]');
  let buf = await readFile(file);
  if (isEncrypted(buf)) buf = decrypt(buf, parseKey(process.env.BACKUP_KEY));
  else if (!buf.subarray(0, 16).equals(MAGIC)) throw new Error('not a company-ticket backup (neither CTB1 nor SQLite)');
  const tmp = tempPath();
  await writeFile(tmp, buf, { mode: 0o600, flag: 'wx' });
  const db = openDb(process.env.DATABASE_URL || DEFAULT_DB_URL, process.env.DATABASE_AUTH_TOKEN || undefined);
  try {
    const v = await validateFile(tmp).catch((e) => { throw new Error(e.message); });
    await migrate(db); // an empty DB needs the tables first (idempotent)
    if (v.migratedFrom) console.log(`backup schema v${v.migratedFrom} migrated to v${v.schemaVersion} on the temp copy`);
    const holds = await liveHolds(db);
    if (holds.length) throw new HoldsConflict(holds);
    if (!apply) {
      const p = await previewMerge(db, tmp, null);
      console.log('DRY RUN: nothing was changed. Re-run with --apply to merge.');
      console.log(`  file: ${JSON.stringify(p.counts.file)}`);
      console.log(`  live: ${JSON.stringify(p.counts.live)}`);
      printReport(p.report);
      printWarnings(p.warnings);
      return;
    }
    const snap = await takeSnapshot(db, 'cli', 'cli');
    const out = await applyMerge(db, tmp, null);
    await audit(db, 'cli', 'backup.import', { report: out.report, warnings: out.warnings, snapshotId: snap.id });
    console.log(`APPLIED (snapshot #${snap.id} taken first; restore it from Settings → Yedek as superuser to undo)`);
    printReport(out.report);
    printWarnings(out.warnings);
  } finally {
    db.close();
    await removeTemp(tmp);
  }
}

main().catch((e) => {
  console.error(`restore failed: ${e.message}`);
  if (e.holds) for (const h of e.holds) console.error(`  held: day ${h.dayId} ${h.date} ${h.event}: ${h.count}`);
  process.exit(1);
});
