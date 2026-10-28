import { httpError } from '../auth.js';
import { audit } from '../db.js';
import { deleteScope, SoldConflict } from '../admin.js';

export const MAX_NAME = 200;

/** Trimmed non-empty name ≤ MAX_NAME or 400. */
export function nameFrom(body, label = 'Ad') {
  const v = body?.name;
  const name = typeof v === 'string' ? v.trim() : '';
  if (!name) throw httpError(400, `${label} gerekli`);
  if (name.length > MAX_NAME) throw httpError(400, `${label} en fazla ${MAX_NAME} karakter olabilir`);
  return name;
}

export async function one(db, sql, args, notFound = 'Bulunamadı') {
  const r = await db.execute({ sql, args });
  if (!r.rows.length) throw httpError(404, notFound);
  return r.rows[0];
}

export const json = (text, fallback = {}) => { try { return JSON.parse(text); } catch { return fallback; } };

/** Shared DELETE handler body: deleteScope + audit; sold without force -> 409 {error, sold}. */
export async function deleteRoute(req, res, db, kind) {
  try {
    const out = await deleteScope(db, kind, req.params.id, req.body);
    await audit(db, req.user.username, `${kind}.delete`, { id: Number(req.params.id), name: out.name, deleted: out.deleted, sold: out.sold });
    return { deleted: out.deleted, sold: out.sold };
  } catch (e) {
    if (!(e instanceof SoldConflict)) throw e;
    res.status(409);
    return { error: e.message, sold: e.sold };
  }
}
