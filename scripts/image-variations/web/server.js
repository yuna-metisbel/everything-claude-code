#!/usr/bin/env node
'use strict';

/**
 * Local server for the image-variations PWA.
 *
 * Start it on the machine that holds XAI_API_KEY; the browser (this machine
 * or a phone on the same network) talks only to this process.
 *
 *   node scripts/image-variations/web/server.js
 *   node scripts/image-variations/web/server.js --host 0.0.0.0 --port 8787
 */

const http = require('http');
const crypto = require('crypto');
const path = require('path');

const { handleApiRequest, HttpError, MAX_BODY_BYTES } = require('./api');
const { serveStatic } = require('./static');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_PRESETS_DIR = path.join(__dirname, '..', 'presets');
const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const TOKEN_HEADER = 'x-ecc-token';

const USAGE = `image-variations web server

Usage: node scripts/image-variations/web/server.js [options]

Options:
  -p, --port <n>        Port to listen on (default: ${DEFAULT_PORT})
      --host <addr>     Address to bind (default: ${DEFAULT_HOST}, loopback only)
                        Use 0.0.0.0 to reach it from a phone on the same network.
      --presets <dir>   Directory of preset JSON files (default: ../presets)
      --token <value>   Fixed access token for non-loopback binds (default: random)
  -h, --help            Show this help

The xAI key is read from XAI_API_KEY (or GROK_API_KEY) and never leaves
this process.
`;

function parseServerArgs(argv) {
  const options = {
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    presets: DEFAULT_PRESETS_DIR,
    token: '',
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error(`${arg} needs a value`);
      }
      return value;
    };

    switch (arg) {
      case '-p':
      case '--port': {
        const port = Number(next());
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error('--port must be an integer between 1 and 65535');
        }
        options.port = port;
        break;
      }
      case '--host':
        options.host = next();
        break;
      case '--presets':
        options.presets = path.resolve(next());
        break;
      case '--token':
        options.token = next();
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  return options;
}

function readApiKey() {
  return process.env.XAI_API_KEY || process.env.GROK_API_KEY || '';
}

function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new HttpError(400, `invalid JSON body: ${error.message}`));
      }
    });

    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

function createServer({ presetsDir = DEFAULT_PRESETS_DIR, apiKey = '', token = '', fetchImpl } = {}) {
  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      sendJson(res, 400, { error: 'malformed request URL' });
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      serveStatic(PUBLIC_DIR, url.pathname, res);
      return;
    }

    try {
      if (token && req.headers[TOKEN_HEADER] !== token) {
        throw new HttpError(401, 'missing or invalid access token');
      }

      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const result = await handleApiRequest({
        method: req.method,
        pathname: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body,
        presetsDir,
        apiKey,
        fetchImpl
      });

      sendJson(res, result.status, result.body);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      // A known gateway failure is one log line; only a genuine bug gets a stack.
      if (status === 502) {
        process.stderr.write(`[image-variations] upstream: ${error.message}\n`);
      } else if (status >= 500) {
        process.stderr.write(`[image-variations] ${error.stack || error.message}\n`);
      }
      if (!res.headersSent) {
        sendJson(res, status, { error: error.message });
      }
    }
  });
}

function banner({ host, port, token, apiKey }) {
  const lines = [];
  const exposed = !LOOPBACK_HOSTS.has(host);
  const shown = host === '0.0.0.0' ? '<this-machine-lan-ip>' : host;
  const query = token ? `/?t=${token}` : '/';

  lines.push(`[image-variations] listening on http://${shown}:${port}${query}`);

  if (!apiKey) {
    lines.push('[image-variations] warning: XAI_API_KEY is not set - planning works, generating will fail');
  }

  if (exposed) {
    lines.push('[image-variations] bound beyond loopback: the access token above is required for /api/*');
    lines.push('[image-variations] note: over plain http on a LAN address browsers refuse to install the PWA');
    lines.push('[image-variations]       (service workers need a secure context) - the page itself still works');
  }

  return lines.join('\n');
}

function main() {
  let options;
  try {
    options = parseServerArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  const apiKey = readApiKey();
  const exposed = !LOOPBACK_HOSTS.has(options.host);
  const token = exposed ? (options.token || crypto.randomBytes(16).toString('hex')) : options.token;

  const server = createServer({ presetsDir: options.presets, apiKey, token });

  server.on('error', error => {
    process.stderr.write(`[image-variations] ${error.message}\n`);
    process.exitCode = 1;
  });

  server.listen(options.port, options.host, () => {
    process.stdout.write(`${banner({ host: options.host, port: options.port, token, apiKey })}\n`);
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  USAGE,
  DEFAULT_PORT,
  DEFAULT_HOST,
  TOKEN_HEADER,
  parseServerArgs,
  readApiKey,
  readJsonBody,
  createServer,
  banner
};
