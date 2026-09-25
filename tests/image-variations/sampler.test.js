'use strict';
const assert = require('assert');
const {
  createRng,
  pickWeighted,
  combinationSpace,
  sampleCombinations
} = require('../../scripts/image-variations/lib/sampler');

console.log('=== Testing image-variations/sampler.js ===\n');

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

const categories = {
  pose: [{ text: 'standing', weight: 1 }, { text: 'sitting', weight: 1 }],
  background: [{ text: 'studio', weight: 1 }, { text: 'street', weight: 1 }, { text: 'cafe', weight: 1 }]
};

console.log('createRng:');
test('same seed yields the same sequence', () => {
  const a = createRng('seed-a');
  const b = createRng('seed-a');
  assert.deepStrictEqual([a(), a(), a()], [b(), b(), b()]);
});
test('different seeds diverge', () => {
  const a = createRng('seed-a');
  const b = createRng('seed-b');
  assert.notStrictEqual(a(), b());
});
test('values stay within [0, 1)', () => {
  const rng = createRng('range');
  for (let i = 0; i < 500; i++) {
    const value = rng();
    assert.ok(value >= 0 && value < 1, `out of range: ${value}`);
  }
});

console.log('\npickWeighted:');
test('always returns one of the options', () => {
  const rng = createRng('pick');
  for (let i = 0; i < 50; i++) {
    assert.ok(categories.pose.includes(pickWeighted(rng, categories.pose)));
  }
});
test('weight 0 options are never selected', () => {
  const rng = createRng('weights');
  const options = [{ text: 'never', weight: 0 }, { text: 'always', weight: 5 }];
  for (let i = 0; i < 50; i++) {
    assert.strictEqual(pickWeighted(rng, options).text, 'always');
  }
});
test('heavier options are selected more often', () => {
  const rng = createRng('skew');
  const options = [{ text: 'rare', weight: 1 }, { text: 'common', weight: 9 }];
  let common = 0;
  for (let i = 0; i < 1000; i++) {
    if (pickWeighted(rng, options).text === 'common') common++;
  }
  assert.ok(common > 800, `expected >800 common picks, got ${common}`);
});
test('throws on an empty option list', () => {
  assert.throws(() => pickWeighted(createRng('x'), []), /non-empty array/);
});

console.log('\ncombinationSpace:');
test('multiplies category sizes', () => {
  assert.strictEqual(combinationSpace(categories), 6);
});
test('locked categories are excluded from the space', () => {
  assert.strictEqual(combinationSpace(categories, ['pose']), 3);
});

console.log('\nsampleCombinations:');
test('returns the requested count', () => {
  const result = sampleCombinations({ categories, count: 4, seed: 's' });
  assert.strictEqual(result.combinations.length, 4);
});
test('is reproducible for a given seed', () => {
  const a = sampleCombinations({ categories, count: 5, seed: 'repeat' });
  const b = sampleCombinations({ categories, count: 5, seed: 'repeat' });
  assert.deepStrictEqual(a.combinations, b.combinations);
});
test('avoids duplicates while the space allows', () => {
  const result = sampleCombinations({ categories, count: 6, seed: 'unique' });
  const keys = result.combinations.map(picks => `${picks.pose.text}|${picks.background.text}`);
  assert.strictEqual(new Set(keys).size, 6);
  assert.strictEqual(result.exhausted, false);
});
test('flags exhaustion when count exceeds the space', () => {
  const result = sampleCombinations({ categories, count: 8, seed: 'over' });
  assert.strictEqual(result.combinations.length, 8);
  assert.strictEqual(result.exhausted, true);
});
test('locked categories keep one value across all combinations', () => {
  const result = sampleCombinations({ categories, count: 3, seed: 'lock', locked: ['background'] });
  assert.strictEqual(new Set(result.combinations.map(picks => picks.background.text)).size, 1);
  assert.deepStrictEqual(result.lockedKeys, ['background']);
});
test('unknown locked categories are ignored', () => {
  const result = sampleCombinations({ categories, count: 2, seed: 'lock', locked: ['nope'] });
  assert.deepStrictEqual(result.lockedKeys, []);
});
test('every combination covers every category', () => {
  const result = sampleCombinations({ categories, count: 4, seed: 'cover' });
  for (const picks of result.combinations) {
    assert.deepStrictEqual(Object.keys(picks).sort(), ['background', 'pose']);
  }
});
test('rejects a non-positive count', () => {
  assert.throws(() => sampleCombinations({ categories, count: 0 }), /positive integer/);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
