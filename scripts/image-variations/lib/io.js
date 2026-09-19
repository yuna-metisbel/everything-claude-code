'use strict';

/**
 * Filesystem helpers: reference-image encoding and run output.
 */

const fs = require('fs');
const path = require('path');

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

const MAX_REFERENCE_IMAGES = 5;

function mimeForPath(filePath) {
  const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()];
  if (!mime) {
    throw new Error(
      `unsupported image type: ${filePath} (supported: ${Object.keys(MIME_BY_EXT).join(', ')})`
    );
  }
  return mime;
}

/**
 * A local path becomes a data URI; an http(s) URL is passed through so the
 * API can fetch it itself.
 */
function toImageReference(input) {
  if (/^https?:\/\//i.test(input) || /^data:image\//i.test(input)) {
    return input;
  }

  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved)) {
    throw new Error(`reference image not found: ${resolved}`);
  }
  const mime = mimeForPath(resolved);
  return `data:${mime};base64,${fs.readFileSync(resolved).toString('base64')}`;
}

function toImageReferences(inputs) {
  if (inputs.length > MAX_REFERENCE_IMAGES) {
    throw new Error(
      `too many reference images: ${inputs.length} (the API accepts at most ${MAX_REFERENCE_IMAGES})`
    );
  }
  return inputs.map(toImageReference);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

/**
 * Persist one generated image, whether the API returned base64 or a URL.
 */
async function saveImage(image, targetPathWithoutExt, fetchImpl = globalThis.fetch) {
  if (image.kind === 'base64') {
    const target = `${targetPathWithoutExt}.png`;
    fs.writeFileSync(target, Buffer.from(image.value, 'base64'));
    return target;
  }

  const response = await fetchImpl(image.value);
  if (!response.ok) {
    throw new Error(`failed to download generated image: ${response.status} ${response.statusText || ''}`.trim());
  }
  const contentType = response.headers.get('content-type') || 'image/png';
  const ext = contentType.includes('jpeg') ? '.jpg' : contentType.includes('webp') ? '.webp' : '.png';
  const target = `${targetPathWithoutExt}${ext}`;
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

/**
 * Flatten sampler picks into a plain { category: text } map for the manifest.
 */
function picksToPlain(picks) {
  const plain = {};
  for (const [category, option] of Object.entries(picks)) {
    plain[category] = option.text;
  }
  return plain;
}

function writeManifest(outDir, manifest) {
  const target = path.join(outDir, 'manifest.json');
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
  return target;
}

/**
 * A human-readable companion to manifest.json, handy for picking favourites.
 */
function writePromptSheet(outDir, manifest) {
  const lines = [
    `# ${manifest.config.name} - ${manifest.items.length} variation(s)`,
    '',
    `- seed: \`${manifest.seed}\``,
    `- model: \`${manifest.config.model}\``,
    `- reference images: ${manifest.referenceCount}`,
    ''
  ];

  for (const item of manifest.items) {
    lines.push(`## ${item.index}. ${item.status}`);
    lines.push('');
    if (item.file) {
      lines.push(`- file: \`${item.file}\``);
    }
    for (const [category, text] of Object.entries(item.picks)) {
      lines.push(`- ${category}: ${text}`);
    }
    if (item.error) {
      lines.push(`- error: ${item.error}`);
    }
    lines.push('');
    lines.push('```text');
    lines.push(item.prompt);
    lines.push('```');
    lines.push('');
  }

  const target = path.join(outDir, 'prompts.md');
  fs.writeFileSync(target, `${lines.join('\n')}\n`);
  return target;
}

module.exports = {
  MIME_BY_EXT,
  MAX_REFERENCE_IMAGES,
  mimeForPath,
  toImageReference,
  toImageReferences,
  ensureDir,
  saveImage,
  picksToPlain,
  writeManifest,
  writePromptSheet
};
