import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const source = Uint8Array.from({ length: 256 }, (_, i) => i);
function runtime(t) {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true,
    scriptPath: new URL('../dist/pharos_hackutd_2026/index.js', import.meta.url).pathname,
    compatibilityDate: '2025-01-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { PHAROS_STORE: { className: 'PharosStore', useSQLite: true } },
    serviceBindings: { ASSETS: () => new Response(source, { headers: { 'Content-Type': 'video/mp4', ETag: '"fixture"' } }) },
    bindings: { DEEPSPACE_APP_ID: 'video-range-fixture', APP_NAME: 'video-range-fixture' },
  })); t.after(() => mf.dispose()); return mf;
}
test('public demo video delivers full metadata without requiring caller-record access', async t => {
  const mf = runtime(t);
  const full = await mf.dispatchFetch('https://fixture.test/pharos-demo.mp4');
  assert.equal(full.status, 200); assert.equal(full.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(full.headers.get('Content-Length'), '256'); assert.deepEqual(new Uint8Array(await full.arrayBuffer()), source);
});
test('public demo video honors bounded, open-ended, suffix, and clamped byte ranges', async t => {
  const mf = runtime(t);
  for (const [range, start, end] of [['bytes=10-19', 10, 19], ['bytes=250-', 250, 255], ['bytes=-6', 250, 255], ['bytes=250-9999', 250, 255]]) {
    const response = await mf.dispatchFetch('https://fixture.test/pharos-demo.mp4', { headers: { Range: range } });
    assert.equal(response.status, 206); assert.equal(response.headers.get('Content-Range'), `bytes ${start}-${end}/256`);
    assert.equal(response.headers.get('Content-Length'), String(end - start + 1)); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), source.slice(start, end + 1));
  }
});
test('public demo video rejects malformed, multiple, reversed and unsatisfiable ranges', async t => {
  const mf = runtime(t);
  for (const range of ['bytes=256-', 'bytes=20-10', 'bytes=-0', 'bytes=0-1,4-5', 'bytes=-', 'bad', 'bytes=99999999999999999999999999-']) {
    const response = await mf.dispatchFetch('https://fixture.test/pharos-demo.mp4', { headers: { Range: range } });
    assert.equal(response.status, 416, range); assert.equal(response.headers.get('Content-Range'), 'bytes */256'); assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
});
test('public demo video returns full representation when If-Range no longer matches', async t => {
  const mf = runtime(t);
  for (const [tag, status] of [['"old"', 200], ['"fixture"', 206]]) {
    const response = await mf.dispatchFetch('https://fixture.test/pharos-demo.mp4', { headers: { Range: 'bytes=10-19', 'If-Range': tag } });
    assert.equal(response.status, status); assert.equal((await response.arrayBuffer()).byteLength, status === 200 ? 256 : 10);
  }
});
