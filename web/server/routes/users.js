// Hesaplar (accounts). baskan: list + manage sales accounts; superuser: manage any account but its own,
// create sales/baskan, change roles. Never the caller's own account, never the last active superuser.
import { randomInt } from 'node:crypto';
import { audit, now } from '../db.js';
import { createUser, setUserDisabled, hashPassword, httpError, RANK, ROLES } from '../auth.js';
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
 * actor/target = {id, role, disabled}; change = {disabled?, role?}; activeSupers = active superuser count.
 */
export function userChangeProblem(actor, target, change, activeSupers) {
  if (actor.id === target.id) return 'Kendi hesabınızı buradan değiştiremezsiniz';
  if (RANK[actor.role] < RANK.superuser && target.role !== 'sales') return 'Başkan yalnızca satış noktası hesaplarını yönetebilir';
  if (change.role !== undefined && RANK[actor.role] < RANK.superuser) return 'Rolü yalnızca süper kullanıcı değiştirebilir';
  const losesSuper = target.role === 'superuser' && !target.disabled && (change.disabled === true || (change.role !== undefined && change.role !== 'superuser'));
  if (losesSuper && activeSupers <= 1) return 'Son süper kullanıcı devre dışı bırakılamaz ya da düşürülemez';
  return null;
}

const userOut = (u) => ({
  id: Number(u.id), username: u.username, role: u.role, disabled: !!Number(u.disabled),
  createdAt: u.created_at, lastLogin: u.last_login ?? null,
});
const LIST_SQL = `SELECT u.id, u.username, u.role, u.disabled, u.created_at, l.at AS last_login FROM users u
  LEFT JOIN user_logins l ON l.user_id = u.id`;
const getUser = (db, id) => one(db, `${LIST_SQL} WHERE u.id = ?`, [id], 'Kullanıcı bulunamadı');
const activeSupers = async (db) => Number((await db.execute("SELECT COUNT(*) AS n FROM users WHERE role = 'superuser' AND disabled = 0")).rows[0].n);
const guard = async (db, req, target, change) => {
  const msg = userChangeProblem(req.user, { id: Number(target.id), role: target.role, disabled: !!Number(target.disabled) }, change, await activeSupers(db));
  if (msg) throw httpError(msg.startsWith('Son') ? 409 : 400, msg);
};

export default function userRoutes(route) {
  route('GET', '/api/users', 'baskan', async (req, res, { db }) => {
    const r = await db.execute(`${LIST_SQL} ORDER BY CASE u.role WHEN 'superuser' THEN 0 WHEN 'baskan' THEN 1 ELSE 2 END, u.username`);
    return { users: r.rows.map(userOut), minPassword: MIN_PASSWORD };
  });

  // {username, role:'sales'|'baskan', password | generate:true} -> 201 {user, password?} (password only when generated).
  route('POST', '/api/users', 'baskan', async (req, res, { db }) => {
    const body = req.body ?? {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    if (!USERNAME.test(username)) throw httpError(400, 'Kullanıcı adı 2-40 karakter olmalı: harf, rakam, . _ -');
    const role = body.role ?? 'sales';
    if (role !== 'sales' && role !== 'baskan') throw httpError(400, 'Rol "sales" ya da "baskan" olmalı');
    if (role === 'baskan' && RANK[req.user.role] < RANK.superuser) throw httpError(400, 'Başkan hesabını yalnızca süper kullanıcı açabilir');
    const { password, generated } = passwordFrom(body);
    const dup = await db.execute({ sql: 'SELECT 1 FROM users WHERE lower(username) = lower(?)', args: [username] });
    if (dup.rows.length) throw httpError(409, 'Bu kullanıcı adı zaten var');
    const id = await createUser(db, { username, password, role });
    await audit(db, req.user.username, 'user.create', { id, username, role });
    res.status(201);
    return { user: userOut(await getUser(db, id)), ...(generated ? { password } : {}) };
  });

  // {disabled?:bool, role?:'sales'|'baskan'|'superuser'} -> {user}
  route('PUT', '/api/users/:id', 'baskan', async (req, res, { db }) => {
    const target = await getUser(db, req.params.id);
    const body = req.body ?? {};
    const change = {};
    if (body.disabled !== undefined) {
      if (typeof body.disabled !== 'boolean') throw httpError(400, 'Geçersiz durum');
      change.disabled = body.disabled;
    }
    if (body.role !== undefined) {
      if (!ROLES.includes(body.role)) throw httpError(400, 'Geçersiz rol');
      change.role = body.role;
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
    return { user: userOut(await getUser(db, id)) };
  });

  // {password | generate:true} -> {user, password?}; kills the target's sessions.
  route('POST', '/api/users/:id/password', 'baskan', async (req, res, { db }) => {
    const target = await getUser(db, req.params.id);
    await guard(db, req, target, {});
    const { password, generated } = passwordFrom(req.body);
    const id = Number(target.id);
    await db.batch([
      { sql: 'UPDATE users SET hash = ?, updated_at = ? WHERE id = ?', args: [await hashPassword(password), now(), id] },
      { sql: 'DELETE FROM sessions WHERE user_id = ?', args: [id] },
    ], 'write');
    await audit(db, req.user.username, 'user.password', { id, username: target.username });
    return { user: userOut(await getUser(db, id)), ...(generated ? { password } : {}) };
  });
}
