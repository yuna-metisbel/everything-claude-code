'use strict';

/**
 * Seeded random sampling of prompt-option combinations.
 *
 * Every run is reproducible: the same seed plus the same config always
 * yields the same list of combinations.
 */

/**
 * Hash an arbitrary string into a 32-bit seed (xfnv1a).
 */
function hashSeed(seed) {
  let h = 2166136261 >>> 0;
  const text = String(seed);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic PRNG (mulberry32). Returns a function producing [0, 1).
 */
function createRng(seed) {
  let state = hashSeed(seed);
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick one option honouring integer/float weights (default weight 1).
 * Options are already normalized to { text, weight } by config.js.
 */
function pickWeighted(rng, options) {
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error('pickWeighted: options must be a non-empty array');
  }

  const total = options.reduce((sum, option) => sum + option.weight, 0);
  if (total <= 0) {
    throw new Error('pickWeighted: total weight must be greater than 0');
  }

  let threshold = rng() * total;
  for (const option of options) {
    threshold -= option.weight;
    if (threshold < 0) {
      return option;
    }
  }
  return options[options.length - 1];
}

/**
 * Total number of distinct combinations available for the free categories.
 */
function combinationSpace(categories, lockedKeys = []) {
  const locked = new Set(lockedKeys);
  return Object.entries(categories)
    .filter(([key]) => !locked.has(key))
    .reduce((product, [, options]) => product * options.length, 1);
}

function combinationKey(picks) {
  return Object.keys(picks)
    .sort()
    .map(key => `${key}=${picks[key].text}`)
    .join('\u0000');
}

/**
 * Sample `count` combinations, one option per category.
 *
 * Locked categories are drawn once and reused for every combination, which is
 * how you vary (say) only the background while keeping the outfit fixed.
 * Duplicates are avoided while the combination space allows it; once the space
 * is exhausted, repeats are emitted and reported via `exhausted`.
 */
function sampleCombinations({ categories, count, seed = 'default', locked = [], maxAttemptsPerItem = 40 }) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('sampleCombinations: count must be a positive integer');
  }

  const rng = createRng(seed);
  const lockedKeys = locked.filter(key => Object.prototype.hasOwnProperty.call(categories, key));
  const lockedPicks = {};
  for (const key of lockedKeys) {
    lockedPicks[key] = pickWeighted(rng, categories[key]);
  }

  const space = combinationSpace(categories, lockedKeys);
  const seen = new Set();
  const results = [];
  let exhausted = false;

  while (results.length < count) {
    let candidate = null;
    let unique = false;

    for (let attempt = 0; attempt < maxAttemptsPerItem; attempt++) {
      const picks = { ...lockedPicks };
      for (const [key, options] of Object.entries(categories)) {
        if (!lockedPicks[key]) {
          picks[key] = pickWeighted(rng, options);
        }
      }

      candidate = picks;
      const key = combinationKey(picks);
      if (!seen.has(key)) {
        seen.add(key);
        unique = true;
        break;
      }
    }

    if (!unique) {
      exhausted = true;
    }
    results.push(candidate);
  }

  return { combinations: results, space, exhausted, lockedKeys };
}

module.exports = {
  hashSeed,
  createRng,
  pickWeighted,
  combinationSpace,
  combinationKey,
  sampleCombinations
};
