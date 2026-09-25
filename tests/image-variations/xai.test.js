'use strict';
const assert = require('assert');
const xai = require('../../scripts/image-variations/lib/xai');
const { normalizeConfig } = require('../../scripts/image-variations/lib/config');

console.log('=== Testing image-variations/xai.js ===\n');

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

const config = normalizeConfig({
  template: '{pose}',
  categories: { pose: ['standing'] },
  request: { quality: 'high' }
});

const noSleep = () => Promise.resolve();

function okResponse(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

function errorResponse(status, body = 'boom') {
  return { ok: false, status, statusText: 'Err', text: async () => body };
}

async function run() {
  console.log('buildRequestBody:');
  await test('includes model, prompt, n and response_format', () => {
    const body = xai.buildRequestBody({ config, prompt: 'p' });
    assert.strictEqual(body.model, config.wire.model);
    assert.strictEqual(body.prompt, 'p');
    assert.strictEqual(body.n, 1);
    assert.strictEqual(body.response_format, 'b64_json');
  });
  await test('merges config.request extras', () => {
    assert.strictEqual(xai.buildRequestBody({ config, prompt: 'p' }).quality, 'high');
  });
  await test('omits the image field with no reference images', () => {
    assert.strictEqual(xai.buildRequestBody({ config, prompt: 'p' }).image, undefined);
  });
  await test('sends a single reference as one object, not a one-element array', () => {
    const body = xai.buildRequestBody({ config, prompt: 'p', referenceImages: ['data:image/png;base64,AA'] });
    assert.deepStrictEqual(body.image, { type: 'image_url', url: 'data:image/png;base64,AA' });
    assert.strictEqual(body.images, undefined, 'the plural field belongs to multi-image edits');
  });
  await test('sends several references as an array under the plural field', () => {
    const body = xai.buildRequestBody({
      config, prompt: 'p',
      referenceImages: ['data:image/png;base64,AA', 'data:image/png;base64,BB']
    });
    assert.strictEqual(body.image, undefined, 'the singular field takes one image only');
    assert.deepStrictEqual(body.images, [
      { type: 'image_url', url: 'data:image/png;base64,AA' },
      { type: 'image_url', url: 'data:image/png;base64,BB' }
    ]);
  });
  await test('omits both reference fields with no reference images', () => {
    const body = xai.buildRequestBody({ config, prompt: 'p' });
    assert.strictEqual(body.image, undefined);
    assert.strictEqual(body.images, undefined);
  });
  await test('imageStyle "url" sends bare strings', () => {
    const urlConfig = normalizeConfig({
      template: '{pose}',
      categories: { pose: ['x'] },
      wire: { imageStyle: 'url', imageField: 'image_urls' }
    });
    const body = xai.buildRequestBody({ config: urlConfig, prompt: 'p', referenceImages: ['https://e.com/a.png'] });
    assert.strictEqual(body.image_urls, 'https://e.com/a.png');
  });

  console.log('\nresolveEndpoint:');
  await test('uses the generate endpoint with no reference', () => {
    assert.strictEqual(xai.resolveEndpoint(config, []), config.wire.generateEndpoint);
  });
  await test('uses the edit endpoint with a reference', () => {
    assert.strictEqual(xai.resolveEndpoint(config, ['data:image/png;base64,AA']), config.wire.editEndpoint);
  });

  console.log('\nsummarizeBody:');
  await test('replaces arrays with a count', () => {
    assert.strictEqual(xai.summarizeBody({ image: [1, 2] }).image, '[2 item(s)]');
  });
  await test('redacts a data URI nested inside the reference object', () => {
    const dataUri = `data:image/png;base64,${'A'.repeat(5000)}`;
    const summary = xai.summarizeBody({ image: { type: 'image_url', url: dataUri } });
    assert.strictEqual(summary.image.type, 'image_url');
    assert.ok(summary.image.url.length < 200, 'the payload must not be logged in full');
    assert.match(summary.image.url, /\(5022 chars\)$/);
  });
  await test('leaves a short nested value readable', () => {
    const summary = xai.summarizeBody({ image: { type: 'image_url', url: 'https://e.com/a.png' } });
    assert.deepStrictEqual(summary.image, { type: 'image_url', url: 'https://e.com/a.png' });
  });
  await test('truncates long strings', () => {
    const summary = xai.summarizeBody({ prompt: 'x'.repeat(500) }).prompt;
    assert.ok(summary.length < 200 && summary.includes('500 chars'));
  });
  await test('leaves short values untouched', () => {
    assert.strictEqual(xai.summarizeBody({ model: 'm' }).model, 'm');
  });

  console.log('\nrequestImage:');
  await test('returns the parsed JSON on success', async () => {
    const payload = await xai.requestImage({
      endpoint: 'https://x', apiKey: 'k', body: {}, sleepImpl: noSleep,
      fetchImpl: async () => okResponse({ data: [{ b64_json: 'AA' }] })
    });
    assert.deepStrictEqual(payload, { data: [{ b64_json: 'AA' }] });
  });
  await test('sends the bearer token and JSON content type', async () => {
    let seen = null;
    await xai.requestImage({
      endpoint: 'https://x', apiKey: 'secret', body: { a: 1 }, sleepImpl: noSleep,
      fetchImpl: async (_url, init) => { seen = init; return okResponse({ data: [{ url: 'u' }] }); }
    });
    assert.strictEqual(seen.headers.Authorization, 'Bearer secret');
    assert.strictEqual(seen.headers['Content-Type'], 'application/json');
    assert.strictEqual(seen.body, '{"a":1}');
  });
  await test('retries a 429 and then succeeds', async () => {
    let calls = 0;
    const payload = await xai.requestImage({
      endpoint: 'https://x', apiKey: 'k', body: {}, sleepImpl: noSleep,
      fetchImpl: async () => { calls++; return calls < 3 ? errorResponse(429) : okResponse({ data: [{ url: 'u' }] }); }
    });
    assert.strictEqual(calls, 3);
    assert.deepStrictEqual(payload, { data: [{ url: 'u' }] });
  });
  await test('does not retry a 400', async () => {
    let calls = 0;
    await assert.rejects(
      xai.requestImage({
        endpoint: 'https://x', apiKey: 'k', body: {}, sleepImpl: noSleep,
        fetchImpl: async () => { calls++; return errorResponse(400, 'bad prompt'); }
      }),
      /400/
    );
    assert.strictEqual(calls, 1);
  });
  await test('surfaces the response body in the error', async () => {
    await assert.rejects(
      xai.requestImage({
        endpoint: 'https://x', apiKey: 'k', body: {}, sleepImpl: noSleep,
        fetchImpl: async () => errorResponse(422, 'invalid image field')
      }),
      /invalid image field/
    );
  });
  await test('gives up after maxRetries', async () => {
    let calls = 0;
    await assert.rejects(
      xai.requestImage({
        endpoint: 'https://x', apiKey: 'k', body: {}, maxRetries: 2, sleepImpl: noSleep,
        fetchImpl: async () => { calls++; return errorResponse(503); }
      }),
      /503/
    );
    assert.strictEqual(calls, 3);
  });
  await test('retries network failures', async () => {
    let calls = 0;
    await assert.rejects(
      xai.requestImage({
        endpoint: 'https://x', apiKey: 'k', body: {}, maxRetries: 1, sleepImpl: noSleep,
        fetchImpl: async () => { calls++; throw new Error('ECONNRESET'); }
      }),
      /network error/
    );
    assert.strictEqual(calls, 2);
  });
  await test('explains a missing fetch implementation', async () => {
    await assert.rejects(
      xai.requestImage({ endpoint: 'https://x', apiKey: 'k', body: {}, fetchImpl: null }),
      /Node\.js 18/
    );
  });

  console.log('\nextractImage:');
  await test('prefers b64_json', () => {
    assert.deepStrictEqual(
      xai.extractImage({ data: [{ b64_json: 'AA', revised_prompt: 'r' }] }),
      { kind: 'base64', value: 'AA', revisedPrompt: 'r' }
    );
  });
  await test('falls back to a url', () => {
    assert.strictEqual(xai.extractImage({ data: [{ url: 'https://e/a.png' }] }).kind, 'url');
  });
  await test('rejects an empty data array', () => {
    assert.throws(() => xai.extractImage({ data: [] }), /unexpected response shape/);
  });
  await test('rejects an entry with no image', () => {
    assert.throws(() => xai.extractImage({ data: [{ nope: 1 }] }), /neither b64_json nor url/);
  });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

run();
