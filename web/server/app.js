// createApp({dbUrl, authToken, env}) -> {app, db, ctx}. Migrates the DB; bootstrap is separate.
import express from 'express';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate } from './db.js';
import { sessionLoader, makeLimiter } from './auth.js';
import { mountRoutes } from './routes/index.js';

// web/data/company.db regardless of cwd
export const DEFAULT_DB_URL = `file:${fileURLToPath(new URL('../data/company.db', import.meta.url))}`;

/** Mirrors company/settings.py: production refuses a file DB (Render disk is ephemeral). Returns an error string or null. */
export function dbUrlProblem(env) {
  const url = env.DATABASE_URL || DEFAULT_DB_URL;
  if (env.NODE_ENV !== 'production') return null;
  if (/^(libsql|https):\/\//.test(url)) return null;
  if (env.ALLOW_FILE_DB === '1') return null;
  return 'DATABASE_URL must be a libsql:// or https:// Turso URL in production (set ALLOW_FILE_DB=1 for local prod-mode testing)';
}

const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

// The built React client (npm run build). Served when the directory exists; tests pass their own distDir.
export const DEFAULT_DIST_DIR = fileURLToPath(new URL('../client/dist', import.meta.url));

/** CSP for the SPA document: the no-flash inline <script> is allowed by its sha256 hash, never by 'unsafe-inline'. */
export function cspForHtml(html) {
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  return CSP.replace("default-src 'self';", `default-src 'self'; script-src 'self'${hashes.length ? ` ${hashes.join(' ')}` : ''};`);
}

/** index.html + its CSP, re-read when the file changes (a rebuild while the server runs). */
function indexLoader(distDir) {
  const file = join(distDir, 'index.html');
  let cache = null;
  return () => {
    const m = statSync(file).mtimeMs;
    if (!cache || cache.m !== m) { const html = readFileSync(file, 'utf8'); cache = { m, html, csp: cspForHtml(html) }; }
    return cache;
  };
}

export async function createApp({ dbUrl = DEFAULT_DB_URL, authToken, env = process.env, distDir = DEFAULT_DIST_DIR } = {}) {
  const db = openDb(dbUrl, authToken);
  await migrate(db);
  const prod = env.NODE_ENV === 'production';
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', prod ? 1 : false);
  app.locals.secureCookie = prod;
  const ctx = { db, env, limiter: makeLimiter() };

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': CSP,
    });
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', express.json({ limit: '100kb', strict: true }));
  app.use('/api', sessionLoader(db));
  mountRoutes(app, ctx);

  // SPA: hashed assets long-cached, every other non-/api GET gets index.html (hash routing, so this is mostly "/").
  if (distDir && existsSync(join(distDir, 'index.html'))) {
    const index = indexLoader(distDir);
    app.use('/assets', express.static(join(distDir, 'assets'), { immutable: true, maxAge: '1y', index: false, fallthrough: false }));
    app.use(express.static(distDir, { index: false }));
    app.get(/^(?!\/api(\/|$)|\/healthz$).*/, (req, res) => {
      const { html, csp } = index();
      res.set({ 'Content-Security-Policy': csp, 'Cache-Control': 'no-cache' }).type('html').send(html);
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'İstek çok büyük' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Geçersiz JSON' });
    if (err.type && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'Geçersiz istek' });
    if (err.expose && err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  });
  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));
  return { app, db, ctx };
}
