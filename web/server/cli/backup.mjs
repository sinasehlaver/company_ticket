#!/usr/bin/env node
// Encrypted portable backup (same .db as the in-app download, then AES-256-GCM): used by .github/workflows/backup.yml.
//   DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… BACKUP_KEY=<32 bytes b64|hex> node server/cli/backup.mjs out.bak.enc
// Read-only on the source (a read-only Turso token is enough). Never prints the key, token or URL credentials.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, SCHEMA_VERSION } from '../db.js';
import { exportTo } from '../backup/export.js';
import { encrypt, parseKey } from '../backup/crypto.js';
import { DEFAULT_DB_URL } from '../app.js';

async function main() {
  const out = process.argv[2];
  if (!out || out.startsWith('-')) throw new Error('usage: node server/cli/backup.mjs <out.bak.enc>');
  const key = parseKey(process.env.BACKUP_KEY);
  const db = openDb(process.env.DATABASE_URL || DEFAULT_DB_URL, process.env.DATABASE_AUTH_TOKEN || undefined);
  const dir = await mkdtemp(join(tmpdir(), 'ct-cli-backup-'));
  try {
    const v = Number((await db.execute("SELECT value FROM meta WHERE key = 'schema_version'")).rows[0]?.value);
    if (!(v >= 1)) throw new Error('source DB has no schema_version (not a company-ticket DB?)');
    if (v > SCHEMA_VERSION) throw new Error(`source DB schema ${v} is newer than this code (${SCHEMA_VERSION})`);
    const { path, counts } = await exportTo(db, join(dir, 'export.db'));
    const enc = encrypt(await readFile(path), key);
    await writeFile(out, enc, { mode: 0o600 });
    const summary = Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ');
    console.log(`wrote ${out}: ${enc.length} bytes, source schema v${v} (${summary})`);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(`backup failed: ${e.message}`); process.exit(1); });
