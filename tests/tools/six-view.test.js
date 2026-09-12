/**
 * Tests for tools/six-view (config schema, credential vault, auto-login)
 *
 * Run with: node tests/tools/six-view.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const toolRoot = path.resolve(__dirname, '../../tools/six-view');
const schema = require(path.join(toolRoot, 'src/lib/config-schema'));
const autofill = require(path.join(toolRoot, 'src/lib/autofill'));
const configStore = require(path.join(toolRoot, 'src/lib/config-store'));
const { SecretStore } = require(path.join(toolRoot, 'src/lib/secret-store'));

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

/** Reversible stand-in for Electron's safeStorage (OS keychain). */
function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
    decryptString: (buffer) => {
      const raw = buffer.toString('utf8');
      if (!raw.startsWith('enc:')) throw new Error('bad ciphertext');
      return raw.slice(4);
    },
  };
}

function runTests() {
  console.log('\n=== Testing six-view ===\n');

  let passed = 0;
  let failed = 0;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'six-view-test-'));

  // --- config schema ---

  if (test('createDefaultConfig ships the six preset sites with their URLs', () => {
    const config = schema.createDefaultConfig();
    assert.strictEqual(config.sites.length, schema.DEFAULT_PANE_COUNT);
    assert.deepStrictEqual(
      config.sites.map((site) => site.name),
      ['Venry', 'えすたま', 'えきちか', 'エステランキング', 'ふーぺ', 'CTI']
    );
    assert.deepStrictEqual(
      config.sites.map((site) => site.url),
      [
        'https://mrvenrey.jp/',
        'https://estama.jp/admin/',
        'https://ranking-deli.jp/admin/login',
        'https://www.esthe-ranking.jp/login/',
        'https://www.fuupe.jp/login',
        'https://prime-office-board.onrender.com/',
      ]
    );
  })) passed++; else failed++;

  if (test('the 02 build flavour ships eight accounts plus X, each isolated', () => {
    const brand = schema.getBrand('msns');
    assert.strictEqual(brand.appName, '02View');

    const config = schema.createDefaultConfig('msns');
    assert.strictEqual(config.sites.length, 9);
    assert.strictEqual(
      config.sites.filter((site) => site.url === 'https://m-sns.net/shop/login/').length,
      8
    );
    assert.strictEqual(config.sites[8].url, 'https://x.com/login');

    // Eight panes on one URL only work if every pane has its own session.
    const partitions = new Set(config.sites.map((site) => schema.partitionForSite(site)));
    assert.strictEqual(partitions.size, 9);
  })) passed++; else failed++;

  if (test('an unknown brand falls back to the default app', () => {
    assert.strictEqual(schema.getBrand('nope').id, schema.DEFAULT_BRAND);
    assert.strictEqual(schema.getBrand(undefined).appName, 'SixView');
    assert.strictEqual(schema.createDefaultConfig('nope').sites[0].name, 'Venry');
  })) passed++; else failed++;

  if (test('each flavour starts from its own defaults on first run', () => {
    const dir = path.join(tmpDir, 'brand-msns');
    fs.mkdirSync(dir, { recursive: true });
    const result = configStore.loadConfig(dir, 'msns');
    assert.strictEqual(result.created, true);
    assert.strictEqual(result.config.sites.length, 9);
    assert.strictEqual(result.config.sites[0].name, '02 店舗1');
  })) passed++; else failed++;

  if (test('the shipped example config matches the built-in defaults', () => {
    const example = JSON.parse(fs.readFileSync(path.join(toolRoot, 'sites.example.json'), 'utf8'));
    const normalized = schema.normalizeConfig(example);
    const defaults = schema.createDefaultConfig();
    assert.deepStrictEqual(
      normalized.sites.map((site) => [site.id, site.url]),
      defaults.sites.map((site) => [site.id, site.url])
    );
  })) passed++; else failed++;

  if (test('normalizeConfig keeps the configured pane count within range', () => {
    assert.strictEqual(schema.normalizeConfig({}).sites.length, 6, 'no sites falls back to the defaults');
    assert.strictEqual(schema.normalizeConfig(null).sites.length, 6);
    assert.strictEqual(schema.normalizeConfig({ sites: [] }).sites.length, 6);
    assert.strictEqual(schema.normalizeConfig({ sites: [{ name: 'A' }] }).sites.length, 1);
    assert.strictEqual(schema.normalizeConfig({ sites: new Array(8).fill({ name: 'X' }) }).sites.length, 8);
    assert.strictEqual(
      schema.normalizeConfig({ sites: new Array(20).fill({ name: 'X' }) }).sites.length,
      schema.MAX_PANES
    );
  })) passed++; else failed++;

  if (test('resolveColumns picks a sensible grid and honours an override', () => {
    const withCount = (n, columns) =>
      schema.normalizeConfig({
        layout: { columns },
        sites: new Array(n).fill(0).map((_, i) => ({ name: `P${i}` })),
      });
    assert.strictEqual(schema.resolveColumns(withCount(6)), 3, '6 panes read as 3 x 2');
    assert.strictEqual(schema.resolveColumns(withCount(8)), 4, '8 panes read as 4 x 2');
    assert.strictEqual(schema.resolveColumns(withCount(4)), 2);
    assert.strictEqual(schema.resolveColumns(withCount(8, 2)), 2, 'explicit override wins');
  })) passed++; else failed++;

  if (test('duplicateSite gives the copy its own id, name and session', () => {
    const config = schema.createDefaultConfig();
    const original = config.sites[0];
    const copy = schema.duplicateSite(original, config.sites.map((site) => site.id));
    assert.notStrictEqual(copy.id, original.id);
    assert.strictEqual(copy.url, original.url, 'same site');
    assert.notStrictEqual(
      schema.partitionForSite(copy),
      schema.partitionForSite(original),
      'two accounts on one site must not share a session'
    );
  })) passed++; else failed++;

  if (test('createSite appends a pane with an unused id', () => {
    const config = schema.createDefaultConfig();
    const ids = config.sites.map((site) => site.id);
    const added = schema.createSite(ids);
    assert.ok(!ids.includes(added.id));
    assert.strictEqual(added.url, '');
  })) passed++; else failed++;

  if (test('normalizeConfig gives every pane a unique id', () => {
    const config = schema.normalizeConfig({ sites: new Array(6).fill({ id: 'same', name: 'Same' }) });
    const ids = new Set(config.sites.map((site) => site.id));
    assert.strictEqual(ids.size, 6);
  })) passed++; else failed++;

  if (test('normalizeUrl rejects non-http schemes and adds https://', () => {
    assert.strictEqual(schema.normalizeUrl('javascript:alert(1)'), '');
    assert.strictEqual(schema.normalizeUrl('file:///etc/passwd'), '');
    assert.strictEqual(schema.normalizeUrl('  '), '');
    assert.strictEqual(schema.normalizeUrl('example.co.jp/login'), 'https://example.co.jp/login');
    assert.strictEqual(schema.normalizeUrl('http://example.co.jp/'), 'http://example.co.jp/');
  })) passed++; else failed++;

  if (test('normalizeConfig clamps zoom and delay into range', () => {
    const config = schema.normalizeConfig({
      defaults: { zoomFactor: 99 },
      sites: [
        { name: 'A', zoomFactor: -5, autofill: { delayMs: 999999 } },
        { name: 'B', zoomFactor: 0.05 },
        { name: 'C', zoomFactor: 9 },
      ],
    });
    assert.strictEqual(config.defaults.zoomFactor, 2);
    assert.strictEqual(config.sites[0].zoomFactor, 0, 'a bad override means "use the default"');
    assert.strictEqual(config.sites[1].zoomFactor, 0.25);
    assert.strictEqual(config.sites[2].zoomFactor, 2);
    assert.strictEqual(config.sites[0].autofill.delayMs, 15000);
  })) passed++; else failed++;

  if (test('normalizeConfig keeps the open-at-login preference', () => {
    assert.strictEqual(schema.normalizeConfig({}).startup.openAtLogin, false);
    assert.strictEqual(schema.normalizeConfig({ startup: { openAtLogin: true } }).startup.openAtLogin, true);
    assert.strictEqual(schema.normalizeConfig({ startup: 'yes' }).startup.openAtLogin, false);
  })) passed++; else failed++;

  if (test('partitionForSite separates persistent panes from incognito panes', () => {
    const normal = schema.partitionForSite({ id: 'venry', incognito: false });
    const priv = schema.partitionForSite({ id: 'venry', incognito: true }, 'run1');
    assert.strictEqual(normal, 'persist:sixview-venry');
    assert.ok(!priv.startsWith('persist:'), 'incognito partition must not persist');
    assert.notStrictEqual(normal, priv);
  })) passed++; else failed++;

  if (test('every pane gets its own partition', () => {
    const config = schema.createDefaultConfig();
    const partitions = new Set(config.sites.map((site) => schema.partitionForSite(site)));
    assert.strictEqual(partitions.size, 6);
  })) passed++; else failed++;

  if (test('paneSlots lays panes out row by row', () => {
    assert.deepStrictEqual(
      schema.paneSlots(schema.createDefaultConfig()).map((slot) => `${slot.row}-${slot.column}`),
      ['1-1', '1-2', '1-3', '2-1', '2-2', '2-3']
    );

    const eight = schema.normalizeConfig({
      sites: new Array(8).fill(0).map((_, i) => ({ name: `P${i}` })),
    });
    assert.deepStrictEqual(
      schema.paneSlots(eight).map((slot) => `${slot.row}-${slot.column}`),
      ['1-1', '1-2', '1-3', '1-4', '2-1', '2-2', '2-3', '2-4']
    );
  })) passed++; else failed++;

  if (test('resolveZoomFactor falls back to the global default', () => {
    const config = schema.normalizeConfig({ defaults: { zoomFactor: 0.7 } });
    assert.strictEqual(schema.resolveZoomFactor(config, { zoomFactor: 0 }), 0.7);
    assert.strictEqual(schema.resolveZoomFactor(config, { zoomFactor: 1.25 }), 1.25);
  })) passed++; else failed++;

  // --- config store ---

  if (test('loadConfig returns defaults when no file exists', () => {
    const dir = path.join(tmpDir, 'fresh');
    fs.mkdirSync(dir, { recursive: true });
    const result = configStore.loadConfig(dir);
    assert.strictEqual(result.created, true);
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.config.sites.length, 6);
  })) passed++; else failed++;

  if (test('saveConfig then loadConfig round-trips site settings', () => {
    const dir = path.join(tmpDir, 'roundtrip');
    fs.mkdirSync(dir, { recursive: true });
    const config = schema.createDefaultConfig();
    config.sites[0].url = 'https://venry.example.co.jp/login';
    config.sites[0].autofill.enabled = true;
    config.sites[0].autofill.usernameSelector = '#login_id';
    configStore.saveConfig(dir, config);

    const reloaded = configStore.loadConfig(dir).config;
    assert.strictEqual(reloaded.sites[0].url, 'https://venry.example.co.jp/login');
    assert.strictEqual(reloaded.sites[0].autofill.usernameSelector, '#login_id');
  })) passed++; else failed++;

  if (test('loadConfig recovers from a corrupt config file', () => {
    const dir = path.join(tmpDir, 'corrupt');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configStore.configPath(dir), '{ not json');
    const result = configStore.loadConfig(dir);
    assert.ok(result.error, 'should report the parse failure');
    assert.strictEqual(result.config.sites.length, 6);
  })) passed++; else failed++;

  // --- secret store ---

  if (test('SecretStore round-trips a credential through safeStorage', () => {
    const dir = path.join(tmpDir, 'secrets');
    const store = new SecretStore(dir, fakeSafeStorage());
    assert.strictEqual(store.set('venry', 'yuna', 'pw-123'), true);
    assert.deepStrictEqual(store.get('venry'), { username: 'yuna', password: 'pw-123' });
    assert.strictEqual(store.has('venry'), true);
  })) passed++; else failed++;

  if (test('SecretStore never writes the password in clear text', () => {
    const dir = path.join(tmpDir, 'secrets-plain');
    const store = new SecretStore(dir, fakeSafeStorage());
    store.set('cti', 'operator', 'super-secret-pw');
    const onDisk = fs.readFileSync(path.join(dir, 'credentials.json'), 'utf8');
    assert.ok(!onDisk.includes('super-secret-pw'), 'password must not appear in the file');
  })) passed++; else failed++;

  if (test('SecretStore refuses to store when encryption is unavailable', () => {
    const dir = path.join(tmpDir, 'secrets-unavailable');
    const store = new SecretStore(dir, fakeSafeStorage(false));
    assert.strictEqual(store.isAvailable(), false);
    assert.strictEqual(store.set('venry', 'yuna', 'pw'), false);
    assert.strictEqual(store.get('venry'), null);
  })) passed++; else failed++;

  if (test('SecretStore status and clear behave per site', () => {
    const dir = path.join(tmpDir, 'secrets-status');
    const store = new SecretStore(dir, fakeSafeStorage());
    store.set('venry', 'a', 'b');
    assert.deepStrictEqual(store.status(['venry', 'cti']), { venry: true, cti: false });
    assert.strictEqual(store.clear('venry'), true);
    assert.strictEqual(store.clear('venry'), false);
    assert.deepStrictEqual(store.status(['venry']), { venry: false });
  })) passed++; else failed++;

  // --- autofill ---

  if (test('matchesUrlPattern supports substrings, regex and the empty pattern', () => {
    assert.strictEqual(autofill.matchesUrlPattern('login', 'https://x.jp/LOGIN?a=1'), true);
    assert.strictEqual(autofill.matchesUrlPattern('login', 'https://x.jp/home'), false);
    assert.strictEqual(autofill.matchesUrlPattern('/\\/auth$/i', 'https://x.jp/auth'), true);
    assert.strictEqual(autofill.matchesUrlPattern('/[/', 'https://x.jp/auth'), false);
    // A path pattern must not be mistaken for a regex literal (its trailing
    // segment is not a valid flag list), or auto-login would never fire.
    assert.strictEqual(
      autofill.matchesUrlPattern('/admin/login', 'https://ranking-deli.jp/admin/login'),
      true
    );
    assert.strictEqual(autofill.matchesUrlPattern('/admin/login', 'https://ranking-deli.jp/home'), false);
    assert.strictEqual(autofill.matchesUrlPattern('/i/flow/login', 'https://x.com/i/flow/login'), true);
    assert.strictEqual(autofill.matchesUrlPattern('', 'https://x.jp/anything'), true);
    assert.strictEqual(autofill.matchesUrlPattern('', 'about:blank'), false);
  })) passed++; else failed++;

  if (test('shouldAutofill requires enablement, credentials and a selector', () => {
    const site = {
      autofill: { enabled: true, urlPattern: 'login', usernameSelector: '#u', passwordSelector: '#p' },
    };
    const creds = { username: 'yuna', password: 'pw' };
    assert.strictEqual(autofill.shouldAutofill(site, 'https://x.jp/login', creds), true);
    assert.strictEqual(autofill.shouldAutofill(site, 'https://x.jp/home', creds), false);
    assert.strictEqual(autofill.shouldAutofill(site, 'https://x.jp/login', null), false);
    assert.strictEqual(
      autofill.shouldAutofill({ autofill: { ...site.autofill, enabled: false } }, 'https://x.jp/login', creds),
      false
    );
    assert.strictEqual(
      autofill.shouldAutofill(
        { autofill: { enabled: true, urlPattern: '', usernameSelector: '', passwordSelector: '' } },
        'https://x.jp/login',
        creds
      ),
      false
    );
  })) passed++; else failed++;

  if (test('buildAutofillScript escapes credentials safely', () => {
    const script = autofill.buildAutofillScript(
      { usernameSelector: '#u', passwordSelector: '#p', autoSubmit: false, delayMs: 0 },
      { username: 'yuna', password: '</script>"\\\n' }
    );
    assert.ok(!script.includes('</script>'), 'must not emit a raw closing script tag');
    assert.doesNotThrow(() => new Function(`return ${script}`), 'generated script must parse');
  })) passed++; else failed++;

  if (test('jsLiteral escapes line separators that break JS parsing', () => {
    const lineSeparator = String.fromCharCode(0x2028);
    const literal = autofill.jsLiteral(`a${lineSeparator}b`);
    assert.ok(!literal.includes(lineSeparator));
    assert.strictEqual(JSON.parse(literal.replace(/\\u2028/g, lineSeparator)), `a${lineSeparator}b`);
  })) passed++; else failed++;

  if (test('buildAutofillScript handles two-step sign-ins', () => {
    const script = autofill.buildAutofillScript(
      { usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#next', autoSubmit: true, delayMs: 0 },
      { username: 'a', password: 'b' }
    );
    assert.doesNotThrow(() => new Function(`return ${script}`));
    assert.ok(script.includes('twoStep'), 'reports whether a second step was used');
    assert.ok(script.includes('no-password-step'), 'reports when the password step never appears');
  })) passed++; else failed++;

  if (test('buildAutofillScript carries the auto-submit flag through', () => {
    const withSubmit = autofill.buildAutofillScript(
      { usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#go', autoSubmit: true, delayMs: 100 },
      { username: 'a', password: 'b' }
    );
    assert.ok(withSubmit.includes('"autoSubmit":true'));
    assert.ok(withSubmit.includes('"submitSelector":"#go"'));
  })) passed++; else failed++;

  // --- login field detection ---

  if (test('buildDetectScript produces a parseable, self-contained probe', () => {
    const script = autofill.buildDetectScript();
    assert.doesNotThrow(() => new Function(`return ${script}`), 'detect script must parse');
    assert.ok(script.includes('input[type="password"]'), 'must look for a password field');
    assert.ok(script.includes('twoStep'), 'reports ID-only first steps so the user can detect twice');
    assert.ok(!script.includes('require('), 'must not depend on anything in the page');
  })) passed++; else failed++;

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
