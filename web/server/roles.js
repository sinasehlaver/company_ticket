// Roles are data (docs/ROLES_PLAN.md). superuser is implicit (every cap, no row, never editable); baskan and sales are
// built-in rows; admins may add custom roles. A role = {key, name, caps}. caps.cancel is 'off'|'own'|'any', every
// other cap is a boolean. Deletes (event/day/hall) and snapshot restore are superuser-only and never caps.

export const SUPER = 'superuser';
export const BUILTIN = ['superuser', 'baskan', 'sales'];
export const CANCEL = ['off', 'own', 'any'];
/** Toggle caps in UI order (cancel comes first, as a 3-way). */
export const FLAGS = ['releaseOthers', 'events', 'reprice', 'halls', 'logs', 'report', 'accounts', 'backup', 'roles'];
export const CAP_KEYS = ['cancel', ...FLAGS];

export const ALL_CAPS = Object.freeze({ cancel: 'any', ...Object.fromEntries(FLAGS.map((f) => [f, true])) });
export const NO_CAPS = Object.freeze({ cancel: 'off', ...Object.fromEntries(FLAGS.map((f) => [f, false])) });
/** Migration defaults: today's behaviour plus the ask (sales may cancel their own sales). */
export const DEFAULTS = { baskan: ALL_CAPS, sales: { ...NO_CAPS, cancel: 'own' } };

export const MAX_ROLE_NAME = 40;
// letters (any script, incl. Turkish), digits, space and . _ - ( ) /
const ROLE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._()/-]*$/u;
export const MAX_CUSTOM_ROLES = 50;

/** Stored JSON (trusted, but possibly from an older/odd row) -> full caps object; unknown keys dropped. */
export function capsFrom(text) {
  let raw = {};
  try { raw = typeof text === 'string' ? JSON.parse(text) : (text ?? {}); } catch { raw = {}; }
  const out = { ...NO_CAPS };
  if (raw && typeof raw === 'object') {
    if (CANCEL.includes(raw.cancel)) out.cancel = raw.cancel;
    for (const f of FLAGS) if (raw[f] === true) out[f] = true;
  }
  return out;
}

/** Untrusted request body caps -> full caps object, or a Turkish error string. Unknown keys / bad values rejected. */
export function parseCaps(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Yetkiler bir nesne olmalı';
  for (const k of Object.keys(body)) if (!CAP_KEYS.includes(k)) return `Bilinmeyen yetki: ${String(k).slice(0, 40)}`;
  if (body.cancel !== undefined && !CANCEL.includes(body.cancel)) return 'Bilet iptali "off", "own" ya da "any" olmalı';
  for (const f of FLAGS) if (body[f] !== undefined && typeof body[f] !== 'boolean') return `Geçersiz değer: ${f}`;
  return capsFrom(body);
}

/** Untrusted role name -> trimmed name, or a Turkish error (as {error}). */
export function parseRoleName(v) {
  const name = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').normalize('NFC') : '';
  if (!name) return { error: 'Rol adı gerekli' };
  if (name.length > MAX_ROLE_NAME) return { error: `Rol adı en fazla ${MAX_ROLE_NAME} karakter olabilir` };
  if (!ROLE_NAME.test(name)) return { error: 'Rol adında yalnızca harf, rakam, boşluk ve . _ - ( ) / olabilir' };
  return { name };
}

export const hasCap = (caps, cap) => (cap === 'cancel' ? (caps?.cancel ?? 'off') !== 'off' : caps?.[cap] === true);

/** true when every cap in `a` is at most what `b` has (cancel: off < own < any). */
export function capsWithin(a, b) {
  if (CANCEL.indexOf(a.cancel) > CANCEL.indexOf(b.cancel)) return false;
  return FLAGS.every((f) => !a[f] || b[f]);
}

/** Caps of a role key (superuser = all; unknown key = none). */
export async function capsOf(db, key) {
  if (key === SUPER) return { ...ALL_CAPS };
  const r = await db.execute({ sql: 'SELECT caps FROM roles WHERE key = ?', args: [key] });
  return r.rows.length ? capsFrom(r.rows[0].caps) : { ...NO_CAPS };
}

export async function roleExists(db, key) {
  if (key === SUPER) return true;
  return (await db.execute({ sql: 'SELECT 1 FROM roles WHERE key = ?', args: [key] })).rows.length > 0;
}

/**
 * Pure guard for editing/creating/deleting a role. actor = {role, caps}; target key ('' = a new role);
 * targetCaps = the role's current caps (null for new); nextCaps = caps after the change (null for delete).
 * -> Turkish error or null.
 */
export function roleChangeProblem(actor, key, targetCaps, nextCaps) {
  if (key === SUPER) return 'Süper kullanıcı rolü değiştirilemez';
  if (actor.role === SUPER) return null;
  if (!hasCap(actor.caps, 'roles')) return 'Rolleri yönetme yetkiniz yok';
  if (key === 'baskan') return 'Başkan rolünü yalnızca süper kullanıcı değiştirebilir';
  if (targetCaps && !capsWithin(targetCaps, actor.caps)) return 'Bu rol sizde olmayan yetkiler içeriyor; yalnızca süper kullanıcı değiştirebilir';
  if (nextCaps && !capsWithin(nextCaps, actor.caps)) return 'Kendinizde olmayan bir yetkiyi veremezsiniz';
  return null;
}

/** Can actor (non-self) manage an account whose role has these caps? Superuser: any; others: never baskan/superuser,
 * and only roles whose caps are within their own (no privilege escalation through account management). */
export function canManageRole(actor, key, caps) {
  if (actor.role === SUPER) return true;
  if (key === SUPER || key === 'baskan') return false;
  return capsWithin(caps, actor.caps);
}

/** SQL for the built-in rows (used by the migration and tests). */
export function seedRolesSql() {
  const row = (key, name) => `INSERT INTO roles (uid, key, name, caps, updated_at) VALUES (lower(hex(randomblob(16))), '${key}', '${name}', '${JSON.stringify(DEFAULTS[key])}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(key) DO NOTHING`;
  return [row('baskan', 'Başkan'), row('sales', 'Satış noktası')].join(';\n');
}
