'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  normalizeOption,
  normalizeCategories,
  normalizeConfig,
  loadConfig,
  DEFAULT_WIRE
} = require('../../scripts/image-variations/lib/config');

console.log('=== Testing image-variations/config.js ===\n');

let passed = 0;
let failed = 0;

function test(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${desc}: ${e.message}`);
    failed++;
  }
}

const minimal = {
  template: '{base}, {pose}',
  base: 'a character',
  categories: { pose: ['standing', 'sitting'] }
};

console.log('normalizeOption:');
test('a plain string becomes { text, weight: 1 }', () => {
  assert.deepStrictEqual(normalizeOption('standing', 'pose', 0), { text: 'standing', weight: 1 });
});
test('an object keeps its weight', () => {
  assert.deepStrictEqual(normalizeOption({ text: 'sitting', weight: 3 }, 'pose', 0), { text: 'sitting', weight: 3 });
});
test('an optional label is preserved', () => {
  assert.strictEqual(normalizeOption({ text: 'x', label: 'short' }, 'pose', 0).label, 'short');
});
test('surrounding whitespace is trimmed', () => {
  assert.strictEqual(normalizeOption('  standing  ', 'pose', 0).text, 'standing');
});
test('rejects a non-positive weight', () => {
  assert.throws(() => normalizeOption({ text: 'x', weight: 0 }, 'pose', 0), /positive number/);
});
test('rejects an unsupported option shape', () => {
  assert.throws(() => normalizeOption(42, 'pose', 1), /categories\.pose\[1\]/);
});

console.log('\nnormalizeCategories:');
test('rejects an empty category array', () => {
  assert.throws(() => normalizeCategories({ pose: [] }), /non-empty array/);
});
test('rejects an empty option text', () => {
  assert.throws(() => normalizeCategories({ pose: ['   '] }), /empty option/);
});
test('rejects the reserved name "base"', () => {
  assert.throws(() => normalizeCategories({ base: ['x'] }), /reserved/);
});
test('rejects a missing categories object', () => {
  assert.throws(() => normalizeCategories(undefined), /must be an object/);
});

console.log('\nnormalizeConfig:');
test('applies wire defaults', () => {
  const config = normalizeConfig(minimal);
  assert.strictEqual(config.wire.model, DEFAULT_WIRE.model);
  assert.strictEqual(config.wire.editEndpoint, DEFAULT_WIRE.editEndpoint);
});
test('a partial wire block overrides only what it sets', () => {
  const config = normalizeConfig({ ...minimal, wire: { model: 'custom-model' } });
  assert.strictEqual(config.wire.model, 'custom-model');
  assert.strictEqual(config.wire.imageField, DEFAULT_WIRE.imageField);
});
test('rejects an unknown template placeholder', () => {
  assert.throws(() => normalizeConfig({ ...minimal, template: '{base}, {nope}' }), /unknown placeholder/);
});
test('accepts a placeholder backed by fixed values', () => {
  const config = normalizeConfig({ ...minimal, template: '{pose}, {style}', fixed: { style: 'anime' } });
  assert.strictEqual(config.fixed.style, 'anime');
});
test('warns about categories the template ignores', () => {
  const config = normalizeConfig({ ...minimal, categories: { pose: ['a'], hair: ['b'] } });
  assert.strictEqual(config.warnings.length, 1);
  assert.match(config.warnings[0], /hair/);
});
test('no warnings when every category is used', () => {
  assert.deepStrictEqual(normalizeConfig(minimal).warnings, []);
});
test('rejects an invalid imageStyle', () => {
  assert.throws(() => normalizeConfig({ ...minimal, wire: { imageStyle: 'bogus' } }), /imageStyle/);
});
test('rejects a non-object config', () => {
  assert.throws(() => normalizeConfig([]), /must be a JSON object/);
});

console.log('\nloadConfig:');
test('reports a missing file clearly', () => {
  assert.throws(() => loadConfig('/nonexistent/config.json'), /config not found/);
});
test('reports invalid JSON clearly', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-')), 'bad.json');
  fs.writeFileSync(file, '{ not json');
  assert.throws(() => loadConfig(file), /not valid JSON/);
});
test('the bundled preset loads and is usable', () => {
  const config = loadConfig(path.join(__dirname, '../../scripts/image-variations/presets/character-variations.json'));
  assert.deepStrictEqual(config.warnings, []);
  assert.deepStrictEqual(Object.keys(config.categories).sort(), ['background', 'hair', 'outfit', 'pose']);
  for (const options of Object.values(config.categories)) {
    assert.ok(options.length >= 2);
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
