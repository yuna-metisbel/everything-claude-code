#!/usr/bin/env node
'use strict';

/**
 * Regenerate the PWA icons in public/icons.
 *
 * The icons are committed, so this only needs running when the artwork
 * changes. Encoding the PNG by hand keeps the tool dependency-free.
 *
 *   node scripts/image-variations/web/make-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, 'public', 'icons');

const BACKGROUND = [17, 20, 32, 255];
const TILES = [
  [167, 139, 250, 255],
  [244, 114, 182, 255],
  [56, 189, 248, 255],
  [74, 222, 128, 255]
];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;  // bit depth
  header[9] = 6;  // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // One filter byte (0 = None) in front of every scanline.
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * Distance from a point to a rounded rectangle, used to antialias the edges.
 */
function roundedRectDistance(x, y, left, top, right, bottom, radius) {
  const dx = Math.max(left + radius - x, 0, x - (right - radius));
  const dy = Math.max(top + radius - y, 0, y - (bottom - radius));
  return Math.hypot(dx, dy) - radius;
}

function blend(target, offset, colour, alpha) {
  for (let channel = 0; channel < 3; channel++) {
    target[offset + channel] = Math.round(
      target[offset + channel] * (1 - alpha) + colour[channel] * alpha
    );
  }
  target[offset + 3] = Math.round(target[offset + 3] * (1 - alpha) + colour[3] * alpha);
}

/**
 * A 2x2 grid of coloured tiles on a rounded dark square: four variations of
 * one thing, which is what the tool produces.
 */
function drawIcon(size, { padding = 0 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const inset = size * padding;
  const plateRadius = (size - inset * 2) * 0.22;
  const gap = size * 0.06;
  const tileArea = (size - inset * 2) - gap * 3;
  const tileSize = tileArea / 2;
  const tileRadius = tileSize * 0.26;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;

      const plate = roundedRectDistance(px, py, inset, inset, size - inset, size - inset, plateRadius);
      blend(rgba, offset, BACKGROUND, Math.min(Math.max(0.5 - plate, 0), 1));

      for (let tile = 0; tile < 4; tile++) {
        const col = tile % 2;
        const row = Math.floor(tile / 2);
        const left = inset + gap + col * (tileSize + gap);
        const top = inset + gap + row * (tileSize + gap);
        const distance = roundedRectDistance(
          px, py, left, top, left + tileSize, top + tileSize, tileRadius
        );
        blend(rgba, offset, TILES[tile], Math.min(Math.max(0.5 - distance, 0), 1));
      }
    }
  }

  return encodePng(size, size, rgba);
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const targets = [
    ['icon-192.png', 192, {}],
    ['icon-512.png', 512, {}],
    // Maskable icons lose up to 20% on each edge to the platform's mask.
    ['icon-maskable-512.png', 512, { padding: 0.12 }]
  ];

  for (const [name, size, options] of targets) {
    const target = path.join(OUT_DIR, name);
    fs.writeFileSync(target, drawIcon(size, options));
    process.stdout.write(`wrote ${path.relative(process.cwd(), target)}\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { crc32, pngChunk, encodePng, drawIcon };
