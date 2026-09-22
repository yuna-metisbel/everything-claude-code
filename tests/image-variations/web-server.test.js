'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const server = require('../../scripts/image-variations/web/server');
const { resolveStaticPath, contentTypeFor } = require('../../scripts/image-variations/web/static');

console.log('=== Testing image-variations/web/server.js ===\n');

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

const presetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-srv-'));
fs.writeFileSync(path.join(presetsDir, 'tiny.json'), JSON.stringify({
  template: '{pose}',
  categories: { pose: ['standing', 'sitting'] }
}));

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'scripts', 'image-variations', 'web', 'public');

/**
 * Start a server on an ephemeral port and hand the caller a base URL.
 */
function withServer(options, run) {
  const instance = server.createServer({ presetsDir, ...options });
  return new Promise((resolve, reject) => {
    instance.listen(0, '127.0.0.1', async () => {
      const base = `http://127.0.0.1:${instance.address().port}`;
      try {
        await run(base);
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        instance.close();
      }
    });
    instance.on('error', reject);
  });
}

async function run() {
  console.log('argument parsing:');

  await test('defaults to loopback on the documented port', () => {
    const options = server.parseServerArgs([]);
    assert.strictEqual(options.host, '127.0.0.1');
    assert.strictEqual(options.port, 8787);
  });
  await test('accepts --port and --host', () => {
    const options = server.parseServerArgs(['--port', '9000', '--host', '0.0.0.0']);
    assert.strictEqual(options.port, 9000);
    assert.strictEqual(options.host, '0.0.0.0');
  });
  await test('rejects a port outside the valid range', () => {
    assert.throws(() => server.parseServerArgs(['--port', '70000']), /between 1 and 65535/);
  });
  await test('rejects a non-numeric port', () => {
    assert.throws(() => server.parseServerArgs(['--port', 'abc']), /between 1 and 65535/);
  });
  await test('accepts --no-qr', () => {
    assert.strictEqual(server.parseServerArgs([]).qr, true);
    assert.strictEqual(server.parseServerArgs(['--no-qr']).qr, false);
  });
  await test('rejects an unknown option', () => {
    assert.throws(() => server.parseServerArgs(['--nope']), /unknown option/);
  });
  await test('rejects an option with no value', () => {
    assert.throws(() => server.parseServerArgs(['--host']), /needs a value/);
  });

  console.log('\nstatic path resolution:');

  await test('maps / to index.html', () => {
    assert.strictEqual(resolveStaticPath('/srv', '/'), path.resolve('/srv/index.html'));
  });
  await test('blocks a traversal with ..', () => {
    assert.strictEqual(resolveStaticPath('/srv', '/../../etc/passwd'), null);
  });
  await test('blocks a percent-encoded traversal', () => {
    assert.strictEqual(resolveStaticPath('/srv', '/%2e%2e/%2e%2e/etc/passwd'), null);
  });
  await test('blocks a NUL byte in the path', () => {
    assert.strictEqual(resolveStaticPath('/srv', '/index.html%00.png'), null);
  });
  await test('survives an undecodable path', () => {
    assert.strictEqual(resolveStaticPath('/srv', '/%zz'), null);
  });
  await test('serves the manifest with the manifest media type', () => {
    assert.match(contentTypeFor('/x/manifest.webmanifest'), /application\/manifest\+json/);
  });

  console.log('\nbanner:');

  await test('warns when no API key is present', () => {
    const text = server.banner({ host: '127.0.0.1', port: 8787, token: '', apiKey: '' });
    assert.match(text, /XAI_API_KEY is not set/);
  });
  await test('mentions the secure-context limit when bound beyond loopback', () => {
    const text = server.banner({ host: '0.0.0.0', port: 8787, token: 'tok', apiKey: 'k' });
    assert.match(text, /secure context/);
    assert.match(text, /\?t=tok/);
  });
  await test('prints the address another device would actually type', () => {
    const text = server.banner({
      host: '0.0.0.0', port: 8787, token: 'tok', apiKey: 'k',
      addresses: ['192.168.1.23'], qrCode: false
    });
    assert.match(text, /http:\/\/192\.168\.1\.23:8787\/\?t=tok/);
    assert.match(text, /http:\/\/127\.0\.0\.1:8787/, 'loopback still works on this machine');
  });
  await test('draws a QR code for the LAN address by default', () => {
    const text = server.banner({
      host: '0.0.0.0', port: 8787, token: 'tok', apiKey: 'k',
      addresses: ['192.168.1.23'], columns: 120
    });
    assert.match(text, /scan from a phone/);
    assert.match(text, new RegExp(`${String.fromCharCode(27)}\\[40m`), 'the QR code should be drawn');
  });
  await test('falls back to the narrow drawing rather than wrapping', () => {
    const wide = server.banner({
      host: '0.0.0.0', port: 8787, token: 'tok', apiKey: 'k',
      addresses: ['192.168.1.23'], columns: 120
    });
    const narrow = server.banner({
      host: '0.0.0.0', port: 8787, token: 'tok', apiKey: 'k',
      addresses: ['192.168.1.23'], columns: 60
    });
    assert.ok(!/[\u2580\u2584\u2588]/.test(wide), 'a wide window gets the block drawing');
    assert.match(narrow, /[\u2580\u2584\u2588]/, 'a narrow window gets the compact drawing');
    assert.match(narrow, /widen it past/, 'and is told why');
  });
  await test('a token stays short enough for a QR code that fits 80 columns', () => {
    const token = require('crypto').randomBytes(server.TOKEN_BYTES).toString('base64url');
    const url = `http://192.168.100.100:8787/?t=${token}`;
    assert.ok(
      require('../../scripts/image-variations/web/qr').renderedWidth(url) <= 80,
      `a ${token.length}-character token pushes the QR code past 80 columns`
    );
  });
  await test('omits the QR code when asked', () => {
    const text = server.banner({
      host: '0.0.0.0', port: 8787, token: 'tok', apiKey: 'k',
      addresses: ['192.168.1.23'], qrCode: false
    });
    assert.ok(!/scan from a phone/.test(text));
    assert.ok(!new RegExp(`${String.fromCharCode(27)}\\[40m`).test(text));
  });
  await test('says so when the machine has no network address', () => {
    const text = server.banner({
      host: '0.0.0.0', port: 8787, token: 'tok', apiKey: 'k', addresses: []
    });
    assert.match(text, /no non-loopback address found/);
  });
  await test('never draws a QR code on loopback', () => {
    const text = server.banner({ host: '127.0.0.1', port: 8787, token: '', apiKey: 'k' });
    assert.ok(!/scan from a phone/.test(text));
    assert.ok(!new RegExp(`${String.fromCharCode(27)}\\[40m`).test(text));
  });

  console.log('\nreachable addresses:');

  await test('keeps only external IPv4 addresses', () => {
    const found = server.lanAddresses({
      lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      en0: [
        { family: 'IPv4', address: '192.168.1.23', internal: false },
        { family: 'IPv6', address: 'fe80::1', internal: false }
      ]
    });
    assert.deepStrictEqual(found, ['192.168.1.23']);
  });
  await test('accepts the numeric family Node now reports', () => {
    const found = server.lanAddresses({ en0: [{ family: 4, address: '10.0.0.7', internal: false }] });
    assert.deepStrictEqual(found, ['10.0.0.7']);
  });
  await test('survives an interface with no entries', () => {
    assert.deepStrictEqual(server.lanAddresses({ utun0: null }), []);
  });
  await test('expands the wildcard bind into usable addresses', () => {
    assert.deepStrictEqual(
      server.reachableUrls({ host: '0.0.0.0', port: 8787, token: 't', addresses: ['192.168.1.23'] }),
      ['http://127.0.0.1:8787/?t=t', 'http://192.168.1.23:8787/?t=t']
    );
  });
  await test('leaves a specific bind alone and omits an absent token', () => {
    assert.deepStrictEqual(
      server.reachableUrls({ host: '127.0.0.1', port: 9000, token: '', addresses: ['192.168.1.23'] }),
      ['http://127.0.0.1:9000/']
    );
  });
  await test('stays quiet about tokens on loopback', () => {
    const text = server.banner({ host: '127.0.0.1', port: 8787, token: '', apiKey: 'k' });
    assert.ok(!text.includes('token'), 'loopback should not mention a token');
  });

  console.log('\nserving the app shell:');

  await test('serves index.html at the root', () => withServer({}, async base => {
    const response = await fetch(`${base}/`);
    assert.strictEqual(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /Image Variations/);
  }));
  await test('serves the manifest and the module scripts', () => withServer({}, async base => {
    for (const asset of ['manifest.webmanifest', 'app.js', 'net.js', 'db.js', 'i18n.js', 'styles.css', 'sw.js']) {
      const response = await fetch(`${base}/${asset}`);
      assert.strictEqual(response.status, 200, `${asset} should be served`);
    }
  }));
  await test('serves every icon the manifest names', () => withServer({}, async base => {
    const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json();
    for (const icon of manifest.icons) {
      const response = await fetch(`${base}/${icon.src}`);
      assert.strictEqual(response.status, 200, `${icon.src} should be served`);
      assert.strictEqual(response.headers.get('content-type'), 'image/png');
    }
  }));
  await test('404s a missing asset', () => withServer({}, async base => {
    assert.strictEqual((await fetch(`${base}/nope.js`)).status, 404);
  }));
  await test('does not serve files outside public/', () => withServer({}, async base => {
    const response = await fetch(`${base}/../api.js`);
    assert.ok(response.status === 404 || !(await response.text()).includes('handleApiRequest'));
  }));
  await test('never caches the service worker', () => withServer({}, async base => {
    const response = await fetch(`${base}/sw.js`);
    assert.strictEqual(response.headers.get('cache-control'), 'no-cache');
  }));

  console.log('\nAPI over HTTP:');

  await test('answers /api/presets', () => withServer({ apiKey: 'k' }, async base => {
    const payload = await (await fetch(`${base}/api/presets`)).json();
    assert.deepStrictEqual(payload.presets, [{ id: 'tiny', title: 'tiny' }]);
    assert.strictEqual(payload.hasApiKey, true);
  }));
  await test('plans over POST', () => withServer({}, async base => {
    const response = await fetch(`${base}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'tiny', count: 2, seed: 'z' })
    });
    const payload = await response.json();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(payload.items.length, 2);
  }));
  await test('returns the error as JSON with the right status', () => withServer({}, async base => {
    const response = await fetch(`${base}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'tiny', count: 0 })
    });
    assert.strictEqual(response.status, 400);
    assert.match((await response.json()).error, /count must be an integer/);
  }));
  await test('400s a malformed JSON body', () => withServer({}, async base => {
    const response = await fetch(`${base}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json'
    });
    assert.strictEqual(response.status, 400);
    assert.match((await response.json()).error, /invalid JSON/);
  }));
  await test('404s an unknown API path', () => withServer({}, async base => {
    assert.strictEqual((await fetch(`${base}/api/nope`)).status, 404);
  }));
  await test('generates through the stubbed upstream', () => withServer({
    apiKey: 'k',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'QUJD' }] }) })
  }, async base => {
    const response = await fetch(`${base}/api/generate-one`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'tiny', prompt: 'standing' })
    });
    assert.strictEqual((await response.json()).image.value, 'QUJD');
  }));

  console.log('\naccess token:');

  await test('rejects an API call with no token when one is set', () => withServer({ token: 'secret' }, async base => {
    const response = await fetch(`${base}/api/presets`);
    assert.strictEqual(response.status, 401);
  }));
  await test('rejects a wrong token', () => withServer({ token: 'secret' }, async base => {
    const response = await fetch(`${base}/api/presets`, { headers: { 'x-ecc-token': 'nope' } });
    assert.strictEqual(response.status, 401);
  }));
  await test('accepts the right token', () => withServer({ token: 'secret' }, async base => {
    const response = await fetch(`${base}/api/presets`, { headers: { 'x-ecc-token': 'secret' } });
    assert.strictEqual(response.status, 200);
  }));
  await test('leaves the app shell reachable without a token', () => withServer({ token: 'secret' }, async base => {
    assert.strictEqual((await fetch(`${base}/`)).status, 200);
  }));

  fs.rmSync(presetsDir, { recursive: true, force: true });
  assert.ok(fs.existsSync(PUBLIC_DIR), 'the public directory must ship with the tool');

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

run();
