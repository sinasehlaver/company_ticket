// Day page + reservation + logs (F7-F12). Conflicts -> 409 {error, state}.
import { loadDay, siblingDays, dayState, dayVersion, toggleSeat, countHold, countRelease, sell, cancel, releaseHold, dayLogs, Conflict } from '../reserve.js';

/** Runs fn; on Conflict answers 409 {error, state}; otherwise returns {...result, state}. */
async function withState(req, res, db, fn) {
  const day = await loadDay(db, req.params.id);
  try {
    const out = await fn(day);
    return { ...out, state: await dayState(db, day.id, req.user) };
  } catch (e) {
    if (!(e instanceof Conflict)) throw e;
    res.status(409);
    return { error: e.message, state: await dayState(db, day.id, req.user) };
  }
}

const dayOut = (d) => ({
  id: d.id, uid: d.uid, date: d.date, kind: d.kind, ticketsDict: d.ticketsDict,
  event: { id: d.eventId, name: d.eventName, hallId: d.hallId, hallName: d.hallName },
  seats: d.kind === 'seated' ? d.seats.all : null, // display order: rows, '-' aisles, '-1' gaps
  seatCount: d.kind === 'count' ? d.seats.count : null,
});

export default function dayRoutes(route) {
  route('GET', '/api/days/:id', 'sales', async (req, res, { db }) => {
    const day = await loadDay(db, req.params.id);
    return { day: dayOut(day), days: await siblingDays(db, day.eventId), state: await dayState(db, day.id, req.user) };
  });

  // Poll target (every few s): 204 when ?since equals the current version.
  route('GET', '/api/days/:id/state', 'sales', async (req, res, { db }) => {
    const day = await loadDay(db, req.params.id);
    const since = req.query.since;
    if (typeof since === 'string' && since && since === await dayVersion(db, day.id)) { res.status(204).end(); return undefined; }
    return dayState(db, day.id, req.user);
  });

  route('POST', '/api/days/:id/toggle', 'sales', (req, res, { db }) =>
    withState(req, res, db, async (day) => ({ action: await toggleSeat(db, day, req.user, req.body?.ticketId) })));

  route('POST', '/api/days/:id/count/hold', 'sales', (req, res, { db }) =>
    withState(req, res, db, async (day) => { await countHold(db, day, req.user); return { action: 'held' }; }));

  route('POST', '/api/days/:id/count/release', 'sales', (req, res, { db }) =>
    withState(req, res, db, async (day) => { await countRelease(db, day, req.user); return { action: 'released' }; }));

  route('POST', '/api/days/:id/sell', 'sales', (req, res, { db }) =>
    withState(req, res, db, (day) => sell(db, day, req.user, req.body?.ticketIds)));

  route('POST', '/api/days/:id/cancel', 'baskan', (req, res, { db }) =>
    withState(req, res, db, (day) => cancel(db, day, req.user, req.body)));

  route('POST', '/api/days/:id/release', 'baskan', (req, res, { db }) =>
    withState(req, res, db, (day) => releaseHold(db, day, req.user, req.body)));

  route('GET', '/api/logs/days', 'baskan', async (req, res, { db }) => {
    const r = await db.execute(`SELECT d.id, d.date, e.id AS event_id, e.name AS event_name, h.name AS hall_name
      FROM days d JOIN events e ON e.id = d.event_id JOIN halls h ON h.id = e.hall_id ORDER BY d.date DESC, d.id DESC`);
    return { days: r.rows.map((x) => ({ id: Number(x.id), date: x.date, eventId: Number(x.event_id), eventName: x.event_name, hallName: x.hall_name })) };
  });

  route('GET', '/api/days/:id/logs', 'baskan', async (req, res, { db }) => {
    const day = await loadDay(db, req.params.id);
    const { seat, logs } = await dayLogs(db, day, req.query.seat);
    return { day: dayOut(day), days: await siblingDays(db, day.eventId), seat, logs };
  });
}
