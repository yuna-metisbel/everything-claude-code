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
const os = require('os');
const path = require('path');

const qr = require('./qr');

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
      --no-qr           Do not print a QR code for the address
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
    qr: true,
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
      case '--no-qr':
        options.qr = false;
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

/**
 * Every IPv4 address this machine answers on beyond loopback - which is
 * what another device on the same network has to type.
 */
function lanAddresses(interfaces = os.networkInterfaces()) {
  const addresses = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      const family = entry.family === 4 || entry.family === 'IPv4';
      if (family && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

/**
 * Where the app can be reached. Binding to 0.0.0.0 means every interface,
 * so the wildcard is expanded into the addresses someone could actually use.
 */
function reachableUrls({ host, port, token, addresses = lanAddresses() }) {
  const query = token ? `/?t=${token}` : '/';
  const hosts = host === '0.0.0.0' || host === '::'
    ? ['127.0.0.1', ...addresses]
    : [host];
  return hosts.map(entry => `http://${entry}:${port}${query}`);
}

function banner({ host, port, token, apiKey, addresses = lanAddresses(), qrCode = true }) {
  const lines = [];
  const exposed = !LOOPBACK_HOSTS.has(host);
  const urls = reachableUrls({ host, port, token, addresses });

  for (const url of urls) {
    lines.push(`[image-variations] listening on ${url}`);
  }

  if (!apiKey) {
    lines.push('[image-variations] warning: XAI_API_KEY is not set - planning works, generating will fail');
  }

  if (exposed) {
    const lan = urls.find(url => !url.includes('127.0.0.1'));

    if (!lan) {
      lines.push('[image-variations] no non-loopback address found - is this machine on a network?');
    } else if (qrCode) {
      lines.push('');
      lines.push('[image-variations] scan from a phone on the same network:');
      lines.push('');
      try {
        lines.push(qr.render(lan));
      } catch (error) {
        lines.push(`[image-variations] (could not draw the QR code: ${error.message})`);
      }
      lines.push('');
    }

    lines.push('[image-variations] the access token in that URL is required for /api/* - treat it as the password');
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
    process.stdout.write(`${banner({
      host: options.host,
      port: options.port,
      token,
      apiKey,
      qrCode: options.qr
    })}\n`);
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
  lanAddresses,
  reachableUrls,
  readJsonBody,
  createServer,
  banner
};
