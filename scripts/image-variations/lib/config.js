'use strict';

/**
 * Loading and validation for image-variation configs.
 *
 * A config holds the prompt option patterns (pose / hair / outfit / background
 * or anything else you invent), the prompt template that stitches a pick from
 * each category together, and the wire settings for the image API.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_WIRE = {
  model: 'grok-imagine-image-2.0',
  generateEndpoint: 'https://api.x.ai/v1/images/generations',
  editEndpoint: 'https://api.x.ai/v1/images/edits',
  imageField: 'image',
  imageStyle: 'object',
  responseFormat: 'b64_json'
};

const RESERVED_KEYS = new Set(['base', 'prompt']);
const PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * Accept both "plain string" and { text, weight } option forms.
 */
function normalizeOption(raw, categoryName, index) {
  if (typeof raw === 'string') {
    return { text: raw.trim(), weight: 1 };
  }

  if (raw && typeof raw === 'object' && typeof raw.text === 'string') {
    const weight = raw.weight === undefined ? 1 : Number(raw.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(`categories.${categoryName}[${index}]: weight must be a positive number`);
    }
    return { text: raw.text.trim(), weight, ...(raw.label ? { label: raw.label } : {}) };
  }

  throw new Error(
    `categories.${categoryName}[${index}]: expected a string or { "text": "...", "weight": 1 }`
  );
}

function normalizeCategories(rawCategories) {
  if (!rawCategories || typeof rawCategories !== 'object' || Array.isArray(rawCategories)) {
    throw new Error('config.categories must be an object of { categoryName: [options] }');
  }

  const entries = Object.entries(rawCategories);
  if (entries.length === 0) {
    throw new Error('config.categories must contain at least one category');
  }

  const categories = {};
  for (const [name, options] of entries) {
    if (RESERVED_KEYS.has(name)) {
      throw new Error(`config.categories.${name}: "${name}" is reserved, pick another category name`);
    }
    if (!Array.isArray(options) || options.length === 0) {
      throw new Error(`config.categories.${name} must be a non-empty array`);
    }
    const normalized = options.map((option, index) => normalizeOption(option, name, index));
    if (normalized.some(option => option.text.length === 0)) {
      throw new Error(`config.categories.${name} contains an empty option`);
    }
    categories[name] = normalized;
  }
  return categories;
}

/**
 * Optional display names for the categories.
 *
 * Template placeholders are ASCII (`{pose}`), but the name a person reads in
 * the UI does not have to be - this is where a category gets called
 * "\u30dd\u30fc\u30ba" while the template still says `{pose}`.
 */
function normalizeLabels(rawLabels, categories) {
  if (rawLabels === undefined || rawLabels === null) {
    return {};
  }
  if (typeof rawLabels !== 'object' || Array.isArray(rawLabels)) {
    throw new Error('config.labels must be an object of { categoryName: "display name" }');
  }

  const labels = {};
  for (const [name, label] of Object.entries(rawLabels)) {
    if (!Object.prototype.hasOwnProperty.call(categories, name)) {
      throw new Error(
        `config.labels.${name}: no such category. Known: ${Object.keys(categories).sort().join(', ')}`
      );
    }
    if (typeof label !== 'string' || label.trim().length === 0) {
      throw new Error(`config.labels.${name} must be a non-empty string`);
    }
    labels[name] = label.trim();
  }
  return labels;
}

/**
 * Placeholders in the template must resolve to a category, a fixed value,
 * or the built-in {base}. Catching this at load time beats a confusing
 * half-rendered prompt after the API bill.
 */
function validateTemplate(template, categories, fixed) {
  if (typeof template !== 'string' || template.trim().length === 0) {
    throw new Error('config.template must be a non-empty string');
  }

  const known = new Set([...Object.keys(categories), ...Object.keys(fixed), 'base']);
  const unknown = [];
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    if (!known.has(match[1])) {
      unknown.push(match[1]);
    }
  }

  if (unknown.length > 0) {
    throw new Error(
      `config.template references unknown placeholder(s): ${[...new Set(unknown)].join(', ')}. ` +
      `Known: ${[...known].sort().join(', ')}`
    );
  }

  const used = new Set([...template.matchAll(PLACEHOLDER_RE)].map(match => match[1]));
  const unusedCategories = Object.keys(categories).filter(name => !used.has(name));
  return { unusedCategories };
}

function normalizeConfig(raw, source = '<inline>') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${source}: config must be a JSON object`);
  }

  const categories = normalizeCategories(raw.categories);
  const labels = normalizeLabels(raw.labels, categories);
  const fixed = raw.fixed && typeof raw.fixed === 'object' && !Array.isArray(raw.fixed) ? { ...raw.fixed } : {};
  const template = raw.template;
  const { unusedCategories } = validateTemplate(template, categories, fixed);

  const wire = { ...DEFAULT_WIRE, ...(raw.wire || {}) };
  if (!['object', 'url'].includes(wire.imageStyle)) {
    throw new Error(`${source}: config.wire.imageStyle must be "object" or "url"`);
  }

  return {
    name: typeof raw.name === 'string' ? raw.name : path.basename(source, '.json'),
    base: typeof raw.base === 'string' ? raw.base : '',
    template,
    categories,
    labels,
    fixed,
    request: raw.request && typeof raw.request === 'object' ? { ...raw.request } : {},
    wire,
    source,
    warnings: unusedCategories.length > 0
      ? [`categories not referenced by the template (they will not affect the prompt): ${unusedCategories.join(', ')}`]
      : []
  };
}

function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`config not found: ${resolved}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`config is not valid JSON (${resolved}): ${error.message}`);
  }

  return normalizeConfig(parsed, resolved);
}

module.exports = {
  DEFAULT_WIRE,
  PLACEHOLDER_RE,
  normalizeOption,
  normalizeCategories,
  normalizeLabels,
  validateTemplate,
  normalizeConfig,
  loadConfig
};
