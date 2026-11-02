// Hesaplar (accounts, cap `accounts`). Superuser: any account but its own, any role. Others: only accounts whose role
// is not baskan/superuser and whose caps are within their own, and they can only assign such roles (no escalation).
// Never the caller's own account, never the last active superuser. Superuser accounts are made by a role change only.
import { randomInt } from 'node:crypto';
import { audit, now } from '../db.js';
import { createUser, setUserDisabled, hashPassword, httpError } from '../auth.js';
import { SUPER, ALL_CAPS, capsFrom, canManageRole } from '../roles.js';
import { one } from './util.js';

export const MIN_PASSWORD = 8;
const USERNAME = /^[A-Za-z0-9._-]{2,40}$/;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/l/I

/** 14 chars from an unambiguous alphabet (≈80 bits). */
export function generatePassword(len = 14) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** {password} (8..1024 chars) or {generate:true} -> {password, generated}. */
function passwordFrom(body) {
  if (body?.generate === true) return { password: generatePassword(), generated: true };
  const p = body?.password;
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) throw httpError(400, `Şifre en az ${MIN_PASSWORD} karakter olmalı`);
  if (p.length > 1024) throw httpError(400, 'Şifre çok uzun');
  return { password: p, generated: false };
}

/**
 * Pure guard for PUT /api/users/:id and the password reset. Returns a Turkish error message or null.
 * actor = {id, role, caps}; target = {id, role, caps, disabled}; change = {disabled?, role?, roleCaps?};
 * activeSupers = active superuser count.
 */
export function userChangeProblem(actor, target, change, activeSupers) {
  if (actor.id === target.id) return 'Kendi hesabınızı buradan değiştiremezsiniz';
  if (!canManageRole(actor, target.role, target.caps ?? ALL_CAPS)) return 'Bu hesabı yalnızca süper kullanıcı yönetebilir';
  if (change.role !== undefined && !canManageRole(actor, change.role, change.roleCaps ?? ALL_CAPS)) return 'Bu rolü yalnızca süper kullanıcı verebilir';
  const losesSuper = target.role === 'superuser' && !target.disabled && (change.disabled === true || (change.role !== undefined && change.role !== 'superuser'));
  if (losesSuper && activeSupers <= 1) return 'Son süper kullanıcı devre dışı bırakılamaz ya da düşürülemez';
  return null;
}

const capsRow = (u) => (u.role === SUPER ? { ...ALL_CAPS } : capsFrom(u.caps));
/** actor given -> canManage per row (the UI hides what the server would refuse). */
const userOut = (u, actor) => ({
  id: Number(u.id), username: u.username, role: u.role, roleName: u.role === SUPER ? 'Süper kullanıcı' : u.role_name ?? u.role,
  disabled: !!Number(u.disabled), createdAt: u.created_at, lastLogin: u.last_login ?? null,
  ...(actor ? { canManage: Number(u.id) !== actor.id && canManageRole(actor, u.role, capsRow(u)) } : {}),
});
const LIST_SQL = `SELECT u.id, u.username, u.role, u.disabled, u.created_at, l.at AS last_login, r.name AS role_name, r.caps FROM users u
  LEFT JOIN user_logins l ON l.user_id = u.id LEFT JOIN roles r ON r.key = u.role`;
/** Role key from a body -> {key, caps} of an existing role, else 400. */
async function roleFrom(db, key) {
  if (typeof key !== 'string' || key.length > 64) throw httpError(400, 'Geçersiz rol');
  if (key === SUPER) return { key, caps: { ...ALL_CAPS } };
  const r = await db.execute({ sql: 'SELECT key, caps FROM roles WHERE key = ?', args: [key] });
  if (!r.rows.length) throw httpError(400, 'Geçersiz rol');
  return { key, caps: capsFrom(r.rows[0].caps) };
}
const getUser = (db, id) => one(db, `${LIST_SQL} WHERE u.id = ?`, [id], 'Kullanıcı bulunamadı');
const activeSupers = async (db) => Number((await db.execute("SELECT COUNT(*) AS n FROM users WHERE role = 'superuser' AND disabled = 0")).rows[0].n);
const guard = async (db, req, target, change) => {
  const msg = userChangeProblem(req.user, { id: Number(target.id), role: target.role, caps: capsRow(target), disabled: !!Number(target.disabled) }, change, await activeSupers(db));
  if (msg) throw httpError(msg.startsWith('Son') ? 409 : 400, msg);
};

export default function userRoutes(route) {
  route('GET', '/api/users', 'accounts', async (req, res, { db }) => {
    const r = await db.execute(`${LIST_SQL} ORDER BY CASE u.role WHEN 'superuser' THEN 0 WHEN 'baskan' THEN 1 WHEN 'sales' THEN 3 ELSE 2 END, r.name, u.username`);
    return { users: r.rows.map((u) => userOut(u, req.user)), minPassword: MIN_PASSWORD };
  });

  // {username, role:<role key, not superuser>, password | generate:true} -> 201 {user, password?} (password only when generated).
  route('POST', '/api/users', 'accounts', async (req, res, { db }) => {
    const body = req.body ?? {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    if (!USERNAME.test(username)) throw httpError(400, 'Kullanıcı adı 2-40 karakter olmalı: harf, rakam, . _ -');
    if (body.role === SUPER) throw httpError(400, 'Süper kullanıcı hesabı buradan açılamaz; mevcut bir hesabın rolünü değiştirin');
    const role = await roleFrom(db, body.role ?? 'sales');
    if (!canManageRole(req.user, role.key, role.caps)) throw httpError(400, 'Bu roldeki hesabı yalnızca süper kullanıcı açabilir');
    const { password, generated } = passwordFrom(body);
    const dup = await db.execute({ sql: 'SELECT 1 FROM users WHERE lower(username) = lower(?)', args: [username] });
    if (dup.rows.length) throw httpError(409, 'Bu kullanıcı adı zaten var');
    const id = await createUser(db, { username, password, role: role.key });
    await audit(db, req.user.username, 'user.create', { id, username, role: role.key });
    res.status(201);
    return { user: userOut(await getUser(db, id), req.user), ...(generated ? { password } : {}) };
  });

  // {disabled?:bool, role?:<role key>} -> {user}
  route('PUT', '/api/users/:id', 'accounts', async (req, res, { db }) => {
    const target = await getUser(db, req.params.id);
    const body = req.body ?? {};
    const change = {};
    if (body.disabled !== undefined) {
      if (typeof body.disabled !== 'boolean') throw httpError(400, 'Geçersiz durum');
      change.disabled = body.disabled;
    }
    if (body.role !== undefined) {
      const role = await roleFrom(db, body.role);
      change.role = role.key;
      change.roleCaps = role.caps;
    }
    if (!Object.keys(change).length) throw httpError(400, 'Değişiklik yok');
    await guard(db, req, target, change);
    const id = Number(target.id);
    if (change.role !== undefined && change.role !== target.role) {
      await db.execute({ sql: 'UPDATE users SET role = ?, updated_at = ? WHERE id = ?', args: [change.role, now(), id] });
      await audit(db, req.user.username, 'user.role', { id, username: target.username, from: target.role, to: change.role });
    }
    if (change.disabled !== undefined && change.disabled !== !!Number(target.disabled)) {
      await setUserDisabled(db, id, change.disabled);
      await audit(db, req.user.username, change.disabled ? 'user.disable' : 'user.enable', { id, username: target.username });
    }
    return { user: userOut(await getUser(db, id), req.user) };
  });

  // {password | generate:true} -> {user, password?}; kills the target's sessions.
  route('POST', '/api/users/:id/password', 'accounts', async (req, res, { db }) => {
    const target = await getUser(db, req.params.id);
    await guard(db, req, target, {});
    const { password, generated } = passwordFrom(req.body);
    const id = Number(target.id);
    await db.batch([
      { sql: 'UPDATE users SET hash = ?, updated_at = ? WHERE id = ?', args: [await hashPassword(password), now(), id] },
      { sql: 'DELETE FROM sessions WHERE user_id = ?', args: [id] },
    ], 'write');
    await audit(db, req.user.username, 'user.password', { id, username: target.username });
    return { user: userOut(await getUser(db, id), req.user), ...(generated ? { password } : {}) };
  });
}
