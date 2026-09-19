'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const io = require('../../scripts/image-variations/lib/io');

console.log('=== Testing image-variations/io.js ===\n');

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-io-'));
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const pngPath = path.join(tmpDir, 'ref.png');
fs.writeFileSync(pngPath, PNG_BYTES);

async function run() {
  console.log('mimeForPath:');
  await test('maps known extensions', () => {
    assert.strictEqual(io.mimeForPath('a.PNG'), 'image/png');
    assert.strictEqual(io.mimeForPath('a.jpeg'), 'image/jpeg');
  });
  await test('rejects an unsupported extension', () => {
    assert.throws(() => io.mimeForPath('a.bmp'), /unsupported image type/);
  });

  console.log('\ntoImageReference:');
  await test('encodes a local file as a data URI', () => {
    const reference = io.toImageReference(pngPath);
    assert.ok(reference.startsWith('data:image/png;base64,'));
    assert.strictEqual(reference.split(',')[1], PNG_BYTES.toString('base64'));
  });
  await test('passes an https URL through unchanged', () => {
    assert.strictEqual(io.toImageReference('https://e.com/a.png'), 'https://e.com/a.png');
  });
  await test('passes an existing data URI through unchanged', () => {
    assert.strictEqual(io.toImageReference('data:image/png;base64,AA'), 'data:image/png;base64,AA');
  });
  await test('reports a missing file', () => {
    assert.throws(() => io.toImageReference(path.join(tmpDir, 'nope.png')), /reference image not found/);
  });

  console.log('\ntoImageReferences:');
  await test('accepts up to five images', () => {
    assert.strictEqual(io.toImageReferences(Array(5).fill('https://e.com/a.png')).length, 5);
  });
  await test('rejects more than five images', () => {
    assert.throws(() => io.toImageReferences(Array(6).fill('https://e.com/a.png')), /at most 5/);
  });
  await test('an empty list stays empty', () => {
    assert.deepStrictEqual(io.toImageReferences([]), []);
  });

  console.log('\nsaveImage:');
  await test('writes base64 output as .png', async () => {
    const target = await io.saveImage(
      { kind: 'base64', value: PNG_BYTES.toString('base64') },
      path.join(tmpDir, 'out-b64')
    );
    assert.strictEqual(path.extname(target), '.png');
    assert.deepStrictEqual(fs.readFileSync(target), PNG_BYTES);
  });
  await test('downloads a url result and honours its content type', async () => {
    const target = await io.saveImage(
      { kind: 'url', value: 'https://e.com/a' },
      path.join(tmpDir, 'out-url'),
      async () => ({
        ok: true,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.length)
      })
    );
    assert.strictEqual(path.extname(target), '.jpg');
  });
  await test('reports a failed download', async () => {
    await assert.rejects(
      io.saveImage({ kind: 'url', value: 'https://e.com/a' }, path.join(tmpDir, 'out-fail'),
        async () => ({ ok: false, status: 404, statusText: 'Not Found' })),
      /failed to download/
    );
  });

  console.log('\npicksToPlain:');
  await test('flattens options to their text', () => {
    assert.deepStrictEqual(io.picksToPlain({ pose: { text: 'standing', weight: 2 } }), { pose: 'standing' });
  });

  console.log('\nmanifest output:');
  const manifest = {
    seed: 'abc',
    referenceCount: 1,
    config: { name: 'demo', model: 'grok-imagine-image-2.0' },
    items: [
      { index: 1, status: 'ok', picks: { pose: 'standing' }, prompt: 'a prompt', file: '001.png' },
      { index: 2, status: 'failed', picks: { pose: 'sitting' }, prompt: 'b prompt', file: null, error: 'boom' }
    ]
  };
  await test('writeManifest produces readable JSON', () => {
    const target = io.writeManifest(tmpDir, manifest);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, 'utf8')), manifest);
  });
  await test('writePromptSheet lists every item with its prompt', () => {
    const content = fs.readFileSync(io.writePromptSheet(tmpDir, manifest), 'utf8');
    assert.ok(content.includes('a prompt') && content.includes('b prompt'));
    assert.ok(content.includes('- pose: standing'));
    assert.ok(content.includes('- error: boom'));
    assert.ok(content.includes('`abc`'));
  });

  console.log('\nensureDir:');
  await test('creates nested directories and is idempotent', () => {
    const nested = path.join(tmpDir, 'a', 'b', 'c');
    io.ensureDir(nested);
    io.ensureDir(nested);
    assert.ok(fs.statSync(nested).isDirectory());
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

run();
