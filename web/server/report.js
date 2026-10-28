// Rapor: sold count + revenue per day, per sales point (seller username) and per price tier; event totals; CSV.
import { istanbulLabel } from './admin.js';

/** -> {events:[{id,name,hallName,kind,sold,revenue,capacity,days:[{id,date,sold,revenue,held,free,capacity,byUser,byPrice}]}], totals:{sold,revenue}} */
export async function buildReport(db, eventId = null) {
  const where = eventId ? 'WHERE e.id = ?' : '';
  const args = eventId ? [eventId] : [];
  const [days, status, sold] = await db.batch([
    { sql: `SELECT d.id, d.date, e.id AS event_id, e.name AS event_name, h.name AS hall_name, h.seats
      FROM days d JOIN events e ON e.id = d.event_id JOIN halls h ON h.id = e.hall_id ${where} ORDER BY e.id DESC, d.date, d.id`, args },
    { sql: `SELECT t.day_id, t.status, COUNT(*) AS n, SUM(t.price) AS s FROM tickets t JOIN days d ON d.id = t.day_id JOIN events e ON e.id = d.event_id ${where}
      GROUP BY t.day_id, t.status`, args },
    { sql: `SELECT t.day_id, t.last_modified_by AS u, t.price, COUNT(*) AS n FROM tickets t JOIN days d ON d.id = t.day_id JOIN events e ON e.id = d.event_id
      ${where ? `${where} AND` : 'WHERE'} t.status = 2 GROUP BY t.day_id, t.last_modified_by, t.price`, args },
  ], 'read');
  const byDay = new Map();
  for (const d of days.rows) {
    byDay.set(Number(d.id), {
      id: Number(d.id), date: d.date, eventId: Number(d.event_id), eventName: d.event_name, hallName: d.hall_name,
      kind: String(d.seats).includes('"all"') ? 'seated' : 'count',
      sold: 0, revenue: 0, held: 0, free: 0, capacity: 0, byUser: [], byPrice: [], lines: [],
    });
  }
  for (const r of status.rows) {
    const d = byDay.get(Number(r.day_id));
    if (!d) continue;
    const n = Number(r.n), st = Number(r.status);
    d.capacity += n;
    if (st === 0) d.free = n;
    else if (st === 1) d.held = n;
    else { d.sold = n; d.revenue = Number(r.s); }
  }
  for (const r of sold.rows) {
    const d = byDay.get(Number(r.day_id));
    if (!d) continue;
    const n = Number(r.n), price = Number(r.price), user = r.u || '?';
    const u = d.byUser.find((x) => x.username === user) ?? (d.byUser.push({ username: user, count: 0, revenue: 0 }), d.byUser.at(-1));
    u.count += n; u.revenue += n * price;
    const p = d.byPrice.find((x) => x.price === price) ?? (d.byPrice.push({ price, count: 0, revenue: 0 }), d.byPrice.at(-1));
    p.count += n; p.revenue += n * price;
    d.lines.push({ username: user, price, count: n, revenue: n * price });
  }
  const events = [];
  const totals = { sold: 0, revenue: 0 };
  for (const d of byDay.values()) {
    d.byUser.sort((a, b) => b.revenue - a.revenue || a.username.localeCompare(b.username));
    d.byPrice.sort((a, b) => b.price - a.price);
    d.lines.sort((a, b) => a.username.localeCompare(b.username) || b.price - a.price);
    let e = events.at(-1);
    if (!e || e.id !== d.eventId) {
      e = { id: d.eventId, name: d.eventName, hallName: d.hallName, kind: d.kind, sold: 0, revenue: 0, capacity: 0, days: [] };
      events.push(e);
    }
    const { eventId: _a, eventName: _b, hallName: _c, kind: _k, ...day } = d;
    e.days.push(day);
    e.sold += d.sold; e.revenue += d.revenue; e.capacity += d.capacity;
    totals.sold += d.sold; totals.revenue += d.revenue;
  }
  return { events, totals };
}

/** One CSV cell: formula-injection guard (leading = + - @ TAB CR -> prefixed '), then RFC-4180 quoting. */
export function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV for Excel in a Turkish locale: UTF-8 BOM, ';' separator (TR Excel's list separator; ',' would land in
 * one column), CRLF. One line per day × sales point × price, plus a total line per day.
 */
export function reportCsv(report) {
  const lines = [['Etkinlik', 'Salon', 'Gün', 'Satış noktası', 'Fiyat', 'Adet', 'Tutar']];
  for (const e of report.events) {
    for (const d of e.days) {
      const when = istanbulLabel(d.date);
      for (const l of d.lines) lines.push([e.name, e.hallName, when, l.username, l.price, l.count, l.revenue]);
      lines.push([e.name, e.hallName, when, 'TOPLAM', '', d.sold, d.revenue]);
    }
  }
  return `\uFEFF${lines.map((l) => l.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
