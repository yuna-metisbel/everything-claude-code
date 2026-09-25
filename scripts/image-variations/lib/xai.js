'use strict';

/**
 * Minimal xAI (Grok) image API client.
 *
 * The request shape lives in config.wire so it can be corrected without a
 * code change if xAI moves a field; `--dry-run` prints the exact body that
 * would be sent.
 */

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

/**
 * Wrap a reference image for the request body. xAI accepts a data URI,
 * a public URL, or a Files API id in the same slot.
 */
function wrapImage(reference, imageStyle) {
  return imageStyle === 'url' ? reference : { type: 'image_url', url: reference };
}

function buildRequestBody({ config, prompt, referenceImages = [], n = 1 }) {
  const { wire, request } = config;
  const body = {
    model: wire.model,
    prompt,
    n,
    ...request
  };

  if (wire.responseFormat) {
    body.response_format = wire.responseFormat;
  }

  // One reference goes in `image` as a single object; several go in `images`
  // as an array. Sending a one-element array under `image` is not the same
  // request, and it is the shape the API rejects.
  if (referenceImages.length === 1) {
    body[wire.imageField] = wrapImage(referenceImages[0], wire.imageStyle);
  } else if (referenceImages.length > 1) {
    body[wire.imageFieldMultiple] = referenceImages.map(
      reference => wrapImage(reference, wire.imageStyle)
    );
  }

  return body;
}

function resolveEndpoint(config, referenceImages = []) {
  return referenceImages.length > 0 ? config.wire.editEndpoint : config.wire.generateEndpoint;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const MAX_LOGGED_STRING = 200;
const LOGGED_STRING_HEAD = 120;

/**
 * Redact everything that could carry a base64 payload or a key so failures
 * can be logged safely.
 *
 * A reference image is a nested object, so this has to recurse: a top-level
 * scan would print the data URI in full.
 */
function summarizeValue(value) {
  if (Array.isArray(value)) {
    return `[${value.length} item(s)]`;
  }
  if (value && typeof value === 'object') {
    const copy = {};
    for (const [key, nested] of Object.entries(value)) {
      copy[key] = summarizeValue(nested);
    }
    return copy;
  }
  if (typeof value === 'string' && value.length > MAX_LOGGED_STRING) {
    return `${value.slice(0, LOGGED_STRING_HEAD)}... (${value.length} chars)`;
  }
  return value;
}

function summarizeBody(body) {
  const copy = {};
  for (const [key, value] of Object.entries(body)) {
    copy[key] = summarizeValue(value);
  }
  return copy;
}

async function requestImage({
  endpoint,
  apiKey,
  body,
  fetchImpl = globalThis.fetch,
  maxRetries = 3,
  baseDelayMs = 1000,
  sleepImpl = sleep
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('global fetch is unavailable - Node.js 18 or newer is required');
  }

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      lastError = new Error(`network error calling ${endpoint}: ${error.message}`);
      if (attempt === maxRetries) break;
      await sleepImpl(baseDelayMs * Math.pow(2, attempt));
      continue;
    }

    if (response.ok) {
      return response.json();
    }

    const detail = await response.text().catch(() => '');
    lastError = new Error(
      `${endpoint} responded ${response.status} ${response.statusText || ''}`.trim() +
      (detail ? `: ${detail.slice(0, 500)}` : '')
    );

    if (!RETRYABLE_STATUS.has(response.status) || attempt === maxRetries) {
      break;
    }
    await sleepImpl(baseDelayMs * Math.pow(2, attempt));
  }

  throw lastError;
}

/**
 * Pull the first image out of an OpenAI-compatible images response.
 */
function extractImage(payload) {
  const entry = payload && Array.isArray(payload.data) ? payload.data[0] : null;
  if (!entry) {
    throw new Error(`unexpected response shape: ${JSON.stringify(payload).slice(0, 300)}`);
  }

  if (entry.b64_json) {
    return { kind: 'base64', value: entry.b64_json, revisedPrompt: entry.revised_prompt || null };
  }
  if (entry.url) {
    return { kind: 'url', value: entry.url, revisedPrompt: entry.revised_prompt || null };
  }

  throw new Error(`response entry has neither b64_json nor url: ${JSON.stringify(entry).slice(0, 300)}`);
}

module.exports = {
  RETRYABLE_STATUS,
  wrapImage,
  buildRequestBody,
  resolveEndpoint,
  summarizeBody,
  requestImage,
  extractImage
};
