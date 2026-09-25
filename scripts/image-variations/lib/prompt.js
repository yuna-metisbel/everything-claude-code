'use strict';

/**
 * Turns one sampled combination into the final prompt string.
 */

const { PLACEHOLDER_RE } = require('./config');

/**
 * Collapse the artefacts of an empty placeholder: doubled separators,
 * leading/trailing commas, runs of whitespace.
 */
function tidy(text) {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*,\s*(?=,)/g, '')
    .replace(/,\s*(?=[.;])/g, '')
    .replace(/^[\s,]+/, '')
    .replace(/[\s,]+$/, '')
    .trim();
}

function renderTemplate(template, values) {
  return tidy(template.replace(PLACEHOLDER_RE, (_, key) => {
    const value = values[key];
    return value === undefined || value === null ? '' : String(value);
  }));
}

/**
 * Build the prompt for one variation.
 *
 * `picks` is a { category: { text } } map from the sampler; `overrides`
 * lets the caller inject a value (typically a richer {base} derived from
 * the reference image).
 */
function buildPrompt(config, picks, overrides = {}) {
  const values = { base: config.base, ...config.fixed };

  for (const [category, option] of Object.entries(picks)) {
    values[category] = option && typeof option === 'object' ? option.text : option;
  }

  Object.assign(values, overrides);

  const prompt = renderTemplate(config.template, values);
  if (prompt.length === 0) {
    throw new Error('buildPrompt produced an empty prompt - check config.template and the option texts');
  }
  return prompt;
}

/**
 * A short, filesystem-safe label describing the combination, e.g.
 * "pose-arms-crossed__background-cafe". Used in output filenames.
 *
 * Locked categories are the same in every file, so `exclude` keeps them out
 * and leaves the name showing only what actually varies.
 */
function describeCombination(picks, { maxPartLength = 14, exclude = [] } = {}) {
  const skip = new Set(exclude);
  return Object.keys(picks)
    .filter(category => !skip.has(category))
    .sort()
    .map(category => {
      const option = picks[category];
      const raw = (option && (option.label || option.text)) || '';
      const slug = raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, maxPartLength)
        .replace(/-+$/, '');
      return `${category}-${slug || 'na'}`;
    })
    .join('__')
    .slice(0, 80)
    .replace(/[-_]+$/, '');
}

module.exports = { tidy, renderTemplate, buildPrompt, describeCombination };
