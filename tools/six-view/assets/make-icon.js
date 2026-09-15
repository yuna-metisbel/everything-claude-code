#!/usr/bin/env node
'use strict';

/**
 * Generates the app icons (1024x1024) - a dark rounded square holding a pane
 * grid. Run with: node assets/make-icon.js
 *
 * icon.png    SixView  - 3 x 2 grid, cool palette
 * icon-02.png 02View   - 3 x 3 grid, warm palette
 *
 * Hand-rolled PNG writer so the repo needs no image dependencies.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Signed distance to a rounded rectangle, used for anti-aliased edges. */
function roundedRectDistance(px, py, x, y, w, h, radius) {
  const cx = Math.max(x + radius, Math.min(px, x + w - radius));
  const cy = Math.max(y + radius, Math.min(py, y + h - radius));
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy) - radius;
}

function coverage(distance) {
  return Math.max(0, Math.min(1, 0.5 - distance));
}

function blend(target, offset, color, alpha) {
  if (alpha <= 0) return;
  for (let i = 0; i < 3; i += 1) {
    target[offset + i] = Math.round(target[offset + i] * (1 - alpha) + color[i] * alpha);
  }
  target[offset + 3] = Math.round(target[offset + 3] * (1 - alpha) + 255 * alpha);
}

function render({ paneColors, rows }) {
  const pixels = Buffer.alloc(SIZE * SIZE * 4, 0);

  const background = [26, 29, 38];

  const marginX = 96;
  const gap = 36;
  const cellW = (SIZE - marginX * 2 - gap * 2) / 3;
  const cellH = rows === 3 ? cellW * 0.72 : cellW * 0.78;
  const boardTop = (SIZE - (cellH * rows + gap * (rows - 1))) / 2;

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const offset = (y * SIZE + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;

      blend(pixels, offset, background, coverage(roundedRectDistance(px, py, 24, 24, SIZE - 48, SIZE - 48, 200)));

      for (let index = 0; index < paneColors.length; index += 1) {
        const col = index % 3;
        const row = Math.floor(index / 3);
        const cellX = marginX + col * (cellW + gap);
        const cellY = boardTop + row * (cellH + gap);
        blend(
          pixels,
          offset,
          paneColors[index],
          coverage(roundedRectDistance(px, py, cellX, cellY, cellW, cellH, 26))
        );
      }
    }
  }

  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (SIZE * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ICONS = [
  {
    file: 'icon.png',
    rows: 2,
    paneColors: [
      [79, 140, 255],
      [109, 163, 255],
      [61, 220, 151],
      [255, 193, 77],
      [199, 170, 255],
      [255, 107, 107],
    ],
  },
  {
    file: 'icon-02.png',
    rows: 3,
    paneColors: [
      [255, 145, 77],
      [255, 178, 71],
      [255, 107, 107],
      [236, 112, 170],
      [199, 120, 255],
      [140, 128, 255],
      [95, 160, 255],
      [61, 200, 190],
      [110, 214, 132],
    ],
  },
];

for (const icon of ICONS) {
  const outFile = path.join(__dirname, icon.file);
  fs.writeFileSync(outFile, render(icon));
  console.log(`wrote ${outFile}`);
}
