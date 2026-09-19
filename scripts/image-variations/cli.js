#!/usr/bin/env node
'use strict';

/**
 * image-variations: generate N variations of one reference image with
 * randomly sampled pose / hairstyle / outfit / background prompts.
 *
 * Usage: node scripts/image-variations/cli.js --image ./ref.png --count 8
 */

const path = require('path');
const crypto = require('crypto');

const { USAGE, parseArgs, resolveLockedCategories } = require('./lib/args');
const { loadConfig } = require('./lib/config');
const { sampleCombinations } = require('./lib/sampler');
const { buildPrompt, describeCombination } = require('./lib/prompt');
const xai = require('./lib/xai');
const io = require('./lib/io');

function log(message) {
  process.stderr.write(`${message}\n`);
}

function defaultOutDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(process.cwd(), 'out', 'image-variations', stamp);
}

function readApiKey() {
  const key = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  if (!key) {
    throw new Error(
      'XAI_API_KEY is not set. Export your xAI key first:\n' +
      '  export XAI_API_KEY="xai-..."'
    );
  }
  return key;
}

/**
 * Run tasks with a bounded number in flight so a large --count does not
 * open 20 simultaneous requests.
 */
async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

function planVariations(config, options) {
  const categoryNames = Object.keys(config.categories);
  const locked = resolveLockedCategories(options, categoryNames);
  const seed = options.seed || crypto.randomBytes(6).toString('hex');

  const sampled = sampleCombinations({
    categories: config.categories,
    count: options.count,
    seed,
    locked
  });

  const items = sampled.combinations.map((picks, index) => ({
    index: index + 1,
    picks,
    plainPicks: io.picksToPlain(picks),
    prompt: buildPrompt(config, picks),
    slug: describeCombination(picks, { exclude: sampled.lockedKeys })
  }));

  return { seed, items, sampled };
}

async function generateOne({ item, config, endpoint, apiKey, referenceImages, outDir }) {
  const body = xai.buildRequestBody({ config, prompt: item.prompt, referenceImages });
  const payload = await xai.requestImage({ endpoint, apiKey, body });
  const image = xai.extractImage(payload);
  const base = path.join(outDir, `${String(item.index).padStart(3, '0')}_${item.slug}`);
  const file = await io.saveImage(image, base);
  return { file: path.relative(outDir, file), revisedPrompt: image.revisedPrompt };
}

async function main(argv) {
  const options = parseArgs(argv);

  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const config = loadConfig(options.config);
  for (const warning of config.warnings) {
    log(`[image-variations] warning: ${warning}`);
  }

  if (options.model) {
    config.wire.model = options.model;
  }

  if (options.images.length === 0) {
    log('[image-variations] no --image given: running text-to-image without a reference');
  }
  const referenceImages = io.toImageReferences(options.images);

  const endpoint = options.endpoint || xai.resolveEndpoint(config, referenceImages);
  const { seed, items, sampled } = planVariations(config, options);

  if (sampled.exhausted) {
    log(
      `[image-variations] warning: only ${sampled.space} distinct combination(s) available for ` +
      `${options.count} requested variation(s) - some prompts repeat`
    );
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    seed,
    config: {
      name: config.name,
      source: config.source,
      model: config.wire.model,
      endpoint
    },
    referenceCount: referenceImages.length,
    lockedCategories: sampled.lockedKeys,
    combinationSpace: sampled.space,
    items: []
  };

  if (options.dryRun) {
    const sampleBody = xai.buildRequestBody({
      config,
      prompt: items[0].prompt,
      referenceImages
    });
    log(`[image-variations] dry run - endpoint: ${endpoint}`);
    log(`[image-variations] request body (images redacted):\n${JSON.stringify(xai.summarizeBody(sampleBody), null, 2)}`);
    manifest.items = items.map(item => ({
      index: item.index,
      status: 'planned',
      picks: item.plainPicks,
      prompt: item.prompt,
      file: null
    }));
  } else {
    const apiKey = readApiKey();
    const outDir = io.ensureDir(options.out ? path.resolve(options.out) : defaultOutDir());
    manifest.outDir = outDir;
    log(`[image-variations] seed=${seed} count=${items.length} -> ${outDir}`);

    const outcomes = await runPool(items, options.concurrency, async item => {
      try {
        const result = await generateOne({ item, config, endpoint, apiKey, referenceImages, outDir });
        log(`[image-variations] ${item.index}/${items.length} done: ${result.file}`);
        return { ...item, status: 'ok', ...result };
      } catch (error) {
        log(`[image-variations] ${item.index}/${items.length} failed: ${error.message}`);
        return { ...item, status: 'failed', error: error.message, file: null };
      }
    });

    manifest.items = outcomes.map(outcome => ({
      index: outcome.index,
      status: outcome.status,
      picks: outcome.plainPicks,
      prompt: outcome.prompt,
      file: outcome.file,
      ...(outcome.revisedPrompt ? { revisedPrompt: outcome.revisedPrompt } : {}),
      ...(outcome.error ? { error: outcome.error } : {})
    }));

    io.writeManifest(outDir, manifest);
    io.writePromptSheet(outDir, manifest);

    const failed = manifest.items.filter(item => item.status === 'failed').length;
    log(`[image-variations] finished: ${manifest.items.length - failed} ok, ${failed} failed`);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    }
    return failed === manifest.items.length ? 1 : 0;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    for (const item of manifest.items) {
      process.stdout.write(`${String(item.index).padStart(3, '0')}  ${item.prompt}\n`);
    }
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(code => { process.exitCode = code; })
    .catch(error => {
      log(`[image-variations] error: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { main, planVariations, runPool, defaultOutDir };
