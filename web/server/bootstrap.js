// Idempotent first-boot setup (port of management/commands/bootstrap.py + hall seed).
// Never touches existing users. Seeds halls only when the halls table is empty and the
// seed hall was not deleted on purpose (tombstone with its fixed uid).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { now } from './db.js';
import { createUser } from './auth.js';

const here = dirname(fileURLToPath(import.meta.url));
export const STAFF = ['mimarlik', 'kutuphane', 'carsi', 'hazirlik', 'disari'];
// Fixed uids so two independently seeded DBs agree on the seed halls when merged.
export const SEED_HALLS = [
  { uid: '00000000-0000-4000-8000-00000000c001', name: 'KKM',
    seats: () => readFileSync(resolve(here, 'seed/kkm_seats.json'), 'utf8'),
    plan: () => readFileSync(resolve(here, 'seed/kkm_seatplan.json'), 'utf8') },
  { uid: '00000000-0000-4000-8000-00000000c002', name: 'Mimarlık',
    seats: () => '{"count":280}', plan: () => '{"all":[{"count":280}]}' },
];

async function exists(db, username) {
  return (await db.execute({ sql: 'SELECT 1 FROM users WHERE username = ?', args: [username] })).rows.length > 0;
}

/** env = process.env-like object; log = line printer. Returns a list of what it created. */
export async function bootstrap(db, env = process.env, log = console.log) {
  const created = [];
  const admin = env.ADMIN_USERNAME || 'sina';
  if (env.ADMIN_PASSWORD && !(await exists(db, admin))) {
    await createUser(db, { username: admin, password: env.ADMIN_PASSWORD, role: 'superuser' });
    created.push(admin); log(`created superuser ${admin}`);
  }
  const baskan = env.BASKAN_USERNAME || 'baskan';
  if (env.BASKAN_PASSWORD && !(await exists(db, baskan))) {
    await createUser(db, { username: baskan, password: env.BASKAN_PASSWORD, role: 'baskan' });
    created.push(baskan); log(`created başkan ${baskan}`);
  }
  const shared = env.TICKET_USER_PASSWORD;
  for (const name of STAFF) {
    if (await exists(db, name)) continue;
    const pw = shared || randomBytes(9).toString('base64url');
    await createUser(db, { username: name, password: pw, role: 'sales' });
    // production logs (Render) are retained and readable by anyone with dashboard access: never print a password there
    const tail = shared ? '' : env.NODE_ENV === 'production' ? ' with a random password (set it in Hesaplar)' : ` with password ${pw}`;
    created.push(name); log(`created ${name}${tail}`);
  }
  const count = Number((await db.execute('SELECT COUNT(*) AS n FROM halls')).rows[0].n);
  if (count === 0) {
    for (const h of SEED_HALLS) {
      const dead = await db.execute({ sql: "SELECT 1 FROM tombstones WHERE tbl = 'halls' AND uid = ?", args: [h.uid] });
      if (dead.rows.length) continue;
      await db.execute({
        sql: 'INSERT INTO halls (uid, name, seats, seat_plan, price_schema, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [h.uid, h.name, JSON.stringify(JSON.parse(h.seats())), JSON.stringify(JSON.parse(h.plan())), '', now()],
      });
      created.push(`hall:${h.name}`); log(`seeded hall ${h.name}`);
    }
  }
  return created;
}
