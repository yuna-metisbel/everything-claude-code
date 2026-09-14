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
const dmScript = require(path.join(toolRoot, 'src/lib/dm-script'));
const { DmBridge } = require(path.join(toolRoot, 'src/lib/dm-bridge'));
const telegramLib = require(path.join(toolRoot, 'src/lib/telegram'));
const { DmService } = require(path.join(toolRoot, 'src/dm-service'));

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

/** Same reporting as `test`, for cases that have to await something. */
async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

/**
 * A guest page stand-in.
 *
 * Answers each generated script the way a real page would, and records what was
 * asked of it. `rows` is a function so a test can change the list between
 * scans, the way the site does after a reply is posted.
 */
function fakeContents(options = {}) {
  const rowsFor = typeof options.rows === 'function' ? options.rows : () => options.rows || [];
  return {
    ran: [],
    opened: [],
    typed: [],
    isDestroyed: () => false,
    focus() {},
    // settle() listens for this; answer at once so tests do not wait 2s.
    once(event, callback) {
      if (event === 'did-stop-loading') setImmediate(callback);
    },
    removeListener() {},
    executeJavaScript(source) {
      this.ran.push(source);

      if (source.includes('alreadyThere')) return Promise.resolve({ ok: true, alreadyThere: true });

      if (source.includes('maxRows')) {
        const rows = rowsFor();
        return Promise.resolve(
          rows.length ? { ok: true, rows, path: '/dm' } : { ok: false, reason: 'no-rows', rows: [] }
        );
      }

      if (source.includes('thread-not-found')) {
        const key = (/"key":"([^"]*)"|WANTED = "([^"]*)"/.exec(source) || [])
          .slice(1)
          .find(Boolean);
        this.opened.push(key || '');
        if (options.openFails) return Promise.resolve({ ok: false, reason: 'thread-not-found' });
        return Promise.resolve({ ok: true, opened: true });
      }

      if (source.includes('empty-text')) {
        const text = (/const TEXT = "((?:[^"\\]|\\.)*)"/.exec(source) || [])[1] || '';
        this.typed.push(JSON.parse(`"${text}"`));
        if (options.onType) options.onType(JSON.parse(`"${text}"`));
        return Promise.resolve({ ok: true, submitted: true });
      }

      return Promise.resolve({ ok: false, reason: 'unknown-script' });
    },
  };
}

/** A fetch stand-in that answers the Telegram API from a table. */
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    const result = handler(url, body);
    return { status: 200, json: async () => result };
  };
  impl.calls = calls;
  return impl;
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

async function runTests() {
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

  if (test('the 02 build flavour ships one shop and seven cast panes plus X', () => {
    const brand = schema.getBrand('msns');
    assert.strictEqual(brand.appName, '02View');

    const config = schema.createDefaultConfig('msns');
    assert.strictEqual(config.sites.length, 9);
    assert.strictEqual(
      config.sites.filter((site) => site.url === 'https://m-sns.net/shop/login/').length,
      1
    );
    assert.strictEqual(
      config.sites.filter((site) => site.url === 'https://m-sns.net/cast/login/').length,
      7
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
    assert.strictEqual(result.config.sites[0].name, '02 店舗');
    assert.strictEqual(result.config.sites[1].name, '02 キャスト1');
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

  if (test('shouldAutofill needs enablement and credentials - selectors are optional', () => {
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
    // No selectors at all still tries: the script finds the boxes by the shape
    // of the page, so saving an ID and password is the whole setup.
    assert.strictEqual(
      autofill.shouldAutofill(
        { autofill: { enabled: true, urlPattern: '', usernameSelector: '', passwordSelector: '' } },
        'https://x.jp/login',
        creds
      ),
      true
    );
  })) passed++; else failed++;

  if (test('a pane with nothing configured still produces a usable script', () => {
    const script = autofill.buildAutofillScript({}, { username: 'yuna', password: 'pw' });
    assert.doesNotThrow(() => new Function(`return ${script}`), 'must parse with no selectors');
    assert.ok(script.includes('findByShape'), 'falls back to the shape of the form');
    assert.ok(script.includes("'password'"), 'anchors on the password box');
    assert.ok(!script.includes('require('), 'must not depend on anything in the page');
  })) passed++; else failed++;

  if (test('auto-login is on by default, so a saved credential is enough', () => {
    const config = schema.createDefaultConfig('msns');
    assert.ok(
      config.sites.every((site) => site.autofill.enabled === true),
      'every shipped pane is ready to auto-login once a credential is saved'
    );
    // It cannot act on its own: no credential, no attempt.
    assert.strictEqual(autofill.shouldAutofill(config.sites[1], config.sites[1].url, null), false);
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


  // --- DM bridge: config ---

  if (test('normalizeDm keeps the polling interval civil', () => {
    assert.strictEqual(schema.normalizeDm({ intervalSeconds: 1 }).intervalSeconds, 20);
    assert.strictEqual(schema.normalizeDm({ intervalSeconds: 999999 }).intervalSeconds, 3600);
    assert.strictEqual(schema.normalizeDm({}).intervalSeconds, 90);
  })) passed++; else failed++;

  if (test('a pane is only watched once the row selector is picked', () => {
    assert.strictEqual(schema.dmIsUsable({ dm: { enabled: true, rowSelector: '' } }), false);
    assert.strictEqual(schema.dmIsUsable({ dm: { enabled: false, rowSelector: '.row' } }), false);
    assert.strictEqual(schema.dmIsUsable({ dm: { enabled: true, rowSelector: '.row' } }), true);
    // Replying additionally needs somewhere to type.
    assert.strictEqual(schema.dmCanSend({ dm: { enabled: true, rowSelector: '.row' } }), false);
    assert.strictEqual(
      schema.dmCanSend({ dm: { enabled: true, rowSelector: '.row', inputSelector: '#t' } }),
      true
    );
  })) passed++; else failed++;

  if (test('the telegram block survives a config round trip', () => {
    const config = schema.createDefaultConfig('msns');
    config.telegram.enabled = true;
    config.telegram.chatId = '12345';
    config.telegram.pollSeconds = 999;
    const back = schema.normalizeConfig(config, 'msns');
    assert.strictEqual(back.telegram.enabled, true);
    assert.strictEqual(back.telegram.chatId, '12345');
    assert.strictEqual(back.telegram.pollSeconds, 120, 'long polls are capped');
    assert.strictEqual(back.telegram.confirmBeforeSend, true, 'confirmation defaults to on');
  })) passed++; else failed++;

  if (test('every pane gets a dm block, and the token is not one of them', () => {
    const config = schema.createDefaultConfig('msns');
    assert.ok(config.sites.every((site) => site.dm && site.dm.enabled === false));
    assert.ok(!JSON.stringify(config).includes(schema.TELEGRAM_SECRET_ID));
  })) passed++; else failed++;

  // --- DM bridge: what counts as news ---

  if (test('the first scan of a pane primes silently', () => {
    const bridge = new DmBridge();
    const rows = [
      { key: 'href:/dm/1', name: 'A', preview: 'hello', unread: true },
      { key: 'href:/dm/2', name: 'B', preview: 'hi', unread: true },
    ];
    const first = bridge.diff('cast1', rows);
    assert.strictEqual(first.primed, true);
    assert.strictEqual(first.notify.length, 0, 'history must not arrive as notifications');
    assert.strictEqual(bridge.diff('cast1', rows).notify.length, 0, 'nothing changed');
  })) passed++; else failed++;

  if (test('a changed preview is reported, an unchanged row is not', () => {
    const bridge = new DmBridge();
    bridge.diff('cast1', [{ key: 'k1', name: 'A', preview: 'one', unread: false }]);
    const changed = bridge.diff('cast1', [{ key: 'k1', name: 'A', preview: 'two', unread: false }]);
    assert.strictEqual(changed.notify.length, 1);
    assert.strictEqual(changed.notify[0].preview, 'two');
  })) passed++; else failed++;

  if (test('our own reply does not bounce back out as a notification', () => {
    const bridge = new DmBridge();
    bridge.diff('cast1', [{ key: 'k1', name: 'A', preview: 'question', unread: true }]);
    bridge.suppressNext('cast1', 'k1');
    const echo = bridge.diff('cast1', [{ key: 'k1', name: 'A', preview: 'my answer', unread: false }]);
    assert.strictEqual(echo.notify.length, 0, 'the echo of our own send is swallowed');
    const next = bridge.diff('cast1', [{ key: 'k1', name: 'A', preview: 'thanks!', unread: true }]);
    assert.strictEqual(next.notify.length, 1, 'only once - the next real message still reports');
  })) passed++; else failed++;

  if (test('a pane switched off forgets its baseline', () => {
    const bridge = new DmBridge();
    bridge.diff('cast1', [{ key: 'k1', name: 'A', preview: 'x', unread: false }]);
    assert.strictEqual(bridge.hasBaseline('cast1'), true);
    bridge.forget('cast1');
    assert.strictEqual(bridge.hasBaseline('cast1'), false);
  })) passed++; else failed++;

  // --- DM bridge: routing replies ---

  if (test('only a reply to one of our notifications is ever sent on', () => {
    const bridge = new DmBridge();
    bridge.rememberRoute(500, 'cast3', { key: 'href:/dm/9', name: 'tanaka' });

    const routed = bridge.resolveReply({
      message: { text: '19時から空いてます', message_id: 501, chat: { id: 77 }, reply_to_message: { message_id: 500 } },
    });
    assert.strictEqual(routed.siteId, 'cast3');
    assert.strictEqual(routed.key, 'href:/dm/9');
    assert.strictEqual(routed.text, '19時から空いてます');

    // A bare message, a reply to something unknown, and an empty reply are all
    // refused: guessing the recipient would mean messaging the wrong customer.
    assert.strictEqual(bridge.resolveReply({ message: { text: 'hi', chat: { id: 77 } } }), null);
    assert.strictEqual(
      bridge.resolveReply({ message: { text: 'hi', reply_to_message: { message_id: 999 } } }),
      null
    );
    assert.strictEqual(
      bridge.resolveReply({ message: { text: '   ', reply_to_message: { message_id: 500 } } }),
      null
    );
  })) passed++; else failed++;

  if (test('the route table is bounded, dropping the oldest first', () => {
    const bridge = new DmBridge({ maxRoutes: 2 });
    bridge.rememberRoute(1, 's', { key: 'a' });
    bridge.rememberRoute(2, 's', { key: 'b' });
    bridge.rememberRoute(3, 's', { key: 'c' });
    assert.strictEqual(bridge.routes.size, 2);
    assert.ok(!bridge.routes.has(1), 'the oldest route is evicted');
    assert.ok(bridge.routes.has(3));
  })) passed++; else failed++;

  if (test('a notification names the account and the sender', () => {
    const bridge = new DmBridge();
    const text = bridge.formatNotification('02 キャスト1', { name: 'たなか', preview: '明日は？' });
    assert.ok(text.includes('02 キャスト1'), 'which account');
    assert.ok(text.includes('たなか'), 'which customer');
    assert.ok(text.includes('明日は？'), 'what they said');
    assert.ok(bridge.formatNotification('x', { name: '', preview: '' }).includes('(名前なし)'));
  })) passed++; else failed++;

  // --- generated page scripts ---

  if (test('the picker script parses and can always be escaped out of', () => {
    const script = dmScript.buildPickerScript({ label: 'click the row', relativeTo: '.row' });
    assert.doesNotThrow(() => new Function(`return ${script}`), 'picker script must parse');
    assert.ok(script.includes('Escape'), 'Esc must cancel');
    assert.ok(script.includes('"click the row"'));
    assert.ok(!script.includes('require('), 'must not depend on anything in the page');
  })) passed++; else failed++;

  if (test('the scan script only reads - it can never be cut short by a click', () => {
    const script = dmScript.buildDmScanScript({
      rowSelector: '.dm-row',
      nameSelector: '.name',
      previewSelector: '.msg',
      unreadSelector: '.badge',
    });
    assert.doesNotThrow(() => new Function(`return ${script}`), 'scan script must parse');
    assert.ok(script.includes('"rowSelector":".dm-row"'));
    assert.ok(!script.includes('.click()'), 'reading must not navigate');
    assert.ok(!script.includes('require('));
  })) passed++; else failed++;

  if (test('scripts that click end on the click, because it navigates away', () => {
    const ensure = dmScript.buildDmEnsureListScript({ rowSelector: '.r', openSelector: '#dm-tab' });
    const open = dmScript.buildDmOpenThreadScript({ rowSelector: '.r' }, 'href:/dm/9');
    [ensure, open].forEach((script) => {
      assert.doesNotThrow(() => new Function(`return ${script}`));
      const afterClick = script.slice(script.lastIndexOf('.click()'));
      assert.ok(!afterClick.includes('await'), 'nothing may be awaited after the click');
    });
    assert.ok(ensure.includes('"openSelector":"#dm-tab"'));
    assert.ok(open.includes('thread-not-found'), 'a vanished thread is reported, not guessed at');
    assert.ok(open.includes('href:/dm/9'));
  })) passed++; else failed++;

  if (test('the reply text cannot break out of the script it travels in', () => {
    const script = dmScript.buildDmTypeScript(
      { inputSelector: '#reply', sendSelector: '#send' },
      '</script><script>alert(1)</script>'
    );
    assert.doesNotThrow(() => new Function(`return ${script}`), 'type script must parse');
    assert.ok(!script.includes('</script>'), 'the reply text is escaped');
    assert.ok(script.includes('"inputSelector":"#reply"'));
  })) passed++; else failed++;

  // --- telegram client ---

  if (test('a bot token is recognised, and never printed in full', () => {
    const token = `123456789:${'A'.repeat(35)}`;
    assert.strictEqual(telegramLib.looksLikeToken(token), true);
    assert.strictEqual(telegramLib.looksLikeToken('not-a-token'), false);
    assert.strictEqual(telegramLib.looksLikeToken(''), false);
    const masked = telegramLib.maskToken(token);
    assert.ok(!masked.includes('A'.repeat(10)), 'the secret half must not survive masking');
    assert.ok(masked.length < token.length);
  })) passed++; else failed++;

  if (await testAsync('an unconfigured client refuses to call out', async () => {
    const client = new telegramLib.TelegramClient({ token: 'nope', fetchImpl: fakeFetch(() => ({ ok: true })) });
    const res = await client.sendMessage('1', 'hi');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error, 'not-configured');
  })) passed++; else failed++;

  if (await testAsync('sendMessage posts to the bot endpoint and returns the message id', async () => {
    const token = `123456789:${'A'.repeat(35)}`;
    const impl = fakeFetch(() => ({ ok: true, result: { message_id: 42, chat: { id: 7 } } }));
    const client = new telegramLib.TelegramClient({ token, fetchImpl: impl });
    const res = await client.sendMessage(7, 'hello', { replyToMessageId: 41 });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.messageId, 42);
    assert.ok(impl.calls[0].url.endsWith('/sendMessage'));
    assert.ok(impl.calls[0].url.includes(token), 'the token authenticates the call');
    assert.strictEqual(impl.calls[0].body.reply_to_message_id, 41);
  })) passed++; else failed++;

  if (await testAsync('getUpdates advances the offset so nothing is handled twice', async () => {
    const token = `123456789:${'A'.repeat(35)}`;
    const impl = fakeFetch((_url, body) =>
      body.offset === undefined
        ? { ok: true, result: [{ update_id: 10 }, { update_id: 11 }] }
        : { ok: true, result: [] }
    );
    const client = new telegramLib.TelegramClient({ token, fetchImpl: impl });
    const first = await client.getUpdates({ timeoutSeconds: 0 });
    assert.strictEqual(first.updates.length, 2);
    assert.strictEqual(client.offset, 12);
    await client.getUpdates({ timeoutSeconds: 0 });
    assert.strictEqual(impl.calls[1].body.offset, 12, 'the next poll asks for what comes after');
  })) passed++; else failed++;

  // --- the service end to end (with fake page + fake Telegram) ---

  if (await testAsync('a new message reaches Telegram and its reply reaches the right pane', async () => {
    const token = `123456789:${'A'.repeat(35)}`;
    const site = {
      id: 'cast1',
      name: '02 キャスト1',
      dm: {
        enabled: true,
        rowSelector: '.dm-row',
        nameSelector: '.name',
        previewSelector: '.msg',
        openSelector: '#dm-tab',
        inputSelector: '#reply',
        sendSelector: '#send',
        intervalSeconds: 90,
      },
    };
    const config = { telegram: { enabled: true, chatId: '77', pollSeconds: 5, confirmBeforeSend: false }, sites: [site] };

    // The list the fake page shows; the reply rewrites it, as the real one does.
    let rows = [
      { key: 'href:/dm/9', name: 'たなか', preview: '明日は？', unread: true },
      { key: 'href:/dm/12', name: '海斗', preview: 'こんばんは', unread: false },
    ];
    const contents = fakeContents({
      rows: () => rows,
      onType: (text) => {
        rows = rows.map((row) => (row.key === 'href:/dm/9' ? { ...row, preview: text, unread: false } : row));
      },
    });

    let nextMessageId = 100;
    const impl = fakeFetch((url) =>
      url.endsWith('/sendMessage')
        ? { ok: true, result: { message_id: (nextMessageId += 1), chat: { id: 77 } } }
        : { ok: true, result: [] }
    );

    const service = new DmService({
      getConfig: () => config,
      getSite: (id) => (id === site.id ? site : null),
      getContents: () => contents,
      getToken: () => token,
    });
    service.client.fetchImpl = impl;
    service.client.token = token;

    // First scan is the baseline; the second one is real news.
    const primed = await service.scan('cast1');
    assert.strictEqual(primed.primed, true);
    assert.strictEqual(impl.calls.length, 0, 'priming must not notify');

    rows = rows.map((row) => (row.key === 'href:/dm/9' ? { ...row, preview: '90いくら？' } : row));
    const news = await service.scan('cast1');
    assert.strictEqual(news.notified, 1, 'only the changed conversation is reported');
    assert.strictEqual(impl.calls.length, 1);
    assert.ok(impl.calls[0].body.text.includes('02 キャスト1'));
    assert.ok(impl.calls[0].body.text.includes('90いくら？'));

    // Replying to that notification must land in this pane, on this thread.
    const instruction = service.bridge.resolveReply({
      message: {
        text: '19時から空いてます',
        message_id: 900,
        chat: { id: 77 },
        reply_to_message: { message_id: 101 },
      },
    });
    assert.ok(instruction, 'the notification must be repliable');
    assert.strictEqual(instruction.siteId, 'cast1');

    await service.deliver(instruction);
    assert.deepStrictEqual(contents.opened, ['href:/dm/9'], 'the thread it came from was opened');
    assert.deepStrictEqual(contents.typed, ['19時から空いてます'], 'the reply text was typed once');
    assert.strictEqual(service.deliveredCount, 1);

    const ack = impl.calls[impl.calls.length - 1];
    assert.ok(ack.body.text.includes('送信しました'), 'the user is told it went through');
    assert.ok(!ack.body.text.includes('確認は取れませんでした'), 'and that it was confirmed on the page');
    assert.strictEqual(ack.body.reply_to_message_id, 900);

    // The reply must not come straight back as a new message.
    const after = await service.scan('cast1');
    assert.strictEqual(after.notified, 0, 'our own message is not reported as news');

    service.stop();
  })) passed++; else failed++;

  if (await testAsync('a conversation that has left the list is refused, not guessed at', async () => {
    const token = `123456789:${'A'.repeat(35)}`;
    const site = {
      id: 'cast1',
      name: '02 キャスト1',
      dm: { enabled: true, rowSelector: '.r', inputSelector: '#t', sendSelector: '#s', intervalSeconds: 90 },
    };
    const config = { telegram: { enabled: true, chatId: '77', pollSeconds: 5, confirmBeforeSend: false }, sites: [site] };
    const contents = fakeContents({
      rows: () => [{ key: 'href:/dm/1', name: 'A', preview: 'x', unread: false }],
      openFails: true,
    });
    const impl = fakeFetch(() => ({ ok: true, result: { message_id: 1, chat: { id: 77 } } }));

    const service = new DmService({
      getConfig: () => config,
      getSite: () => site,
      getContents: () => contents,
      getToken: () => token,
    });
    service.client.fetchImpl = impl;
    service.client.token = token;

    await service.deliver({ siteId: 'cast1', key: 'href:/dm/999', name: 'gone', text: 'hi', chatId: 77, messageId: 5 });
    assert.strictEqual(contents.typed.length, 0, 'nothing was typed into whatever was on screen');
    assert.strictEqual(service.deliveredCount, 0);
    assert.ok(impl.calls[0].body.text.includes('その会話が一覧に見つかりません'));
    service.stop();
  })) passed++; else failed++;

  if (await testAsync('a pane that cannot send yet says so instead of half-working', async () => {
    const token = `123456789:${'A'.repeat(35)}`;
    // Watched, but the reply input was never picked.
    const site = { id: 'cast2', name: '02 キャスト2', dm: { enabled: true, rowSelector: '.r', intervalSeconds: 90 } };
    const config = { telegram: { enabled: true, chatId: '77', pollSeconds: 5, confirmBeforeSend: false }, sites: [site] };
    const impl = fakeFetch(() => ({ ok: true, result: { message_id: 1, chat: { id: 77 } } }));

    const service = new DmService({
      getConfig: () => config,
      getSite: () => site,
      getContents: () => fakeContents({ rows: [] }),
      getToken: () => token,
    });
    service.client.fetchImpl = impl;
    service.client.token = token;

    await service.deliver({ siteId: 'cast2', key: 'k', name: 'x', text: 'hi', chatId: 77, messageId: 5 });
    assert.strictEqual(service.deliveredCount, 0);
    assert.ok(impl.calls[0].body.text.includes('送信できません'));
    service.stop();
  })) passed++; else failed++;

  if (await testAsync('the confirmation dialog can veto a send', async () => {
    const token = `123456789:${'A'.repeat(35)}`;
    const site = {
      id: 'cast1',
      name: '02 キャスト1',
      dm: { enabled: true, rowSelector: '.r', inputSelector: '#t', intervalSeconds: 90 },
    };
    const config = { telegram: { enabled: true, chatId: '77', pollSeconds: 5, confirmBeforeSend: true }, sites: [site] };
    const impl = fakeFetch(() => ({ ok: true, result: { message_id: 1, chat: { id: 77 } } }));
    const contents = fakeContents({ rows: [{ key: 'k', name: 'x', preview: 'y', unread: false }] });

    const service = new DmService({
      getConfig: () => config,
      getSite: () => site,
      getContents: () => contents,
      getToken: () => token,
      confirmSend: async () => false,
    });
    service.client.fetchImpl = impl;
    service.client.token = token;

    await service.deliver({ siteId: 'cast1', key: 'k', name: 'x', text: 'hi', chatId: 77, messageId: 5 });
    assert.strictEqual(contents.ran.length, 0, 'nothing was typed into the page');
    assert.ok(impl.calls[0].body.text.includes('取り消し'));
    service.stop();
  })) passed++; else failed++;


  // --- closing a pane ---

  if (test('a pane is open unless it was closed, and closing keeps its settings', () => {
    const site = schema.normalizeSite({ name: 'X', url: 'https://x.jp' }, 0, new Set());
    assert.strictEqual(site.enabled, true, 'panes start open');
    assert.strictEqual(schema.isPaneVisible(site), true);

    const closed = schema.normalizeSite({ ...site, enabled: false }, 0, new Set());
    assert.strictEqual(schema.isPaneVisible(closed), false);
    // Closing takes it out of the grid; it does not throw the pane away.
    assert.strictEqual(closed.url, 'https://x.jp/');
    assert.deepStrictEqual(closed.autofill, site.autofill);
  })) passed++; else failed++;

  if (test('a closed pane leaves the grid without reshaping it around a gap', () => {
    const config = schema.createDefaultConfig('msns');
    assert.strictEqual(config.sites.length, 9);
    assert.strictEqual(schema.resolveColumns(config), 3, 'nine panes read as 3 x 3');

    config.sites[8].enabled = false;
    assert.strictEqual(schema.resolveColumns(config), 4, 'eight read as 4 x 2');

    // An explicit column choice still wins.
    config.layout.columns = 2;
    assert.strictEqual(schema.resolveColumns(config), 2);
  })) passed++; else failed++;

  if (test('a closed pane is not watched for DMs', () => {
    const watched = { enabled: true, dm: { enabled: true, rowSelector: '.row', inputSelector: '#t' } };
    assert.strictEqual(schema.dmIsUsable(watched), true);
    assert.strictEqual(schema.dmIsUsable({ ...watched, enabled: false }), false);
    assert.strictEqual(schema.dmCanSend({ ...watched, enabled: false }), false);
  })) passed++; else failed++;

  if (test('the open/closed state survives being written and read back', () => {
    const config = schema.createDefaultConfig('sixview');
    config.sites[2].enabled = false;
    const saved = configStore.saveConfig(tmpDir, config, 'sixview');
    assert.strictEqual(saved.sites[2].enabled, false);
    const { config: reloaded } = configStore.loadConfig(tmpDir, 'sixview');
    assert.strictEqual(reloaded.sites[2].enabled, false, 'a closed pane stays closed after a restart');
    assert.strictEqual(reloaded.sites[0].enabled, true);
  })) passed++; else failed++;


  if (await testAsync('the chat id is read from the latest message to the bot', async () => {
    const token = `123456789:${'A'.repeat(35)}`;
    const impl = fakeFetch((url, body) => {
      assert.ok(url.endsWith('/getUpdates'));
      // -1 asks for just the latest, even if earlier ones were consumed.
      assert.strictEqual(body.offset, -1);
      return {
        ok: true,
        result: [
          { update_id: 1, message: { chat: { id: 111, first_name: 'old' }, text: 'first' } },
          { update_id: 2, message: { chat: { id: 222, first_name: 'ゆな' }, text: 'テスト' } },
        ],
      };
    });

    const service = new DmService({
      getConfig: () => ({ telegram: { enabled: false, chatId: '' }, sites: [] }),
      getSite: () => null,
      getContents: () => null,
      getToken: () => token,
    });
    service.client.fetchImpl = impl;

    const found = await service.discoverChatId(token);
    assert.strictEqual(found.ok, true);
    assert.strictEqual(found.chatId, '222', 'the most recent chat wins');
    assert.strictEqual(found.from, 'ゆな');
    service.stop();
  })) passed++; else failed++;

  if (await testAsync('an unaddressed bot says so rather than guessing an id', async () => {
    const token = `123456789:${'A'.repeat(35)}`;
    const service = new DmService({
      getConfig: () => ({ telegram: { enabled: false, chatId: '' }, sites: [] }),
      getSite: () => null,
      getContents: () => null,
      getToken: () => token,
    });
    service.client.fetchImpl = fakeFetch(() => ({ ok: true, result: [] }));

    const empty = await service.discoverChatId(token);
    assert.strictEqual(empty.ok, false);
    assert.strictEqual(empty.reason, 'no-messages');

    const bad = await service.discoverChatId('not-a-token');
    assert.strictEqual(bad.reason, 'bad-token');
    service.stop();
  })) passed++; else failed++;

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

void runTests();
