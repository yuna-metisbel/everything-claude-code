'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, resolveLockedCategories } = require('../../scripts/image-variations/lib/args');
const { main, runPool } = require('../../scripts/image-variations/cli');

console.log('=== Testing image-variations CLI ===\n');

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-cli-'));
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const refPath = path.join(tmpDir, 'ref.png');
fs.writeFileSync(refPath, PNG_BYTES);

const CATEGORIES = ['background', 'hair', 'outfit', 'pose'];

/** Silence CLI progress logging while capturing stdout. */
function capture(fn) {
  const chunks = [];
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = chunk => { chunks.push(String(chunk)); return true; };
  process.stderr.write = () => true;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    })
    .then(value => ({ value, stdout: chunks.join('') }));
}

function stubFetch(handler) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = previous; };
}

const okFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ data: [{ b64_json: PNG_BYTES.toString('base64') }] })
});

async function run() {
  console.log('parseArgs:');
  await test('collects repeated --image flags', () => {
    assert.deepStrictEqual(parseArgs(['-i', 'a.png', '--image', 'b.png']).images, ['a.png', 'b.png']);
  });
  await test('treats a bare positional as an image', () => {
    assert.deepStrictEqual(parseArgs(['a.png']).images, ['a.png']);
  });
  await test('applies defaults', () => {
    const options = parseArgs([]);
    assert.strictEqual(options.count, 4);
    assert.strictEqual(options.concurrency, 2);
    assert.strictEqual(options.dryRun, false);
  });
  await test('rejects a non-integer count', () => {
    assert.throws(() => parseArgs(['--count', '2.5']), /positive integer/);
  });
  await test('rejects a zero concurrency', () => {
    assert.throws(() => parseArgs(['--concurrency', '0']), /positive integer/);
  });
  await test('rejects an unknown flag', () => {
    assert.throws(() => parseArgs(['--bogus']), /unknown option/);
  });
  await test('rejects a flag with no value', () => {
    assert.throws(() => parseArgs(['--seed']), /requires a value/);
  });
  await test('rejects --lock together with --only', () => {
    assert.throws(() => parseArgs(['--lock', 'a', '--only', 'b']), /mutually exclusive/);
  });

  console.log('\nresolveLockedCategories:');
  await test('--lock passes its list through', () => {
    assert.deepStrictEqual(resolveLockedCategories(parseArgs(['--lock', 'hair']), CATEGORIES), ['hair']);
  });
  await test('--only locks everything else', () => {
    assert.deepStrictEqual(
      resolveLockedCategories(parseArgs(['--only', 'pose']), CATEGORIES),
      ['background', 'hair', 'outfit']
    );
  });
  await test('nothing is locked by default', () => {
    assert.deepStrictEqual(resolveLockedCategories(parseArgs([]), CATEGORIES), []);
  });
  await test('rejects an unknown --only category', () => {
    assert.throws(() => resolveLockedCategories(parseArgs(['--only', 'shoes']), CATEGORIES), /unknown categor/);
  });
  await test('rejects an unknown --lock category', () => {
    assert.throws(() => resolveLockedCategories(parseArgs(['--lock', 'shoes']), CATEGORIES), /unknown categor/);
  });

  console.log('\nrunPool:');
  await test('preserves input order in the results', async () => {
    const out = await runPool([3, 1, 2], 2, async value => {
      await new Promise(resolve => setTimeout(resolve, value));
      return value * 10;
    });
    assert.deepStrictEqual(out, [30, 10, 20]);
  });
  await test('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    await runPool([1, 2, 3, 4, 5, 6], 2, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
    });
    assert.strictEqual(peak, 2);
  });

  console.log('\nmain --help / --dry-run:');
  await test('--help prints usage and exits 0', async () => {
    const { value, stdout } = await capture(() => main(['--help']));
    assert.strictEqual(value, 0);
    assert.ok(stdout.includes('--dry-run'));
  });
  await test('--dry-run calls no API and plans the requested count', async () => {
    let called = false;
    const restore = stubFetch(async () => { called = true; });
    try {
      const { value, stdout } = await capture(() => main(['--dry-run', '--json', '-n', '3', '-s', 'dry']));
      assert.strictEqual(value, 0);
      assert.strictEqual(called, false);
      const manifest = JSON.parse(stdout);
      assert.strictEqual(manifest.items.length, 3);
      assert.ok(manifest.items.every(item => item.status === 'planned'));
    } finally {
      restore();
    }
  });
  await test('--dry-run is reproducible for a fixed seed', async () => {
    const first = await capture(() => main(['--dry-run', '--json', '-n', '4', '-s', 'fixed']));
    const second = await capture(() => main(['--dry-run', '--json', '-n', '4', '-s', 'fixed']));
    assert.deepStrictEqual(
      JSON.parse(first.stdout).items.map(item => item.prompt),
      JSON.parse(second.stdout).items.map(item => item.prompt)
    );
  });

  console.log('\nmain end to end:');
  await test('writes one image per variation plus manifest and prompt sheet', async () => {
    const outDir = path.join(tmpDir, 'run-ok');
    const restore = stubFetch(okFetch);
    process.env.XAI_API_KEY = 'test-key';
    try {
      const { value } = await capture(() => main(['-i', refPath, '-n', '3', '-s', 'e2e', '-o', outDir]));
      assert.strictEqual(value, 0);
      const files = fs.readdirSync(outDir);
      assert.strictEqual(files.filter(file => file.endsWith('.png')).length, 3);
      assert.ok(files.includes('manifest.json') && files.includes('prompts.md'));
      const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
      assert.ok(manifest.items.every(item => item.status === 'ok'));
      assert.strictEqual(manifest.referenceCount, 1);
      assert.strictEqual(manifest.seed, 'e2e');
    } finally {
      restore();
    }
  });
  await test('sends the reference image as a data URI to the edit endpoint', async () => {
    const outDir = path.join(tmpDir, 'run-ref');
    let seenUrl = null;
    let seenBody = null;
    const restore = stubFetch(async (url, init) => {
      seenUrl = url;
      seenBody = JSON.parse(init.body);
      return okFetch();
    });
    process.env.XAI_API_KEY = 'test-key';
    try {
      await capture(() => main(['-i', refPath, '-n', '1', '-s', 'ref', '-o', outDir]));
      assert.ok(seenUrl.endsWith('/images/edits'), `unexpected endpoint: ${seenUrl}`);
      assert.strictEqual(seenBody.image.length, 1);
      assert.ok(seenBody.image[0].url.startsWith('data:image/png;base64,'));
    } finally {
      restore();
    }
  });
  await test('a per-image failure is recorded without aborting the run', async () => {
    const outDir = path.join(tmpDir, 'run-partial');
    let calls = 0;
    const restore = stubFetch(async () => {
      calls++;
      if (calls === 2) {
        return { ok: false, status: 400, statusText: 'Bad Request', text: async () => 'rejected prompt' };
      }
      return okFetch();
    });
    process.env.XAI_API_KEY = 'test-key';
    try {
      const { value } = await capture(() => main(['-i', refPath, '-n', '3', '-s', 'part', '-o', outDir, '--concurrency', '1']));
      assert.strictEqual(value, 0);
      const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
      assert.strictEqual(manifest.items.filter(item => item.status === 'ok').length, 2);
      const failure = manifest.items.find(item => item.status === 'failed');
      assert.match(failure.error, /rejected prompt/);
    } finally {
      restore();
    }
  });
  await test('exits 1 when every variation fails', async () => {
    const outDir = path.join(tmpDir, 'run-fail');
    const restore = stubFetch(async () => ({ ok: false, status: 400, statusText: 'Bad', text: async () => 'no' }));
    process.env.XAI_API_KEY = 'test-key';
    try {
      const { value } = await capture(() => main(['-i', refPath, '-n', '2', '-s', 'fail', '-o', outDir]));
      assert.strictEqual(value, 1);
    } finally {
      restore();
    }
  });
  await test('--only keeps the other categories identical across variations', async () => {
    const outDir = path.join(tmpDir, 'run-only');
    const restore = stubFetch(okFetch);
    process.env.XAI_API_KEY = 'test-key';
    try {
      await capture(() => main(['-i', refPath, '-n', '3', '-s', 'only', '-o', outDir, '--only', 'pose']));
      const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
      for (const category of ['hair', 'outfit', 'background']) {
        assert.strictEqual(new Set(manifest.items.map(item => item.picks[category])).size, 1, `${category} varied`);
      }
      assert.deepStrictEqual(manifest.lockedCategories.sort(), ['background', 'hair', 'outfit']);
    } finally {
      restore();
    }
  });
  await test('a missing API key is reported before any request', async () => {
    const restore = stubFetch(async () => { throw new Error('should not be called'); });
    const savedKey = process.env.XAI_API_KEY;
    const savedGrok = process.env.GROK_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.GROK_API_KEY;
    try {
      await assert.rejects(capture(() => main(['-i', refPath, '-n', '1', '-o', path.join(tmpDir, 'run-nokey')])), /XAI_API_KEY/);
    } finally {
      if (savedKey) process.env.XAI_API_KEY = savedKey;
      if (savedGrok) process.env.GROK_API_KEY = savedGrok;
      restore();
    }
  });
  await test('rejects more than five reference images', async () => {
    await assert.rejects(
      capture(() => main([...Array(6)].flatMap(() => ['-i', refPath]).concat(['-n', '1']))),
      /at most 5/
    );
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

run();
