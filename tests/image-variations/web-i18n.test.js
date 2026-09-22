'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

console.log('=== Testing image-variations/web/public/i18n.js ===\n');

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

const SOURCE = path.join(__dirname, '..', '..', 'scripts', 'image-variations', 'web', 'public', 'i18n.js');
const PLACEHOLDER_RE = /\{(\w+)\}/g;
// Written from escapes so the pattern cannot contain the characters it hunts for.
const INVISIBLE = new RegExp('[\\u200B-\\u200F\\u202A-\\u202E\\uFEFF]');

function placeholders(text) {
  return new Set([...text.matchAll(PLACEHOLDER_RE)].map(match => match[1]));
}

/**
 * The module is a browser ES module and this repo is CommonJS, so it is
 * imported through a temporary .mjs copy rather than rewritten for the test.
 */
async function loadModule() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-i18n-'));
  const copy = path.join(dir, 'i18n.mjs');
  fs.copyFileSync(SOURCE, copy);
  const loaded = await import(`file://${copy}`);
  return { loaded, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function run() {
  const { loaded: i18n, cleanup } = await loadModule();
  const { DICTIONARIES, LANGUAGES, detectLanguage, setLanguage, t } = i18n;
  const codes = Object.keys(DICTIONARIES);

  console.log('dictionaries:');

  await test('ships the languages the switcher offers', () => {
    assert.deepStrictEqual(LANGUAGES.map(entry => entry.code).sort(), codes.sort());
    for (const entry of LANGUAGES) {
      assert.ok(entry.label.length > 0, `${entry.code} needs a label`);
    }
  });

  await test('every language defines the same keys', () => {
    const reference = Object.keys(DICTIONARIES.en).sort();
    for (const code of codes) {
      const keys = Object.keys(DICTIONARIES[code]).sort();
      const missing = reference.filter(key => !keys.includes(key));
      const extra = keys.filter(key => !reference.includes(key));
      assert.deepStrictEqual(missing, [], `${code} is missing: ${missing.join(', ')}`);
      assert.deepStrictEqual(extra, [], `${code} has unknown keys: ${extra.join(', ')}`);
    }
  });

  await test('no translation is blank', () => {
    for (const code of codes) {
      for (const [key, value] of Object.entries(DICTIONARIES[code])) {
        assert.strictEqual(typeof value, 'string', `${code}.${key} must be a string`);
        assert.ok(value.trim().length > 0, `${code}.${key} is blank`);
      }
    }
  });

  await test('every translation keeps the same placeholders', () => {
    for (const [key, english] of Object.entries(DICTIONARIES.en)) {
      const expected = [...placeholders(english)].sort();
      for (const code of codes) {
        const actual = [...placeholders(DICTIONARIES[code][key])].sort();
        assert.deepStrictEqual(actual, expected, `${code}.${key} placeholders drifted`);
      }
    }
  });

  await test('no translation carries a stray emoji or control character', () => {
    for (const code of codes) {
      for (const [key, value] of Object.entries(DICTIONARIES[code])) {
        assert.ok(!/\p{Extended_Pictographic}/u.test(value), `${code}.${key} contains an emoji`);
        assert.ok(!INVISIBLE.test(value), `${code}.${key} contains an invisible character`);
      }
    }
  });

  console.log('\nlanguage detection:');

  await test('prefers a browser language it speaks', () => {
    assert.strictEqual(detectLanguage(['ja-JP', 'en-US']), 'ja');
    assert.strictEqual(detectLanguage(['en-GB']), 'en');
  });
  await test('matches on the base tag, not the region', () => {
    assert.strictEqual(detectLanguage(['ja-JP-u-ca-japanese']), 'ja');
  });
  await test('skips languages it does not speak', () => {
    assert.strictEqual(detectLanguage(['de-DE', 'fr-FR', 'ja']), 'ja');
  });
  await test('falls back to English for anything else', () => {
    assert.strictEqual(detectLanguage(['de-DE', 'fr-FR']), 'en');
    assert.strictEqual(detectLanguage([]), 'en');
  });

  console.log('\ntranslation:');

  await test('interpolates named values', () => {
    setLanguage('en', { persist: false });
    assert.strictEqual(t('planned', { n: 3 }), 'Planned 3 prompt(s)');
  });
  await test('interpolates the same values in Japanese', () => {
    setLanguage('ja', { persist: false });
    const text = t('doneSome', { n: 4, failures: 1, seed: 'abc' });
    assert.ok(text.includes('4') && text.includes('1') && text.includes('abc'), text);
    assert.ok(!text.includes('{'), 'no placeholder should survive');
  });
  await test('leaves an unsupplied placeholder visible rather than printing undefined', () => {
    setLanguage('en', { persist: false });
    assert.strictEqual(t('planned', {}), 'Planned {n} prompt(s)');
  });
  await test('falls back to the key for an unknown string', () => {
    assert.strictEqual(t('noSuchKey'), 'noSuchKey');
  });
  await test('falls back to English for an unknown language', () => {
    setLanguage('de', { persist: false });
    assert.strictEqual(t('generate'), 'Generate');
  });

  cleanup();

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

run();
