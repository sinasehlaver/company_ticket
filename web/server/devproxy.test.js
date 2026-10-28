// The vite dev proxy must keep the browser's Host: originCheck compares Origin's host to Host, and
// changeOrigin (implied by the string shorthand) rewrites Host to :5140 → every dev POST 403s "İstek kaynağı geçersiz".
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('vite dev proxy preserves Host (no changeOrigin)', async () => {
  const { default: cfg } = await import('../client/vite.config.js');
  const proxy = cfg.server.proxy;
  for (const path of ['/api', '/healthz']) {
    assert.equal(typeof proxy[path], 'object', `${path}: string shorthand implies changeOrigin:true`);
    assert.equal(proxy[path].changeOrigin, false, path);
  }
});
