'use strict';

/**
 * Static file serving for the image-variations PWA shell.
 *
 * Everything under public/ is public by design; the only thing worth
 * defending here is the path itself, so a request can never escape the
 * root and read the presets, the config or anything else on disk.
 */

const fs = require('fs');
const path = require('path');

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

/**
 * Map a URL path to a file inside rootDir, or null when it would escape.
 */
function resolveStaticPath(rootDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }

  if (decoded.includes('\0')) {
    return null;
  }

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, relative);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

function contentTypeFor(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/**
 * The service worker must not be cached, or an update never reaches the
 * installed app. Everything else is small enough to revalidate each time.
 */
function cacheControlFor(filePath) {
  return path.basename(filePath) === 'sw.js' ? 'no-cache' : 'no-cache';
}

function serveStatic(rootDir, urlPath, res) {
  const filePath = resolveStaticPath(rootDir, urlPath);

  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found\n');
    return false;
  }

  res.writeHead(200, {
    'Content-Type': contentTypeFor(filePath),
    'Cache-Control': cacheControlFor(filePath)
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

module.exports = { MIME_BY_EXT, resolveStaticPath, contentTypeFor, serveStatic };
