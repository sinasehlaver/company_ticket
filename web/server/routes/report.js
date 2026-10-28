// Rapor (baskan+): JSON for the tab, CSV download for Excel.
import { httpError } from '../auth.js';
import { buildReport, reportCsv } from '../report.js';

const eventFilter = (q) => {
  if (q === undefined || q === '') return null;
  if (typeof q !== 'string' || !/^[1-9]\d{0,15}$/.test(q)) throw httpError(400, 'Geçersiz etkinlik');
  return Number(q);
};

export default function reportRoutes(route) {
  route('GET', '/api/report', 'baskan', (req, res, { db }) => buildReport(db, eventFilter(req.query.event)));

  route('GET', '/api/report.csv', 'baskan', async (req, res, { db }) => {
    const csv = reportCsv(await buildReport(db, eventFilter(req.query.event)));
    const d = new Date(Date.now() + 180 * 60000).toISOString(); // Istanbul wall clock for the filename
    const name = `rapor-${d.slice(0, 10).replace(/-/g, '')}-${d.slice(11, 16).replace(':', '')}.csv`;
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
    res.send(csv);
    return undefined;
  });
}
