import { now, newUid, audit } from '../db.js';
import { createDay, istanbulToUtc } from '../seats.js';
import { httpError } from '../auth.js';
import { getHall } from './halls.js';
import { repriceDay } from '../admin.js';
import { nameFrom, one, json, deleteRoute } from './util.js';

const getEvent = (db, id) => one(db, 'SELECT e.id, e.uid, e.name, e.hall_id, e.updated_at, h.name AS hall_name FROM events e JOIN halls h ON h.id = e.hall_id WHERE e.id = ?', [id], 'Etkinlik bulunamadı');
const eventOut = (e) => ({ id: Number(e.id), uid: e.uid, name: e.name, hallId: Number(e.hall_id), hallName: e.hall_name, updatedAt: e.updated_at });
const dayOut = (d) => ({ id: Number(d.id), uid: d.uid, eventId: Number(d.event_id), date: d.date, ticketsDict: json(d.tickets_dict), updatedAt: d.updated_at });

async function eventWithDays(db, id) {
  const e = await getEvent(db, id);
  const days = await db.execute({ sql: 'SELECT id, uid, event_id, date, tickets_dict, updated_at FROM days WHERE event_id = ? ORDER BY date, id', args: [e.id] });
  return { event: { ...eventOut(e), days: days.rows.map(dayOut) } };
}

export default function eventRoutes(route) {
  route('GET', '/api/events', 'sales', async (req, res, { db }) => {
    const r = await db.execute(`SELECT e.id, e.uid, e.name, e.hall_id, e.updated_at, h.name AS hall_name,
      (SELECT COUNT(*) FROM days d WHERE d.event_id = e.id) AS day_count, (SELECT MIN(date) FROM days d WHERE d.event_id = e.id) AS first_date
      FROM events e JOIN halls h ON h.id = e.hall_id ORDER BY e.id DESC`);
    return { events: r.rows.map((e) => ({ ...eventOut(e), dayCount: Number(e.day_count), firstDate: e.first_date })) };
  });

  route('GET', '/api/events/:id', 'sales', (req, res, { db }) => eventWithDays(db, req.params.id));

  route('POST', '/api/events', 'baskan', async (req, res, { db }) => {
    const name = nameFrom(req.body, 'Etkinlik adı');
    const raw = req.body?.hallId;
    const hallId = typeof raw === 'number' || (typeof raw === 'string' && /^\d{1,15}$/.test(raw)) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(hallId) || hallId < 1) throw httpError(400, 'Bir salon seçin');
    const h = await db.execute({ sql: 'SELECT id FROM halls WHERE id = ?', args: [hallId] });
    if (!h.rows.length) throw httpError(400, 'Salon bulunamadı');
    const r = await db.execute({ sql: 'INSERT INTO events (uid, name, hall_id, updated_at) VALUES (?, ?, ?, ?)', args: [newUid(), name, hallId, now()] });
    const id = Number(r.lastInsertRowid);
    await audit(db, req.user.username, 'event.create', { id, name, hallId });
    res.status(201);
    return eventWithDays(db, id);
  });

  route('PUT', '/api/events/:id', 'baskan', async (req, res, { db }) => {
    const e = await getEvent(db, req.params.id);
    const name = nameFrom(req.body, 'Etkinlik adı');
    await db.execute({ sql: 'UPDATE events SET name = ?, updated_at = ? WHERE id = ?', args: [name, now(), e.id] });
    await audit(db, req.user.username, 'event.rename', { id: Number(e.id), from: e.name, to: name });
    return eventWithDays(db, e.id);
  });

  // Port of views.create_day: body {date:'YYYY-MM-DDTHH:MM' (Istanbul), prices:{row:price} | price, remember}.
  route('POST', '/api/events/:id/days', 'baskan', async (req, res, { db }) => {
    const e = await getEvent(db, req.params.id);
    const hall = await getHall(db, e.hall_id);
    const dayId = await createDay(db, e, hall, req.body ?? {});
    await audit(db, req.user.username, 'day.create', { id: dayId, eventId: Number(e.id) });
    const d = await one(db, 'SELECT id, uid, event_id, date, tickets_dict, updated_at FROM days WHERE id = ?', [dayId]);
    res.status(201);
    return { day: dayOut(d) };
  });

  route('PUT', '/api/days/:id', 'baskan', async (req, res, { db }) => {
    const d = await one(db, 'SELECT id, date FROM days WHERE id = ?', [req.params.id], 'Gün bulunamadı');
    const date = istanbulToUtc(req.body?.date);
    if (!date) throw httpError(400, 'Geçerli bir tarih ve saat girin');
    await db.execute({ sql: 'UPDATE days SET date = ?, updated_at = ? WHERE id = ?', args: [date, now(), d.id] });
    await audit(db, req.user.username, 'day.date', { id: Number(d.id), from: d.date, to: date });
    const out = await one(db, 'SELECT id, uid, event_id, date, tickets_dict, updated_at FROM days WHERE id = ?', [d.id]);
    return { day: dayOut(out) };
  });

  route('DELETE', '/api/events/:id', 'superuser', (req, res, { db }) => deleteRoute(req, res, db, 'event'));
  route('DELETE', '/api/days/:id', 'superuser', (req, res, { db }) => deleteRoute(req, res, db, 'day'));

  // Re-price a day. Free tickets always change; held/sold by body.held/body.sold 'keep'|'apply' (default keep).
  // The client asks /preview first and only shows the keep/apply dialog when held or sold seats would change.
  const dayHall = async (db, id) => {
    const d = await one(db, 'SELECT d.id, e.hall_id FROM days d JOIN events e ON e.id = d.event_id WHERE d.id = ?', [id], 'Gün bulunamadı');
    return [Number(d.id), await getHall(db, d.hall_id)];
  };
  route('POST', '/api/days/:id/prices/preview', 'baskan', async (req, res, { db }) => {
    const [id, hall] = await dayHall(db, req.params.id);
    return (await repriceDay(db, id, hall, req.body, { dryRun: true })).preview;
  });
  route('PUT', '/api/days/:id/prices', 'baskan', async (req, res, { db }) => {
    const [id, hall] = await dayHall(db, req.params.id);
    const { changed, schema, preview, held, sold } = await repriceDay(db, id, hall, req.body);
    await audit(db, req.user.username, 'day.reprice', { id, schema, changed, counts: preview, held, sold });
    const out = await one(db, 'SELECT id, uid, event_id, date, tickets_dict, updated_at FROM days WHERE id = ?', [id]);
    return { day: dayOut(out), changed, preview, held, sold };
  });
}
