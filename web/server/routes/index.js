// Central route table. Every route is declared through route(method, path, minRole, handler);
// minRole null = public. ROUTES is built once at import and walked by the authz matrix test.
import express from 'express';
import { requireRole, csrfCheck, originCheck, httpError } from '../auth.js';
import authRoutes from './auth.js';
import hallRoutes from './halls.js';
import eventRoutes from './events.js';
import dayRoutes from './days.js';
import userRoutes from './users.js';
import reportRoutes from './report.js';
import backupRoutes from './backup.js';

/** @type {{method:string, path:string, minRole:null|'sales'|'baskan'|'superuser', handler:Function}[]} */
export const ROUTES = [];

/** handler(req, res, ctx) -> value (sent as JSON) | undefined (handler responded itself). ctx = {db, limiter, env}. */
export function route(method, path, minRole, handler) {
  ROUTES.push({ method: method.toUpperCase(), path, minRole, handler });
}

route('GET', '/healthz', null, (req, res) => { res.type('text/plain').send('ok'); }); // no DB access
authRoutes(route);
hallRoutes(route);
eventRoutes(route);
dayRoutes(route);
userRoutes(route);
reportRoutes(route);
backupRoutes(route);

const ID = /^[1-9]\d{0,15}$/;

/** Mounts every ROUTES entry. Order per route: role (401/403) -> CSRF (non-GET, non-public) -> handler. */
export function mountRoutes(app, ctx) {
  const r = express.Router();
  r.param('id', (req, res, next, id) => (ID.test(id) ? next() : next(httpError(404, 'Bulunamadı'))));
  r.use('/api', originCheck);
  for (const { method, path, minRole, handler } of ROUTES) {
    const chain = [requireRole(minRole)];
    if (minRole) chain.push(csrfCheck);
    r[method.toLowerCase()](path, ...chain, async (req, res) => {
      const out = await handler(req, res, ctx);
      if (out !== undefined && !res.headersSent) res.status(res.statusCode || 200).json(out);
    });
  }
  r.use('/api', (req, res, next) => next(httpError(404, 'Bulunamadı')));
  app.use(r);
}
