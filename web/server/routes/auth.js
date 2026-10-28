import { login, logout } from '../auth.js';

export default function authRoutes(route) {
  route('POST', '/api/login', null, (req, res, { db, limiter }) => login(req, res, db, limiter));
  route('POST', '/api/logout', 'sales', async (req, res, { db }) => { await logout(req, res, db); return { ok: true }; });
  route('GET', '/api/me', 'sales', (req) => ({ user: req.user, csrf: req.session.csrf }));
}
