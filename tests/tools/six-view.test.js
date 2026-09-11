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

  if (test('createDefaultConfig ships the six preset sites', () => {
    const config = schema.createDefaultConfig();
    assert.strictEqual(config.sites.length, schema.PANE_COUNT);
    assert.deepStrictEqual(
      config.sites.map((site) => site.name),
      ['Venry', 'えすたま', 'えきちか', 'エステランキング', 'ふーぺ', 'CTI']
    );
  })) passed++; else failed++;

  if (test('normalizeConfig always returns exactly six panes', () => {
    assert.strictEqual(schema.normalizeConfig({}).sites.length, 6);
    assert.strictEqual(schema.normalizeConfig({ sites: [{ name: 'A' }] }).sites.length, 6);
    assert.strictEqual(
      schema.normalizeConfig({ sites: new Array(20).fill({ name: 'X' }) }).sites.length,
      6
    );
    assert.strictEqual(schema.normalizeConfig(null).sites.length, 6);
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

  if (test('paneSlots lays panes out as 3 across, 2 down', () => {
    const slots = schema.paneSlots(schema.createDefaultConfig());
    assert.deepStrictEqual(
      slots.map((slot) => `${slot.row}-${slot.column}`),
      ['1-1', '1-2', '1-3', '2-1', '2-2', '2-3']
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

  if (test('buildAutofillScript carries the auto-submit flag through', () => {
    const withSubmit = autofill.buildAutofillScript(
      { usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#go', autoSubmit: true, delayMs: 100 },
      { username: 'a', password: 'b' }
    );
    assert.ok(withSubmit.includes('"autoSubmit":true'));
    assert.ok(withSubmit.includes('"submitSelector":"#go"'));
  })) passed++; else failed++;

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
