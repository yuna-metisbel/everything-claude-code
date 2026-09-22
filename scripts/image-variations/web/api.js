'use strict';

/**
 * JSON API behind the image-variations PWA.
 *
 * The browser never receives the xAI key: it asks for a plan, then posts one
 * prompt at a time, and this process adds the Authorization header. Reference
 * images arrive as data URIs the browser already read, so no path from a
 * request ever reaches the filesystem.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { loadConfig } = require('../lib/config');
const { resolveLockedCategories } = require('../lib/args');
const { sampleCombinations } = require('../lib/sampler');
const { buildPrompt, describeCombination } = require('../lib/prompt');
const io = require('../lib/io');
const xai = require('../lib/xai');

// A handful of reference images as base64 data URIs still fits comfortably.
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_COUNT = 24;
const PRESET_ID_RE = /^[A-Za-z0-9._-]+$/;
const DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/i;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Each preset's id plus the name to show for it. A preset that will not
 * parse still gets listed under its id rather than taking the whole
 * listing down with it - the error belongs on the attempt to use it.
 */
function listPresets(presetsDir) {
  if (!fs.existsSync(presetsDir)) {
    return [];
  }

  return fs.readdirSync(presetsDir)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(fileName => {
      const id = path.basename(fileName, '.json');
      try {
        return { id, title: loadConfig(path.join(presetsDir, fileName)).title };
      } catch {
        return { id, title: id };
      }
    });
}

/**
 * Presets are addressed by bare id. Rejecting separators outright keeps the
 * lookup inside presetsDir without relying on path normalization.
 */
function resolvePreset(presetsDir, id) {
  if (typeof id !== 'string' || !PRESET_ID_RE.test(id)) {
    throw new HttpError(400, 'preset must be a plain name with no path separators');
  }

  const target = path.join(presetsDir, `${id}.json`);
  if (!fs.existsSync(target)) {
    throw new HttpError(404, `preset not found: ${id}`);
  }

  try {
    return loadConfig(target);
  } catch (error) {
    throw new HttpError(500, error.message);
  }
}

/**
 * What the UI needs to render the option chips. Nothing here is secret -
 * the endpoints and the key stay on this side regardless.
 */
function describeConfig(config) {
  const categories = {};
  for (const [name, options] of Object.entries(config.categories)) {
    categories[name] = options.map(option => ({
      text: option.text,
      weight: option.weight,
      label: option.label || null
    }));
  }

  return {
    name: config.name,
    title: config.title,
    base: config.base,
    template: config.template,
    labels: config.labels,
    fixed: config.fixed,
    warnings: config.warnings,
    model: config.wire.model,
    categories
  };
}

function normalizePlanRequest(body) {
  const count = Number(body.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    throw new HttpError(400, `count must be an integer between 1 and ${MAX_COUNT}`);
  }

  const lock = Array.isArray(body.lock) ? body.lock.filter(name => typeof name === 'string') : [];
  const only = Array.isArray(body.only) ? body.only.filter(name => typeof name === 'string') : [];
  if (lock.length > 0 && only.length > 0) {
    throw new HttpError(400, 'send either lock or only, not both');
  }

  const seed = typeof body.seed === 'string' && body.seed.trim().length > 0
    ? body.seed.trim()
    : crypto.randomBytes(6).toString('hex');

  return { count, seed, lock, only };
}

function planItems(config, { count, seed, lock, only }) {
  const categoryNames = Object.keys(config.categories);

  let sampled;
  try {
    const locked = resolveLockedCategories({ lock, only }, categoryNames);
    sampled = sampleCombinations({ categories: config.categories, count, seed, locked });
  } catch (error) {
    throw new HttpError(400, error.message);
  }

  const items = sampled.combinations.map((picks, index) => ({
    index: index + 1,
    picks: io.picksToPlain(picks),
    prompt: buildPrompt(config, picks),
    slug: describeCombination(picks, { exclude: sampled.lockedKeys })
  }));

  return { items, space: sampled.space, exhausted: sampled.exhausted, lockedKeys: sampled.lockedKeys };
}

/**
 * Only data URIs are accepted. A local path or an arbitrary URL from the
 * browser would turn this endpoint into a file or network read primitive.
 */
function normalizeReferenceImages(raw) {
  const list = Array.isArray(raw) ? raw : [];

  if (list.length > io.MAX_REFERENCE_IMAGES) {
    throw new HttpError(400, `at most ${io.MAX_REFERENCE_IMAGES} reference image(s) are accepted`);
  }

  for (const entry of list) {
    if (typeof entry !== 'string' || !DATA_IMAGE_RE.test(entry)) {
      throw new HttpError(400, 'reference images must be data:image/*;base64 URIs');
    }
  }

  return list;
}

async function generateOne({ config, body, apiKey, fetchImpl }) {
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (prompt.length === 0) {
    throw new HttpError(400, 'prompt is required');
  }

  const referenceImages = normalizeReferenceImages(body.referenceImages);
  const endpoint = xai.resolveEndpoint(config, referenceImages);
  const requestBody = xai.buildRequestBody({ config, prompt, referenceImages });

  // An upstream rejection (content policy, rate limit, a bad model name) is
  // not an internal failure of this server, and the browser needs to see why.
  let payload;
  try {
    payload = await xai.requestImage({ endpoint, apiKey, body: requestBody, fetchImpl });
  } catch (error) {
    throw new HttpError(502, error.message);
  }

  let image;
  try {
    image = xai.extractImage(payload);
  } catch (error) {
    throw new HttpError(502, error.message);
  }

  return { image, model: config.wire.model, usedReference: referenceImages.length > 0 };
}

async function handleApiRequest({
  method,
  pathname,
  query = {},
  body = {},
  presetsDir,
  apiKey,
  fetchImpl
}) {
  if (method === 'GET' && pathname === '/api/presets') {
    return { status: 200, body: { presets: listPresets(presetsDir), hasApiKey: Boolean(apiKey) } };
  }

  if (method === 'GET' && pathname === '/api/config') {
    return { status: 200, body: describeConfig(resolvePreset(presetsDir, query.preset)) };
  }

  if (method === 'POST' && pathname === '/api/plan') {
    const config = resolvePreset(presetsDir, body.preset);
    const request = normalizePlanRequest(body);
    return { status: 200, body: { seed: request.seed, ...planItems(config, request) } };
  }

  if (method === 'POST' && pathname === '/api/generate-one') {
    if (!apiKey) {
      throw new HttpError(503, 'XAI_API_KEY is not set on the server - export it and restart');
    }
    const config = resolvePreset(presetsDir, body.preset);
    return { status: 200, body: await generateOne({ config, body, apiKey, fetchImpl }) };
  }

  throw new HttpError(404, `no such endpoint: ${method} ${pathname}`);
}

module.exports = {
  MAX_BODY_BYTES,
  MAX_COUNT,
  HttpError,
  listPresets,
  resolvePreset,
  describeConfig,
  normalizePlanRequest,
  planItems,
  normalizeReferenceImages,
  generateOne,
  handleApiRequest
};
