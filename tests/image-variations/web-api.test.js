'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const api = require('../../scripts/image-variations/web/api');

console.log('=== Testing image-variations/web/api.js ===\n');

let passed = 0;
let failed = 0;

function test(desc, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => { console.log(`  ✓ ${desc}`); passed++; },
        e => { console.log(`  ✗ ${desc}: ${e.message}`); failed++; }
      );
    }
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${desc}: ${e.message}`);
    failed++;
  }
  return Promise.resolve();
}

const presetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-presets-'));

fs.writeFileSync(path.join(presetsDir, 'tiny.json'), JSON.stringify({
  name: 'tiny',
  base: 'the same character',
  template: '{base}, {pose}, {background}',
  categories: {
    pose: ['standing', 'sitting', 'walking'],
    background: ['a park', 'a cafe']
  }
}));

fs.writeFileSync(path.join(presetsDir, 'labelled.json'), JSON.stringify({
  template: '{pose}',
  categories: { pose: ['standing', 'sitting'] },
  labels: { pose: '\u30dd\u30fc\u30ba' },
  title: '\u30c6\u30b9\u30c8'
}));

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

function okFetch(payload, capture = {}) {
  return async (url, init) => {
    capture.url = url;
    capture.body = JSON.parse(init.body);
    capture.headers = init.headers;
    return { ok: true, status: 200, json: async () => payload };
  };
}

async function call(options) {
  return api.handleApiRequest({ presetsDir, ...options });
}

async function rejects(promise, pattern) {
  try {
    await promise;
  } catch (error) {
    assert.match(error.message, pattern);
    return error;
  }
  throw new Error('expected the call to reject');
}

async function run() {
  console.log('listPresets / resolvePreset:');

  await test('lists preset ids without the .json suffix', () => {
    assert.deepStrictEqual(api.listPresets(presetsDir), [
      { id: 'labelled', title: '\u30c6\u30b9\u30c8' },
      { id: 'tiny', title: 'tiny' }
    ]);
  });
  await test('returns an empty list for a missing directory', () => {
    assert.deepStrictEqual(api.listPresets(path.join(presetsDir, 'nope')), []);
  });
  await test('rejects a preset id containing a path separator', () => {
    assert.throws(() => api.resolvePreset(presetsDir, '../../etc/passwd'), /no path separators/);
  });
  await test('rejects a non-string preset id', () => {
    assert.throws(() => api.resolvePreset(presetsDir, undefined), /no path separators/);
  });
  await test('404s an unknown preset', () => {
    assert.throws(() => api.resolvePreset(presetsDir, 'missing'), error => error.status === 404);
  });

  console.log('\nGET /api/presets and /api/config:');

  await test('reports whether the server holds an API key', async () => {
    const withKey = await call({ method: 'GET', pathname: '/api/presets', apiKey: 'xai-test' });
    const without = await call({ method: 'GET', pathname: '/api/presets', apiKey: '' });
    assert.strictEqual(withKey.body.hasApiKey, true);
    assert.strictEqual(without.body.hasApiKey, false);
  });
  await test('describes the categories for the UI', async () => {
    const { body } = await call({ method: 'GET', pathname: '/api/config', query: { preset: 'tiny' } });
    assert.strictEqual(body.name, 'tiny');
    assert.strictEqual(body.categories.pose.length, 3);
    assert.deepStrictEqual(body.categories.background[0], { text: 'a park', weight: 1, label: null });
  });
  await test('lists a preset that will not parse under its id rather than failing', () => {
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-broken-'));
    fs.writeFileSync(path.join(broken, 'ok.json'), JSON.stringify({ template: '{a}', categories: { a: ['x'] }, title: 'Fine' }));
    fs.writeFileSync(path.join(broken, 'busted.json'), '{ not json');
    assert.deepStrictEqual(api.listPresets(broken), [
      { id: 'busted', title: 'busted' },
      { id: 'ok', title: 'Fine' }
    ]);
    fs.rmSync(broken, { recursive: true, force: true });
  });
  await test('passes category display names through to the UI', async () => {
    const { body } = await call({ method: 'GET', pathname: '/api/config', query: { preset: 'labelled' } });
    assert.strictEqual(body.labels.pose, '\u30dd\u30fc\u30ba');
  });
  await test('never exposes the endpoints or a key in the config payload', async () => {
    const { body } = await call({ method: 'GET', pathname: '/api/config', query: { preset: 'tiny' } });
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes('api.x.ai'), 'endpoint leaked to the browser');
    assert.ok(!('wire' in body), 'wire block leaked to the browser');
  });

  console.log('\nPOST /api/plan:');

  await test('returns one prompt per requested variation', async () => {
    const { body } = await call({
      method: 'POST', pathname: '/api/plan',
      body: { preset: 'tiny', count: 3, seed: 'fixed' }
    });
    assert.strictEqual(body.items.length, 3);
    assert.strictEqual(body.seed, 'fixed');
    assert.match(body.items[0].prompt, /the same character/);
  });
  await test('is reproducible for the same seed', async () => {
    const first = await call({ method: 'POST', pathname: '/api/plan', body: { preset: 'tiny', count: 4, seed: 's1' } });
    const second = await call({ method: 'POST', pathname: '/api/plan', body: { preset: 'tiny', count: 4, seed: 's1' } });
    assert.deepStrictEqual(first.body.items, second.body.items);
  });
  await test('invents a seed when none is given and reports it', async () => {
    const { body } = await call({ method: 'POST', pathname: '/api/plan', body: { preset: 'tiny', count: 1 } });
    assert.match(body.seed, /^[0-9a-f]{12}$/);
  });
  await test('holds a category fixed when `only` excludes it', async () => {
    const { body } = await call({
      method: 'POST', pathname: '/api/plan',
      body: { preset: 'tiny', count: 5, seed: 'lock', only: ['pose'] }
    });
    const backgrounds = new Set(body.items.map(item => item.picks.background));
    assert.strictEqual(backgrounds.size, 1, 'background should not vary');
  });
  await test('reports an exhausted combination space', async () => {
    const { body } = await call({
      method: 'POST', pathname: '/api/plan',
      body: { preset: 'tiny', count: 10, seed: 'x' }
    });
    assert.strictEqual(body.space, 6);
    assert.strictEqual(body.exhausted, true);
  });
  await test('rejects a count below 1', () => rejects(
    call({ method: 'POST', pathname: '/api/plan', body: { preset: 'tiny', count: 0 } }),
    /count must be an integer/
  ));
  await test('rejects a count above the ceiling', () => rejects(
    call({ method: 'POST', pathname: '/api/plan', body: { preset: 'tiny', count: 999 } }),
    /count must be an integer/
  ));
  await test('rejects a non-integer count', () => rejects(
    call({ method: 'POST', pathname: '/api/plan', body: { preset: 'tiny', count: 2.5 } }),
    /count must be an integer/
  ));
  await test('rejects lock and only together', () => rejects(
    call({ method: 'POST', pathname: '/api/plan', body: { preset: 'tiny', count: 2, lock: ['pose'], only: ['background'] } }),
    /either lock or only/
  ));
  await test('turns an unknown category into a 400', async () => {
    const error = await rejects(
      call({ method: 'POST', pathname: '/api/plan', body: { preset: 'tiny', count: 2, only: ['nope'] } }),
      /unknown categor/
    );
    assert.strictEqual(error.status, 400);
  });

  console.log('\nreference image validation:');

  await test('accepts a base64 data URI', () => {
    assert.deepStrictEqual(api.normalizeReferenceImages([PIXEL]), [PIXEL]);
  });
  await test('treats a missing list as no references', () => {
    assert.deepStrictEqual(api.normalizeReferenceImages(undefined), []);
  });
  await test('rejects a local filesystem path', () => {
    assert.throws(() => api.normalizeReferenceImages(['/etc/passwd']), /data:image/);
  });
  await test('rejects an http url', () => {
    assert.throws(() => api.normalizeReferenceImages(['http://example.com/a.png']), /data:image/);
  });
  await test('rejects a non-image data URI', () => {
    assert.throws(() => api.normalizeReferenceImages(['data:text/html;base64,AAAA']), /data:image/);
  });
  await test('rejects more than five references', () => {
    assert.throws(() => api.normalizeReferenceImages(new Array(6).fill(PIXEL)), /at most 5/);
  });

  console.log('\nPOST /api/generate-one:');

  await test('503s when the server holds no key', async () => {
    const error = await rejects(
      call({ method: 'POST', pathname: '/api/generate-one', apiKey: '', body: { preset: 'tiny', prompt: 'hi' } }),
      /XAI_API_KEY is not set/
    );
    assert.strictEqual(error.status, 503);
  });
  await test('requires a prompt', () => rejects(
    call({ method: 'POST', pathname: '/api/generate-one', apiKey: 'k', body: { preset: 'tiny', prompt: '   ' } }),
    /prompt is required/
  ));
  await test('sends the key as a bearer token', async () => {
    const capture = {};
    await call({
      method: 'POST', pathname: '/api/generate-one', apiKey: 'xai-secret',
      body: { preset: 'tiny', prompt: 'a cat' },
      fetchImpl: okFetch({ data: [{ b64_json: 'AAAA' }] }, capture)
    });
    assert.strictEqual(capture.headers.Authorization, 'Bearer xai-secret');
  });
  await test('uses the generate endpoint with no reference', async () => {
    const capture = {};
    await call({
      method: 'POST', pathname: '/api/generate-one', apiKey: 'k',
      body: { preset: 'tiny', prompt: 'a cat' },
      fetchImpl: okFetch({ data: [{ b64_json: 'AAAA' }] }, capture)
    });
    assert.match(capture.url, /images\/generations$/);
    assert.strictEqual(capture.body.image, undefined);
  });
  await test('uses the edit endpoint and carries the reference', async () => {
    const capture = {};
    const { body } = await call({
      method: 'POST', pathname: '/api/generate-one', apiKey: 'k',
      body: { preset: 'tiny', prompt: 'a cat', referenceImages: [PIXEL] },
      fetchImpl: okFetch({ data: [{ b64_json: 'AAAA' }] }, capture)
    });
    assert.match(capture.url, /images\/edits$/);
    assert.strictEqual(capture.body.image[0].url, PIXEL);
    assert.strictEqual(body.usedReference, true);
  });
  await test('returns the decoded image', async () => {
    const { body } = await call({
      method: 'POST', pathname: '/api/generate-one', apiKey: 'k',
      body: { preset: 'tiny', prompt: 'a cat' },
      fetchImpl: okFetch({ data: [{ b64_json: 'QUJD' }] })
    });
    assert.deepStrictEqual(body.image, { kind: 'base64', value: 'QUJD', revisedPrompt: null });
  });
  await test('surfaces an upstream failure without leaking the key', async () => {
    const error = await rejects(
      call({
        method: 'POST', pathname: '/api/generate-one', apiKey: 'xai-secret',
        body: { preset: 'tiny', prompt: 'a cat' },
        fetchImpl: async () => ({ ok: false, status: 400, statusText: 'Bad Request', text: async () => 'bad prompt' })
      }),
      /responded 400/
    );
    assert.ok(!error.message.includes('xai-secret'), 'the key must not appear in the error');
    assert.strictEqual(error.status, 502, 'an upstream rejection is a gateway failure, not a server bug');
  });
  await test('reports a network failure as 502', async () => {
    const error = await rejects(
      call({
        method: 'POST', pathname: '/api/generate-one', apiKey: 'k',
        body: { preset: 'tiny', prompt: 'a cat' },
        fetchImpl: async () => { throw new Error('ECONNREFUSED'); }
      }),
      /network error/
    );
    assert.strictEqual(error.status, 502);
  });
  await test('reports an unusable response shape as 502', async () => {
    const error = await rejects(
      call({
        method: 'POST', pathname: '/api/generate-one', apiKey: 'k',
        body: { preset: 'tiny', prompt: 'a cat' },
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })
      }),
      /unexpected response shape/
    );
    assert.strictEqual(error.status, 502);
  });

  console.log('\nrouting:');

  await test('404s an unknown endpoint', () => rejects(
    call({ method: 'GET', pathname: '/api/nope' }), /no such endpoint/
  ));
  await test('404s a known path with the wrong method', () => rejects(
    call({ method: 'GET', pathname: '/api/plan' }), /no such endpoint/
  ));

  fs.rmSync(presetsDir, { recursive: true, force: true });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

run();
