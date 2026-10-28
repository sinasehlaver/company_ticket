import { now, newUid, audit } from '../db.js';
import { hallRows, parseSchema, readPrices, PriceError } from '../pricing.js';
import { validateSeats } from '../seats.js';
import { httpError } from '../auth.js';
import { nameFrom, one, json, deleteRoute } from './util.js';

const HALL_COLS = 'id, uid, name, seats, seat_plan, price_schema, updated_at';

function seatCount(seats) {
  if (seats.count) return seats.count;
  let n = 0;
  for (const d of seats.all ?? []) for (const [row, nums] of Object.entries(d)) if (row !== '-') n += nums.filter((x) => x !== '-1').length;
  return n;
}

/** Full hall for the API: parsed JSON + price editor prefill (Django _price_context). */
export function hallOut(row) {
  const seats = json(row.seats);
  const rows = hallRows({ seats });
  let prefill = {};
  try { prefill = parseSchema(row.price_schema); } catch (e) { if (!(e instanceof PriceError)) throw e; }
  return {
    id: Number(row.id), uid: row.uid, name: row.name, seats, seatPlan: json(row.seat_plan),
    priceSchema: row.price_schema, updatedAt: row.updated_at,
    kind: rows.length ? 'seated' : 'count', seatCount: seatCount(seats), rows,
    // seated: {row: price} for every row that has one; count hall: the single saved price ('' if none)
    prices: rows.length ? Object.fromEntries(rows.filter((r) => r in prefill).map((r) => [r, prefill[r]])) : {},
    price: rows.length ? '' : row.price_schema,
  };
}

export const getHall = (db, id) => one(db, `SELECT ${HALL_COLS} FROM halls WHERE id = ?`, [id], 'Salon bulunamadı');

function seatPlanFrom(body) {
  if (body.seatPlan === undefined || body.seatPlan === null) return '{}';
  if (typeof body.seatPlan !== 'object') throw httpError(400, 'Oturma planı bir JSON nesnesi olmalı');
  return JSON.stringify(body.seatPlan);
}

export default function hallRoutes(route) {
  route('GET', '/api/halls', 'baskan', async (req, res, { db }) => {
    const r = await db.execute(`SELECT ${HALL_COLS} FROM halls ORDER BY name, id`);
    return { halls: r.rows.map((h) => { const o = hallOut(h); return { id: o.id, name: o.name, kind: o.kind, seatCount: o.seatCount, priceSchema: o.priceSchema }; }) };
  });

  route('GET', '/api/halls/:id', 'sales', async (req, res, { db }) => ({ hall: hallOut(await getHall(db, req.params.id)) }));

  route('POST', '/api/halls', 'baskan', async (req, res, { db }) => {
    const body = req.body ?? {};
    const name = nameFrom(body, 'Salon adı');
    const seats = validateSeats(body.seats);
    const plan = seatPlanFrom(body);
    const r = await db.execute({
      sql: 'INSERT INTO halls (uid, name, seats, seat_plan, price_schema, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [newUid(), name, JSON.stringify(seats), plan, '', now()],
    });
    const id = Number(r.lastInsertRowid);
    await audit(db, req.user.username, 'hall.create', { id, name });
    res.status(201);
    return { hall: hallOut(await getHall(db, id)) };
  });

  route('PUT', '/api/halls/:id', 'baskan', async (req, res, { db }) => {
    const hall = await getHall(db, req.params.id);
    const name = nameFrom(req.body, 'Salon adı');
    await db.execute({ sql: 'UPDATE halls SET name = ?, updated_at = ? WHERE id = ?', args: [name, now(), hall.id] });
    await audit(db, req.user.username, 'hall.rename', { id: Number(hall.id), from: hall.name, to: name });
    return { hall: hallOut(await getHall(db, hall.id)) };
  });

  // Port of views.hall_prices. Seated: {prices:{row:price}} (every row); count hall: {price}.
  route('PUT', '/api/halls/:id/prices', 'baskan', async (req, res, { db }) => {
    const hall = await getHall(db, req.params.id);
    let schema;
    try { ({ schema } = readPrices({ seats: hall.seats }, req.body)); } catch (e) {
      if (e instanceof PriceError) throw httpError(400, e.message);
      throw e;
    }
    await db.execute({ sql: 'UPDATE halls SET price_schema = ?, updated_at = ? WHERE id = ?', args: [schema, now(), hall.id] });
    await audit(db, req.user.username, 'hall.prices', { id: Number(hall.id), schema });
    return { hall: hallOut(await getHall(db, hall.id)) };
  });

  route('DELETE', '/api/halls/:id', 'superuser', (req, res, { db }) => deleteRoute(req, res, db, 'hall'));
}
