// Passwords (scrypt), server-side sessions, CSRF, Origin check, login rate limit, roles.
import { scrypt as scryptCb, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { now, newUid } from './db.js';
import { SUPER, ALL_CAPS, capsFrom, hasCap, roleExists } from './roles.js';

const scrypt = promisify(scryptCb);
export const COOKIE = 'ct_sid';
export const SESSION_MS = 12 * 60 * 60 * 1000;
const SLIDE_AFTER_MS = 60 * 1000; // re-extend at most once a minute
const KEYLEN = 64;
const N = 16384, R = 8, P = 1;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(String(password), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(String(password), Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
let DUMMY;
const dummyHash = async () => (DUMMY ??= await hashPassword('dummy-password'));

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export async function createUser(db, { username, password, role = 'sales', disabled = false }) {
  if (typeof role !== 'string' || !(await roleExists(db, role))) throw new Error(`bad role ${role}`);
  const t = now();
  const r = await db.execute({
    sql: 'INSERT INTO users (uid, username, hash, role, disabled, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [newUid(), username, await hashPassword(password), role, disabled ? 1 : 0, t, t],
  });
  return Number(r.lastInsertRowid);
}

/** Disabling a user also deletes every session of theirs. */
export async function setUserDisabled(db, userId, disabled) {
  await db.batch([
    { sql: 'UPDATE users SET disabled = ?, updated_at = ? WHERE id = ?', args: [disabled ? 1 : 0, now(), userId] },
    ...(disabled ? [{ sql: 'DELETE FROM sessions WHERE user_id = ?', args: [userId] }] : []),
  ], 'write');
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieHeader(value, { secure, maxAgeSec }) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

export function httpError(status, error) {
  return Object.assign(new Error(error), { status, expose: true });
}

/** Login rate limiter: max failures per window per key, in memory (per process). */
export function makeLimiter({ max = 10, windowMs = 15 * 60 * 1000, clock = Date.now } = {}) {
  const fails = new Map();
  const live = (key) => {
    const list = (fails.get(key) || []).filter((t) => clock() - t < windowMs);
    if (list.length) fails.set(key, list); else fails.delete(key);
    return list;
  };
  return {
    blocked: (key) => live(key).length >= max,
    fail: (key) => {
      // keys are client-chosen (ip|username): drop expired ones now and then so the map can't grow without bound
      if (fails.size > 1000) for (const k of [...fails.keys()]) live(k);
      fails.set(key, [...live(key), clock()]);
    },
    size: () => fails.size,
    reset: (key) => { fails.delete(key); },
  };
}

/** Express middleware: loads req.user / req.session from the ct_sid cookie; slides expiry. */
export function sessionLoader(db) {
  return async (req, res, next) => {
    const sid = parseCookies(req.headers.cookie)[COOKIE];
    if (!sid || sid.length > 100) return next();
    const idHash = sha256(sid);
    const r = await db.execute({
      sql: `SELECT s.csrf, s.expires_at, u.id, u.username, u.role, r.name AS role_name, r.caps FROM sessions s JOIN users u ON u.id = s.user_id
            LEFT JOIN roles r ON r.key = u.role WHERE s.id_hash = ? AND u.disabled = 0`,
      args: [idHash],
    });
    const row = r.rows[0];
    if (!row) return next();
    const exp = Date.parse(row.expires_at);
    if (!(exp > Date.now())) {
      await db.execute({ sql: 'DELETE FROM sessions WHERE id_hash = ?', args: [idHash] });
      return next();
    }
    if (exp - Date.now() < SESSION_MS - SLIDE_AFTER_MS) {
      await db.execute({ sql: 'UPDATE sessions SET expires_at = ? WHERE id_hash = ?', args: [new Date(Date.now() + SESSION_MS).toISOString(), idHash] });
      res.append('Set-Cookie', cookieHeader(sid, { secure: req.app.locals.secureCookie, maxAgeSec: SESSION_MS / 1000 }));
    }
    req.user = userWithCaps(row);
    req.session = { idHash, csrf: row.csrf };
    next();
  };
}

/** Session row (id, username, role, role_name, caps) -> req.user {id, username, role, roleName, caps}. */
export function userWithCaps(row) {
  const sup = row.role === SUPER;
  return {
    id: Number(row.id), username: row.username, role: row.role,
    roleName: sup ? 'Süper kullanıcı' : row.role_name ?? row.role,
    caps: sup ? { ...ALL_CAPS } : capsFrom(row.caps), // a role deleted under a user (never via the app) = no caps
  };
}

/**
 * Route access. cap null = public; 'login' = any signed-in user; 'superuser' = the superuser only; a cap name or an
 * array of cap names (any of them). 401 without a session, 403 without the cap.
 */
export function requireCap(cap) {
  return (req, res, next) => {
    if (!cap) return next();
    if (!req.user) return next(httpError(401, 'Giriş yapmanız gerekiyor'));
    if (cap === 'login') return next();
    const ok = cap === SUPER ? req.user.role === SUPER : [].concat(cap).some((c) => hasCap(req.user.caps, c));
    if (!ok) return next(httpError(403, 'Bu işlem için yetkiniz yok'));
    next();
  };
}

/** Rejects a cross-site Origin (host differs from Host). Applies to every non-GET. */
export function originCheck(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* "null" or junk */ }
    if (!host || host !== req.headers.host) return next(httpError(403, 'İstek kaynağı geçersiz'));
  }
  next();
}

/** Non-GET with a session: X-CSRF-Token must equal the session's token. */
export function csrfCheck(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  // compare byte lengths, not string lengths: a latin1 header char is 1 char but 2 UTF-8 bytes (timingSafeEqual throws)
  const sent = Buffer.from(String(req.headers['x-csrf-token'] || ''));
  const want = Buffer.from(req.session?.csrf || '');
  const ok = want.length > 0 && sent.length === want.length && timingSafeEqual(sent, want);
  if (!ok) return next(httpError(403, 'Güvenlik belirteci (CSRF) geçersiz, sayfayı yenileyin'));
  next();
}

export async function login(req, res, db, limiter) {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password || username.length > 150 || password.length > 1024) {
    throw httpError(400, 'Kullanıcı adı ve şifre gerekli');
  }
  const key = `${req.ip}|${username.toLowerCase()}`;
  if (limiter.blocked(key)) throw httpError(429, 'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.');
  const r = await db.execute({ sql: 'SELECT u.id, u.username, u.hash, u.role, u.disabled, r.name AS role_name, r.caps FROM users u LEFT JOIN roles r ON r.key = u.role WHERE u.username = ?', args: [username] });
  const u = r.rows[0];
  const ok = u ? await verifyPassword(password, u.hash) : (await verifyPassword(password, await dummyHash()), false);
  if (!ok) {
    limiter.fail(key);
    throw httpError(401, 'Kullanıcı adı veya şifre hatalı');
  }
  if (Number(u.disabled)) throw httpError(403, 'Bu hesap devre dışı');
  limiter.reset(key);
  const old = parseCookies(req.headers.cookie)[COOKIE];
  const sid = randomBytes(32).toString('base64url');
  const csrf = randomBytes(32).toString('base64url');
  const t = now();
  await db.batch([
    ...(old ? [{ sql: 'DELETE FROM sessions WHERE id_hash = ?', args: [sha256(old)] }] : []),
    { sql: 'DELETE FROM sessions WHERE expires_at < ?', args: [t] },
    { sql: 'INSERT INTO sessions (id_hash, user_id, csrf, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [sha256(sid), u.id, csrf, new Date(Date.now() + SESSION_MS).toISOString(), t] },
    { sql: 'INSERT INTO user_logins (user_id, at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET at = excluded.at', args: [u.id, t] },
  ], 'write');
  res.append('Set-Cookie', cookieHeader(sid, { secure: req.app.locals.secureCookie, maxAgeSec: SESSION_MS / 1000 }));
  return { user: userWithCaps(u), csrf };
}

export async function logout(req, res, db) {
  if (req.session) await db.execute({ sql: 'DELETE FROM sessions WHERE id_hash = ?', args: [req.session.idHash] });
  res.append('Set-Cookie', cookieHeader('', { secure: req.app.locals.secureCookie, maxAgeSec: 0 }));
}
