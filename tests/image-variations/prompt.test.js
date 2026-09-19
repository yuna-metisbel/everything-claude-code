'use strict';
const assert = require('assert');
const { tidy, renderTemplate, buildPrompt, describeCombination } = require('../../scripts/image-variations/lib/prompt');
const { normalizeConfig } = require('../../scripts/image-variations/lib/config');

console.log('=== Testing image-variations/prompt.js ===\n');

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

const config = normalizeConfig({
  template: '{base}, {pose}, {background}, {style}',
  base: 'the same character',
  fixed: { style: 'anime illustration' },
  categories: {
    pose: ['standing', 'sitting'],
    background: ['a studio', 'a cafe']
  }
});

const picks = { pose: { text: 'standing' }, background: { text: 'a cafe' } };

console.log('tidy:');
test('collapses doubled commas', () => {
  assert.strictEqual(tidy('a, , b'), 'a, b');
});
test('strips leading and trailing separators', () => {
  assert.strictEqual(tidy(' , a, b , '), 'a, b');
});
test('collapses repeated spaces', () => {
  assert.strictEqual(tidy('a    b'), 'a b');
});

console.log('\nrenderTemplate:');
test('substitutes known placeholders', () => {
  assert.strictEqual(renderTemplate('{a} and {b}', { a: 'x', b: 'y' }), 'x and y');
});
test('an undefined value leaves no stray comma', () => {
  assert.strictEqual(renderTemplate('{a}, {b}, {c}', { a: 'x', c: 'z' }), 'x, z');
});
test('a repeated placeholder is substituted every time', () => {
  assert.strictEqual(renderTemplate('{a} {a}', { a: 'x' }), 'x x');
});

console.log('\nbuildPrompt:');
test('combines base, picks and fixed values in template order', () => {
  assert.strictEqual(
    buildPrompt(config, picks),
    'the same character, standing, a cafe, anime illustration'
  );
});
test('overrides replace the base text', () => {
  const prompt = buildPrompt(config, picks, { base: 'a described character' });
  assert.ok(prompt.startsWith('a described character,'));
});
test('an empty base does not leave a leading comma', () => {
  const noBase = normalizeConfig({ template: '{base}, {pose}', categories: { pose: ['standing'] } });
  assert.strictEqual(buildPrompt(noBase, { pose: { text: 'standing' } }), 'standing');
});
test('throws when the rendered prompt is empty', () => {
  const empty = normalizeConfig({ template: '{base}', base: '', categories: { pose: ['x'] } });
  assert.throws(() => buildPrompt(empty, { pose: { text: 'x' } }), /empty prompt/);
});
test('a plain string pick is accepted', () => {
  assert.match(buildPrompt(config, { pose: 'kneeling', background: 'a cafe' }), /kneeling/);
});

console.log('\ndescribeCombination:');
test('produces a filesystem-safe slug', () => {
  const slug = describeCombination(picks);
  assert.match(slug, /^[a-z0-9_-]+$/);
  assert.ok(slug.includes('pose-standing'));
});
test('categories appear in a stable order', () => {
  assert.strictEqual(describeCombination(picks), describeCombination({ background: picks.background, pose: picks.pose }));
});
test('excluded categories are left out', () => {
  const slug = describeCombination(picks, { exclude: ['background'] });
  assert.ok(!slug.includes('background'));
  assert.ok(slug.includes('pose'));
});
test('long option text is truncated', () => {
  const slug = describeCombination({ pose: { text: 'a'.repeat(100) } }, { maxPartLength: 8 });
  assert.ok(slug.length <= 'pose-'.length + 8, `slug too long: ${slug}`);
});
test('the whole slug stays within 80 characters', () => {
  const wide = {};
  for (let i = 0; i < 10; i++) wide[`cat${i}`] = { text: 'some fairly long option text here' };
  assert.ok(describeCombination(wide).length <= 80);
});
test('an option with no alphanumerics falls back to "na"', () => {
  assert.strictEqual(describeCombination({ pose: { text: '!!!' } }), 'pose-na');
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
