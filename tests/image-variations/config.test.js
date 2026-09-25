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

console.log('\ncategory display names:');

test('defaults to no labels', () => {
  const config = normalizeConfig({ template: '{pose}', categories: { pose: ['standing'] } });
  assert.deepStrictEqual(config.labels, {});
});
test('keeps a display name for a category', () => {
  const config = normalizeConfig({
    template: '{pose}',
    categories: { pose: ['standing'] },
    labels: { pose: '\u30dd\u30fc\u30ba' }
  });
  assert.strictEqual(config.labels.pose, '\u30dd\u30fc\u30ba');
});
test('trims a display name', () => {
  const config = normalizeConfig({
    template: '{pose}',
    categories: { pose: ['standing'] },
    labels: { pose: '  Pose  ' }
  });
  assert.strictEqual(config.labels.pose, 'Pose');
});
test('rejects a label for an unknown category', () => {
  assert.throws(() => normalizeConfig({
    template: '{pose}',
    categories: { pose: ['standing'] },
    labels: { nope: 'x' }
  }), /no such category/);
});
test('rejects a blank label', () => {
  assert.throws(() => normalizeConfig({
    template: '{pose}',
    categories: { pose: ['standing'] },
    labels: { pose: '   ' }
  }), /non-empty string/);
});
test('rejects labels that are not an object', () => {
  assert.throws(() => normalizeConfig({
    template: '{pose}',
    categories: { pose: ['standing'] },
    labels: ['pose']
  }), /must be an object/);
});

console.log('\npreset display title:');

test('falls back to the preset name when no title is given', () => {
  const config = normalizeConfig({ template: '{pose}', categories: { pose: ['a'] }, name: 'tiny' });
  assert.strictEqual(config.title, 'tiny');
});
test('keeps a title distinct from the identifier', () => {
  const config = normalizeConfig({
    template: '{pose}', categories: { pose: ['a'] },
    name: 'edit-pose', title: '\u30dd\u30fc\u30ba\u3060\u3051\u5909\u66f4'
  });
  assert.strictEqual(config.name, 'edit-pose');
  assert.strictEqual(config.title, '\u30dd\u30fc\u30ba\u3060\u3051\u5909\u66f4');
});
test('trims a title', () => {
  const config = normalizeConfig({ template: '{pose}', categories: { pose: ['a'] }, title: '  T  ' });
  assert.strictEqual(config.title, 'T');
});
test('rejects a blank title', () => {
  assert.throws(() => normalizeConfig({
    template: '{pose}', categories: { pose: ['a'] }, title: '   '
  }), /title must be a non-empty string/);
});

test('every bundled preset names itself for the reader and for the filesystem', () => {
  const dir = path.join(__dirname, '../../scripts/image-variations/presets');
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.json'))) {
    const config = loadConfig(path.join(dir, file));
    assert.strictEqual(config.name, path.basename(file, '.json'), `${file}: name should match the file`);
    assert.ok(config.title.length > 0, `${file} has no title`);
    assert.deepStrictEqual(
      Object.keys(config.labels).sort(),
      Object.keys(config.categories).sort(),
      `${file}: every category needs a display name`
    );
  }
});

console.log('\nbundled presets:');

test('every bundled preset loads without a warning', () => {
  const dir = path.join(__dirname, '../../scripts/image-variations/presets');
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.json'));
  assert.ok(files.length > 0, 'there should be at least one preset');

  for (const file of files) {
    const config = loadConfig(path.join(dir, file));
    assert.deepStrictEqual(config.warnings, [], `${file}: ${config.warnings.join('; ')}`);
    assert.ok(Object.keys(config.categories).length > 0, `${file} has no categories`);
    for (const [name, options] of Object.entries(config.categories)) {
      assert.ok(options.length >= 2 || files.length > 0, `${file}.${name} is empty`);
    }
  }
});

test('every bundled preset renders a prompt with no placeholder left behind', () => {
  const dir = path.join(__dirname, '../../scripts/image-variations/presets');
  const { sampleCombinations } = require('../../scripts/image-variations/lib/sampler');
  const { buildPrompt } = require('../../scripts/image-variations/lib/prompt');

  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.json'))) {
    const config = loadConfig(path.join(dir, file));
    const sampled = sampleCombinations({ categories: config.categories, count: 5, seed: file });
    for (const picks of sampled.combinations) {
      const prompt = buildPrompt(config, picks);
      assert.ok(prompt.length > 0, `${file} produced an empty prompt`);
      assert.strictEqual(
        prompt.match(/\{[a-zA-Z0-9_]+\}/g),
        null,
        `${file} left a placeholder unresolved: ${prompt.slice(0, 120)}`
      );
    }
  }
});

test('every option that carries a label keeps it filesystem-safe', () => {
  const dir = path.join(__dirname, '../../scripts/image-variations/presets');
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.json'))) {
    const config = loadConfig(path.join(dir, file));
    for (const [name, options] of Object.entries(config.categories)) {
      for (const option of options) {
        if (option.label !== undefined) {
          assert.match(option.label, /^[a-z0-9-]+$/, `${file}.${name}: "${option.label}" is not a slug`);
        }
      }
    }
  }
});

test('selfie-natural varies four axes and keeps the outfit as it is but for colour', () => {
  const file = path.join(__dirname, '../../scripts/image-variations/presets/selfie-natural.json');
  const config = loadConfig(file);

  assert.deepStrictEqual(
    Object.keys(config.categories).sort(),
    ['angle', 'background', 'color', 'pose']
  );

  // The preamble is the only thing standing between "recolour the outfit" and
  // "put her in something else". A preset that reads several references and
  // redraws the whole frame has no other guard, so the wording is pinned here:
  // the garment's coverage comes from the reference and colour is the one axis
  // that moves.
  assert.match(config.base, /色だけ/);
  assert.match(config.base, /露出を増やしたり/);
  assert.match(config.base, /置き換えたりしないで/);
  assert.match(config.base, /匿名性を維持/);

  // Several references of one person is what this preset is for - if the
  // prompt stops saying so, the model reads the face off one frame again.
  assert.match(config.base, /複数枚/);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
