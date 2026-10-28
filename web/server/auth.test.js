import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, PASSWORD } from './test-helpers.js';
import { setUserDisabled, makeLimiter, hashPassword, verifyPassword, csrfCheck } from './auth.js';

describe('auth', () => {
  let t;
  before(async () => { t = await makeApp(); });
  after(() => t.close());

  test('healthz is public and plain', async () => {
    const r = await t.client().get('/healthz');
    assert.equal(r.status, 200);
    assert.equal(r.body, 'ok');
  });

  test('password hash roundtrip', async () => {
    const h = await hashPassword('x');
    assert.match(h, /^scrypt\$/);
    assert.equal(await verifyPassword('x', h), true);
    assert.equal(await verifyPassword('y', h), false);
    assert.equal(await verifyPassword('x', 'garbage'), false);
  });

  test('login ok sets an HttpOnly cookie; /api/me returns user + csrf', async () => {
    await t.user('sales', 'carsi');
    const c = t.client();
    const r = await c.post('/api/login', { username: 'carsi', password: PASSWORD });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.user).sort(), ['id', 'role', 'username']);
    const sc = r.headers.getSetCookie().join('\n');
    assert.match(sc, /ct_sid=[^;]+; Path=\/; HttpOnly; SameSite=Lax/);
    assert.doesNotMatch(sc, /Secure/);
    const me = await c.get('/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.username, 'carsi');
    assert.equal(me.body.user.role, 'sales');
    assert.equal(me.body.csrf, r.body.csrf);
    // only the hash of the session id is stored
    const raw = c.cookie.split('=')[1];
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM sessions WHERE id_hash = ?', [raw]), 0);
  });

  test('bad password / unknown user -> 401, missing fields -> 400', async () => {
    await t.user('sales', 'kutuphane');
    const c = t.client();
    assert.equal((await c.post('/api/login', { username: 'kutuphane', password: 'nope' })).status, 401);
    assert.equal((await c.post('/api/login', { username: 'ghost', password: 'nope' })).status, 401);
    const r = await c.post('/api/login', { username: 'kutuphane' });
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
    assert.equal((await c.post('/api/login', { username: 1, password: [] })).status, 400);
    assert.equal((await c.get('/api/me')).status, 401);
  });

  test('disabled user cannot log in; disabling kills sessions', async () => {
    const id = await t.user('sales', 'hazirlik');
    const c = await t.login('sales', 'hazirlik');
    assert.equal((await c.get('/api/me')).status, 200);
    await setUserDisabled(t.db, id, true);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', [id]), 0);
    assert.equal((await c.get('/api/me')).status, 401);
    const r = await t.client().post('/api/login', { username: 'hazirlik', password: PASSWORD });
    assert.equal(r.status, 403);
    await setUserDisabled(t.db, id, false);
    assert.equal((await t.client().post('/api/login', { username: 'hazirlik', password: PASSWORD })).status, 200);
  });

  test('rate limit: 10 failures per ip+username -> 429, even with the right password', async () => {
    await t.user('sales', 'disari');
    const c = t.client();
    for (let i = 0; i < 10; i++) assert.equal((await c.post('/api/login', { username: 'disari', password: 'bad' })).status, 401);
    const r = await c.post('/api/login', { username: 'disari', password: PASSWORD });
    assert.equal(r.status, 429);
    assert.match(r.body.error, /15 dakika/);
    // other usernames from the same ip are unaffected
    await t.user('sales', 'mimarlik');
    assert.equal((await c.post('/api/login', { username: 'mimarlik', password: PASSWORD })).status, 200);
  });

  test('limiter window expires', () => {
    let clock = 0;
    const l = makeLimiter({ max: 2, windowMs: 1000, clock: () => clock });
    l.fail('k'); l.fail('k');
    assert.equal(l.blocked('k'), true);
    clock = 1001;
    assert.equal(l.blocked('k'), false);
  });

  test('limiter prunes expired keys once it holds many (no unbounded growth from spoofed usernames)', () => {
    let clock = 0;
    const l = makeLimiter({ max: 2, windowMs: 1000, clock: () => clock });
    for (let i = 0; i < 1500; i++) l.fail(`ip|user${i}`);
    clock = 2000;
    l.fail('ip|fresh');
    assert.equal(l.size(), 1);
  });

  test('CSRF: a same-length token with a non-ASCII char -> 403, not a 500', async () => {
    const c = await t.login('baskan', 'b-csrf-latin1');
    const bad = `${c.csrf.slice(0, -1)}é`;
    assert.equal(bad.length, c.csrf.length);
    const r = await c.post('/api/logout', undefined, { headers: { 'x-csrf-token': bad } });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    let err;
    csrfCheck({ method: 'POST', headers: { 'x-csrf-token': bad }, session: { csrf: c.csrf } }, {}, (e) => { err = e; });
    assert.equal(err?.status, 403);
  });

  test('logout deletes the session and clears the cookie', async () => {
    const c = await t.login('baskan', 'b-logout');
    const r = await c.post('/api/logout');
    assert.equal(r.status, 200);
    assert.match(r.headers.getSetCookie().join(), /ct_sid=; .*Max-Age=0/);
    assert.equal((await c.get('/api/me')).status, 401);
  });

  test('CSRF: missing or wrong token -> 403, right token passes', async () => {
    const c = await t.login('baskan', 'b-csrf');
    const good = c.csrf;
    c.csrf = '';
    assert.equal((await c.post('/api/events', { name: 'x', hallId: 999 })).status, 403);
    c.csrf = good.slice(0, -1) + (good.endsWith('A') ? 'B' : 'A');
    const r = await c.post('/api/events', { name: 'x', hallId: 999 });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /CSRF/);
    c.csrf = 'short';
    assert.equal((await c.post('/api/logout')).status, 403);
    c.csrf = good;
    assert.equal((await c.post('/api/events', { name: 'x', hallId: 999 })).status, 400); // passed CSRF, failed validation
    // another session's token is not accepted
    const other = await t.login('baskan', 'b-csrf2');
    c.csrf = other.csrf;
    assert.equal((await c.post('/api/logout')).status, 403);
  });

  test('Origin mismatch -> 403 (login included); same host passes', async () => {
    const c = await t.login('baskan', 'b-origin');
    const host = new URL(t.base).host;
    assert.equal((await c.post('/api/logout', undefined, { headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await c.post('/api/logout', undefined, { headers: { origin: 'null' } })).status, 403);
    const anon = t.client();
    assert.equal((await anon.post('/api/login', { username: 'b-origin', password: PASSWORD }, { headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await c.post('/api/logout', undefined, { headers: { origin: `http://${host}` } })).status, 200);
  });

  test('expired session -> 401 and is deleted; active session slides', async () => {
    const c = await t.login('sales', 'exp');
    await t.db.execute("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = (SELECT id FROM users WHERE username = 'exp')");
    assert.equal((await c.get('/api/me')).status, 401);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'exp')"), 0);

    const d = await t.login('sales', 'slide');
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await t.db.execute({ sql: "UPDATE sessions SET expires_at = ? WHERE user_id = (SELECT id FROM users WHERE username = 'slide')", args: [soon] });
    assert.equal((await d.get('/api/me')).status, 200);
    const r = await t.db.execute("SELECT expires_at FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'slide')");
    assert.ok(Date.parse(r.rows[0].expires_at) > Date.now() + 11 * 60 * 60 * 1000);
  });

  test('login replaces an existing session (no fixation)', async () => {
    const c = await t.login('sales', 'fix');
    const first = c.cookie;
    const r = await c.post('/api/login', { username: 'fix', password: PASSWORD });
    assert.equal(r.status, 200);
    assert.notEqual(c.cookie, first);
    assert.equal(await t.count("SELECT COUNT(*) AS n FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'fix')"), 1);
  });

  test('security headers', async () => {
    const r = await t.client().get('/healthz');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(r.headers.get('referrer-policy'));
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.headers.get('x-powered-by'), null);
  });
});

describe('production mode', () => {
  test('Secure cookie when NODE_ENV=production', async () => {
    const t = await makeApp({ env: { NODE_ENV: 'production' } });
    try {
      await t.user('sales', 'p');
      const r = await t.client().post('/api/login', { username: 'p', password: PASSWORD });
      assert.match(r.headers.getSetCookie().join(), /; Secure/);
    } finally { await t.close(); }
  });

  test('dbUrlProblem refuses file DBs in production', async () => {
    const { dbUrlProblem } = await import('./app.js');
    assert.equal(dbUrlProblem({}), null);
    assert.ok(dbUrlProblem({ NODE_ENV: 'production' }));
    assert.ok(dbUrlProblem({ NODE_ENV: 'production', DATABASE_URL: 'file:x.db' }));
    assert.equal(dbUrlProblem({ NODE_ENV: 'production', DATABASE_URL: 'file:x.db', ALLOW_FILE_DB: '1' }), null);
    assert.equal(dbUrlProblem({ NODE_ENV: 'production', DATABASE_URL: 'libsql://db-org.turso.io' }), null);
    assert.equal(dbUrlProblem({ NODE_ENV: 'production', DATABASE_URL: 'https://db-org.turso.io' }), null);
  });
});
