// Roller (docs/ROLES_PLAN.md). GET for the accounts role picker + the roles screen; create/edit/delete need cap
// `roles`. superuser is listed (locked, every cap) but never editable; baskan is editable by the superuser only; a
// non-superuser editor can only grant caps it has itself (roleChangeProblem). Built-ins can't be renamed or deleted;
// a role with accounts can't be deleted (reassign first).
import { randomBytes } from 'node:crypto';
import { audit, now, newUid } from '../db.js';
import { httpError } from '../auth.js';
import { SUPER, BUILTIN, CAP_KEYS, FLAGS, CANCEL, ALL_CAPS, MAX_CUSTOM_ROLES, capsFrom, parseCaps, parseRoleName, roleChangeProblem, canManageRole } from '../roles.js';

const KEY = /^[a-z0-9-]{1,40}$/;
const keyFrom = (v) => {
  if (typeof v !== 'string' || !KEY.test(v)) throw httpError(404, 'Rol bulunamadı');
  return v;
};

async function listRoles(db, actor) {
  const r = await db.execute(`SELECT r.key, r.name, r.caps, r.updated_at, (SELECT COUNT(*) FROM users u WHERE u.role = r.key) AS n
    FROM roles r ORDER BY CASE r.key WHEN 'baskan' THEN 0 WHEN 'sales' THEN 1 ELSE 2 END, r.name`);
  const supers = Number((await db.execute("SELECT COUNT(*) AS n FROM users WHERE role = 'superuser'")).rows[0].n);
  const rows = [
    { key: SUPER, name: 'Süper kullanıcı', caps: { ...ALL_CAPS }, builtin: true, users: supers, updatedAt: null },
    ...r.rows.map((x) => ({ key: x.key, name: x.name, caps: capsFrom(x.caps), builtin: BUILTIN.includes(x.key), users: Number(x.n), updatedAt: x.updated_at })),
  ];
  // editable = the roles screen may change it; assignable = the accounts screen may put an account in it
  return rows.map((x) => ({ ...x, editable: !roleChangeProblem(actor, x.key, x.caps, null), assignable: canManageRole(actor, x.key, x.caps) }));
}

async function getRole(db, key) {
  const r = await db.execute({ sql: 'SELECT key, name, caps FROM roles WHERE key = ?', args: [key] });
  if (!r.rows.length) throw httpError(404, 'Rol bulunamadı');
  return { key: r.rows[0].key, name: r.rows[0].name, caps: capsFrom(r.rows[0].caps) };
}

async function nameTaken(db, name, exceptKey = '') {
  const all = (await db.execute('SELECT key, name FROM roles')).rows;
  const low = (s) => s.toLocaleLowerCase('tr');
  return low(name) === low('Süper kullanıcı') || all.some((x) => x.key !== exceptKey && low(x.name) === low(name));
}

const guard = (actor, key, before, after) => {
  const msg = roleChangeProblem(actor, key, before, after);
  if (msg) throw httpError(403, msg);
};

export default function roleRoutes(route) {
  route('GET', '/api/roles', ['accounts', 'roles'], async (req, res, { db }) => ({
    roles: await listRoles(db, req.user), caps: CAP_KEYS, flags: FLAGS, cancel: CANCEL,
  }));

  // {name, caps} -> 201 {role}
  route('POST', '/api/roles', 'roles', async (req, res, { db }) => {
    const { name, error } = parseRoleName(req.body?.name);
    if (error) throw httpError(400, error);
    const caps = parseCaps(req.body?.caps ?? {});
    if (typeof caps === 'string') throw httpError(400, caps);
    guard(req.user, '', null, caps);
    const n = Number((await db.execute("SELECT COUNT(*) AS n FROM roles WHERE key NOT IN ('baskan', 'sales')")).rows[0].n);
    if (n >= MAX_CUSTOM_ROLES) throw httpError(400, `En fazla ${MAX_CUSTOM_ROLES} özel rol olabilir`);
    if (await nameTaken(db, name)) throw httpError(409, 'Bu adda bir rol zaten var');
    const key = `r-${randomBytes(6).toString('hex')}`;
    await db.execute({ sql: 'INSERT INTO roles (uid, key, name, caps, updated_at) VALUES (?, ?, ?, ?, ?)', args: [newUid(), key, name, JSON.stringify(caps), now()] });
    await audit(db, req.user.username, 'role.create', { key, name, caps });
    res.status(201);
    return { role: (await listRoles(db, req.user)).find((x) => x.key === key) };
  });

  // {name?, caps?} -> {role}. Built-in names are fixed.
  route('PUT', '/api/roles/:key', 'roles', async (req, res, { db }) => {
    const key = keyFrom(req.params.key);
    if (key === SUPER) throw httpError(403, 'Süper kullanıcı rolü değiştirilemez');
    const role = await getRole(db, key);
    const body = req.body ?? {};
    let name = role.name;
    if (body.name !== undefined) {
      const p = parseRoleName(body.name);
      if (p.error) throw httpError(400, p.error);
      if (p.name !== role.name && BUILTIN.includes(key)) throw httpError(400, 'Yerleşik rollerin adı değiştirilemez');
      if (p.name !== role.name && await nameTaken(db, p.name, key)) throw httpError(409, 'Bu adda bir rol zaten var');
      name = p.name;
    }
    let caps = role.caps;
    if (body.caps !== undefined) {
      caps = parseCaps(body.caps);
      if (typeof caps === 'string') throw httpError(400, caps);
    }
    guard(req.user, key, role.caps, caps);
    if (name === role.name && JSON.stringify(caps) === JSON.stringify(role.caps)) throw httpError(400, 'Değişiklik yok');
    await db.execute({ sql: 'UPDATE roles SET name = ?, caps = ?, updated_at = ? WHERE key = ?', args: [name, JSON.stringify(caps), now(), key] });
    await audit(db, req.user.username, 'role.update', { key, from: { name: role.name, caps: role.caps }, to: { name, caps } });
    return { role: (await listRoles(db, req.user)).find((x) => x.key === key) };
  });

  route('DELETE', '/api/roles/:key', 'roles', async (req, res, { db }) => {
    const key = keyFrom(req.params.key);
    if (BUILTIN.includes(key)) throw httpError(400, 'Yerleşik roller silinemez');
    const role = await getRole(db, key);
    guard(req.user, key, role.caps, null);
    const n = Number((await db.execute({ sql: 'SELECT COUNT(*) AS n FROM users WHERE role = ?', args: [key] })).rows[0].n);
    if (n) throw httpError(409, `${n} hesap bu rolde; önce başka bir role taşıyın`);
    // conditional: an account moved into the role after the count still blocks the delete
    const d = await db.execute({ sql: 'DELETE FROM roles WHERE key = ? AND NOT EXISTS (SELECT 1 FROM users WHERE role = ?)', args: [key, key] });
    if (!d.rowsAffected) throw httpError(409, 'Bu role az önce bir hesap atandı; önce başka bir role taşıyın');
    await audit(db, req.user.username, 'role.delete', { key, name: role.name });
    return { deleted: key };
  });
}
