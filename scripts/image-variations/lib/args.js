'use strict';

/**
 * CLI argument parsing for image-variations.
 */

const path = require('path');

const DEFAULT_PRESET = path.join(__dirname, '..', 'presets', 'character-variations.json');

const USAGE = `
Usage:
  node scripts/image-variations/cli.js --image <file> [options]

Options:
  -i, --image <path|url>   Reference image. Repeat for up to 5 images.
  -n, --count <number>     How many variations to generate (default: 4)
  -c, --config <path>      Prompt-pattern config JSON (default: bundled preset)
  -o, --out <dir>          Output directory (default: ./out/image-variations/<timestamp>)
  -s, --seed <string>      Seed for reproducible sampling (default: random)
      --lock <a,b>         Categories sampled once and reused for every variation
      --only <a,b>         Only vary these categories; the rest are locked
      --concurrency <n>    Parallel API requests (default: 2)
      --model <id>         Override config.wire.model
      --endpoint <url>     Override the endpoint used for this run
      --dry-run            Print prompts and the request body; call no API
      --json               Emit the run manifest as JSON on stdout
  -h, --help               Show this help

Environment:
  XAI_API_KEY              xAI API key (GROK_API_KEY is accepted as a fallback)
`.trim();

function splitList(value) {
  return String(value)
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function requireValue(flag, value) {
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    images: [],
    count: 4,
    config: DEFAULT_PRESET,
    out: null,
    seed: null,
    lock: [],
    only: [],
    concurrency: 2,
    model: null,
    endpoint: null,
    dryRun: false,
    json: false,
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-i':
      case '--image':
        options.images.push(requireValue(arg, argv[++i]));
        break;
      case '-n':
      case '--count':
        options.count = Number(requireValue(arg, argv[++i]));
        break;
      case '-c':
      case '--config':
        options.config = requireValue(arg, argv[++i]);
        break;
      case '-o':
      case '--out':
        options.out = requireValue(arg, argv[++i]);
        break;
      case '-s':
      case '--seed':
        options.seed = requireValue(arg, argv[++i]);
        break;
      case '--lock':
        options.lock = splitList(requireValue(arg, argv[++i]));
        break;
      case '--only':
        options.only = splitList(requireValue(arg, argv[++i]));
        break;
      case '--concurrency':
        options.concurrency = Number(requireValue(arg, argv[++i]));
        break;
      case '--model':
        options.model = requireValue(arg, argv[++i]);
        break;
      case '--endpoint':
        options.endpoint = requireValue(arg, argv[++i]);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`unknown option: ${arg}`);
        }
        options.images.push(arg);
    }
  }

  if (!Number.isInteger(options.count) || options.count < 1) {
    throw new Error('--count must be a positive integer');
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error('--concurrency must be a positive integer');
  }
  if (options.lock.length > 0 && options.only.length > 0) {
    throw new Error('--lock and --only are mutually exclusive');
  }

  return options;
}

/**
 * --only is the inverse of --lock: everything not listed gets locked.
 */
function resolveLockedCategories(options, categoryNames) {
  if (options.only.length > 0) {
    const vary = new Set(options.only);
    const unknown = options.only.filter(name => !categoryNames.includes(name));
    if (unknown.length > 0) {
      throw new Error(`--only references unknown categor(ies): ${unknown.join(', ')}`);
    }
    return categoryNames.filter(name => !vary.has(name));
  }

  const unknown = options.lock.filter(name => !categoryNames.includes(name));
  if (unknown.length > 0) {
    throw new Error(`--lock references unknown categor(ies): ${unknown.join(', ')}`);
  }
  return options.lock;
}

module.exports = { USAGE, DEFAULT_PRESET, splitList, parseArgs, resolveLockedCategories };
