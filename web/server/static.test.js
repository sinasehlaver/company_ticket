// The built client is served from distDir with an SPA fallback; /api stays JSON; the inline no-flash script is allowed
// by hash in the document's CSP (never 'unsafe-inline' for scripts).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeApp } from './test-helpers.js';
import { cspForHtml } from './app.js';

const INLINE = '(function(){document.documentElement.setAttribute("data-theme","dark")})();';
const HTML = `<!doctype html><html lang="tr"><head><script>${INLINE}</script><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>`;

describe('static client', () => {
  let t, dir;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ct-dist-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), HTML);
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
    t = await makeApp({ distDir: dir });
  });
  after(async () => { await t.close(); rmSync(dir, { recursive: true, force: true }); });

  test('GET / returns index.html with a hashed script-src', async () => {
    const r = await fetch(`${t.base}/`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal(await r.text(), HTML);
    const csp = r.headers.get('content-security-policy');
    const hash = createHash('sha256').update(INLINE).digest('base64');
    assert.ok(csp.includes(`script-src 'self' 'sha256-${hash}'`), csp);
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), csp);
  });

  test('unknown non-api path falls back to the SPA', async () => {
    const r = await fetch(`${t.base}/events/12`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<div id="root">/);
  });

  test('assets are served and long-cached', async () => {
    const r = await fetch(`${t.base}/assets/app.js`);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'console.log(1)');
    assert.match(r.headers.get('cache-control'), /immutable/);
  });

  test('/api/unknown is still a JSON 404', async () => {
    const r = await fetch(`${t.base}/api/unknown`);
    assert.equal(r.status, 404);
    assert.match(r.headers.get('content-type'), /json/);
    assert.ok((await r.json()).error);
  });

  test('/healthz is not swallowed', async () => {
    const r = await fetch(`${t.base}/healthz`);
    assert.equal(await r.text(), 'ok');
  });
});

test('no dist dir: plain 404 for non-api paths', async () => {
  const t = await makeApp();
  try {
    const r = await fetch(`${t.base}/`);
    assert.equal(r.status, 404);
  } finally { await t.close(); }
});

test('cspForHtml with no inline script keeps script-src self', () => {
  assert.match(cspForHtml('<script src="/a.js"></script>'), /script-src 'self';/);
});
