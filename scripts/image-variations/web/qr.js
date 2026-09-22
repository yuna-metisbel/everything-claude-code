'use strict';

/**
 * A minimal QR encoder, enough to put a URL on screen for a phone camera.
 *
 * Scope is deliberately narrow: byte mode, error correction level L,
 * versions 1 to 5. Those versions hold one error-correction block each, so
 * there is no interleaving, and they predate the version-information blocks
 * that start at version 7. 106 bytes is well past what
 * `http://192.168.x.x:8787/?t=<32 hex>` needs.
 */

const MODE_BYTE = 0b0100;

// Per version (index 0 = version 1): total codewords, and the split at level L.
const VERSIONS = [
  { version: 1, total: 26, ecCodewords: 7, dataCodewords: 19 },
  { version: 2, total: 44, ecCodewords: 10, dataCodewords: 34 },
  { version: 3, total: 70, ecCodewords: 15, dataCodewords: 55 },
  { version: 4, total: 100, ecCodewords: 20, dataCodewords: 80 },
  { version: 5, total: 134, ecCodewords: 26, dataCodewords: 108 }
];

// Mode indicator (4 bits) plus the character count (8 bits in byte mode for
// versions 1-9) sit in front of the payload.
const HEADER_BYTES = 2;
const PAD_BYTES = [0xec, 0x11];
const FORMAT_MASK = 0x5412;
const ECC_LEVEL_L = 0b01;

/* ---------- GF(256) ---------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) {
      x ^= 0x11d; // the QR primitive polynomial
    }
  }
  for (let i = 255; i < 512; i++) {
    EXP[i] = EXP[i - 255];
  }
})();

function gfMultiply(a, b) {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

/**
 * Generator polynomial for `degree` error-correction codewords.
 */
function generatorPolynomial(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMultiply(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function errorCorrection(data, ecCodewords) {
  const generator = generatorPolynomial(ecCodewords);
  const remainder = new Array(ecCodewords).fill(0);

  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecCodewords; i++) {
      remainder[i] ^= gfMultiply(generator[i + 1], factor);
    }
  }
  return remainder;
}

/* ---------- encoding ---------- */

function pickVersion(byteLength) {
  const fit = VERSIONS.find(entry => byteLength + HEADER_BYTES <= entry.dataCodewords);
  if (!fit) {
    throw new Error(
      `qr: ${byteLength} bytes is too long for versions 1-5 ` +
      `(max ${VERSIONS[VERSIONS.length - 1].dataCodewords - HEADER_BYTES})`
    );
  }
  return fit;
}

function toCodewords(bytes, spec) {
  const bits = [];
  const push = (value, width) => {
    for (let i = width - 1; i >= 0; i--) {
      bits.push((value >> i) & 1);
    }
  };

  push(MODE_BYTE, 4);
  push(bytes.length, 8);
  for (const byte of bytes) {
    push(byte, 8);
  }

  // Terminator, then round up to a whole codeword.
  const capacityBits = spec.dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) {
    bits.push(0);
  }
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  while (codewords.length < spec.dataCodewords) {
    codewords.push(PAD_BYTES[codewords.length % 2 === spec.dataCodewords % 2 ? 0 : 1]);
  }

  return codewords.concat(errorCorrection(codewords, spec.ecCodewords));
}

/* ---------- matrix ---------- */

function createMatrix(size) {
  return {
    modules: Array.from({ length: size }, () => new Array(size).fill(0)),
    reserved: Array.from({ length: size }, () => new Array(size).fill(false)),
    size
  };
}

function placeFinder(matrix, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const y = row + r;
      const x = col + c;
      if (y < 0 || y >= matrix.size || x < 0 || x >= matrix.size) {
        continue;
      }
      const onRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      matrix.modules[y][x] = onRing || inCore ? 1 : 0;
      matrix.reserved[y][x] = true;
    }
  }
}

function placeAlignment(matrix, version) {
  if (version < 2) {
    return;
  }
  // Versions 2-6 carry exactly one alignment pattern, clear of the finders.
  const center = 4 * version + 10;
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const ring = Math.max(Math.abs(r), Math.abs(c));
      matrix.modules[center + r][center + c] = ring === 1 ? 0 : 1;
      matrix.reserved[center + r][center + c] = true;
    }
  }
}

function placeTimingAndReserved(matrix) {
  const { size } = matrix;

  for (let i = 8; i < size - 8; i++) {
    const bit = i % 2 === 0 ? 1 : 0;
    matrix.modules[6][i] = bit;
    matrix.reserved[6][i] = true;
    matrix.modules[i][6] = bit;
    matrix.reserved[i][6] = true;
  }

  // Format information, and the module that is always dark.
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      matrix.reserved[8][i] = true;
      matrix.reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    matrix.reserved[8][size - 1 - i] = true;
    matrix.reserved[size - 1 - i][8] = true;
  }
  matrix.modules[size - 8][8] = 1;
  matrix.reserved[size - 8][8] = true;
}

/**
 * Two modules wide, bottom-right upwards, turning at each edge and skipping
 * the vertical timing column.
 */
function placeData(matrix, codewords) {
  const bits = [];
  for (const byte of codewords) {
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >> i) & 1);
    }
  }

  let index = 0;
  let upward = true;
  let col = matrix.size - 1;

  while (col > 0) {
    if (col === 6) {
      col--;
    }
    for (let step = 0; step < matrix.size; step++) {
      const row = upward ? matrix.size - 1 - step : step;
      for (const x of [col, col - 1]) {
        if (!matrix.reserved[row][x]) {
          matrix.modules[row][x] = index < bits.length ? bits[index] : 0;
          index++;
        }
      }
    }
    upward = !upward;
    col -= 2;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  r => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

function applyMask(matrix, maskIndex) {
  const masked = createMatrix(matrix.size);
  const rule = MASKS[maskIndex];

  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      masked.reserved[r][c] = matrix.reserved[r][c];
      masked.modules[r][c] = matrix.reserved[r][c] || !rule(r, c)
        ? matrix.modules[r][c]
        : matrix.modules[r][c] ^ 1;
    }
  }
  return masked;
}

/**
 * The four penalty rules from the specification; lower is easier to scan.
 */
function penalty(matrix) {
  const { size, modules } = matrix;
  let score = 0;

  const runScore = line => {
    let total = 0;
    let run = 1;
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) {
        run++;
      } else {
        if (run >= 5) {
          total += 3 + (run - 5);
        }
        run = 1;
      }
    }
    return run >= 5 ? total + 3 + (run - 5) : total;
  };

  for (let i = 0; i < size; i++) {
    score += runScore(modules[i]);
    score += runScore(modules.map(row => row[i]));
  }

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const first = modules[r][c];
      if (first === modules[r][c + 1] && first === modules[r + 1][c] && first === modules[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  const FINDER_LIKE = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const matches = (line, start) => FINDER_LIKE.every((bit, offset) => line[start + offset] === bit);
  for (let i = 0; i < size; i++) {
    const row = modules[i];
    const column = modules.map(line => line[i]);
    for (let start = 0; start + FINDER_LIKE.length <= size; start++) {
      if (matches(row, start)) score += 40;
      if (matches(column, start)) score += 40;
      if (matches([...row].reverse(), start)) score += 40;
      if (matches([...column].reverse(), start)) score += 40;
    }
  }

  const dark = modules.flat().filter(bit => bit === 1).length;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

function formatBits(maskIndex) {
  const data = (ECC_LEVEL_L << 3) | maskIndex;
  let remainder = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((remainder >> i) & 1) {
      remainder ^= 0b10100110111 << (i - 10);
    }
  }
  return ((data << 10) | remainder) ^ FORMAT_MASK;
}

function placeFormat(matrix, maskIndex) {
  const bits = formatBits(maskIndex);
  const { size } = matrix;

  for (let i = 0; i < 15; i++) {
    const bit = (bits >> i) & 1;

    if (i < 6) {
      matrix.modules[i][8] = bit;
    } else if (i < 8) {
      matrix.modules[i + 1][8] = bit;
    } else if (i === 8) {
      matrix.modules[8][7] = bit;
    } else {
      matrix.modules[8][14 - i] = bit;
    }

    if (i < 8) {
      matrix.modules[8][size - 1 - i] = bit;
    } else {
      matrix.modules[size - 15 + i][8] = bit;
    }
  }

  matrix.modules[size - 8][8] = 1;
}

/**
 * Encode `text` and return the module grid as an array of 0/1 rows.
 */
function encode(text) {
  const bytes = Buffer.from(String(text), 'utf8');
  const spec = pickVersion(bytes.length);
  const codewords = toCodewords(bytes, spec);

  const base = createMatrix(17 + 4 * spec.version);
  placeFinder(base, 0, 0);
  placeFinder(base, 0, base.size - 7);
  placeFinder(base, base.size - 7, 0);
  placeAlignment(base, spec.version);
  placeTimingAndReserved(base);
  placeData(base, codewords);

  let best = null;
  for (let maskIndex = 0; maskIndex < MASKS.length; maskIndex++) {
    const candidate = applyMask(base, maskIndex);
    placeFormat(candidate, maskIndex);
    const score = penalty(candidate);
    if (!best || score < best.score) {
      best = { score, modules: candidate.modules, maskIndex, version: spec.version };
    }
  }

  return best;
}

/**
 * Render for a terminal.
 *
 * Two spaces per module, coloured by background only. Terminals paint the
 * background across the whole line height, so the modules tile with no seam;
 * a block glyph would leave the line spacing unpainted and slice every row
 * in half, which no scanner forgives. Two cells wide against one cell tall
 * also lands close to square, since a character cell is about twice as tall
 * as it is wide.
 */
const DARK = '\u001b[40m';
const LIGHT = '\u001b[47m';
const RESET = '\u001b[0m';

function renderBlocks(modules, quietZone) {
  const size = modules.length;
  const padded = size + quietZone * 2;
  const at = (row, col) => {
    const r = row - quietZone;
    const c = col - quietZone;
    return r >= 0 && r < size && c >= 0 && c < size ? modules[r][c] : 0;
  };

  const lines = [];
  for (let row = 0; row < padded; row++) {
    let line = '';
    let current = null;
    for (let col = 0; col < padded; col++) {
      const colour = at(row, col) ? DARK : LIGHT;
      if (colour !== current) {
        line += colour;
        current = colour;
      }
      line += '  ';
    }
    lines.push(line + RESET);
  }
  return lines.join('\n');
}

/**
 * Half the width and a quarter of the area, for a terminal too narrow for
 * the other one. Block glyphs make this vulnerable to line spacing, so it
 * is the fallback rather than the default.
 */
function renderCompact(modules, quietZone) {
  const size = modules.length;
  const padded = size + quietZone * 2;
  const at = (row, col) => {
    const r = row - quietZone;
    const c = col - quietZone;
    return r >= 0 && r < size && c >= 0 && c < size ? modules[r][c] : 0;
  };

  const lines = [];
  for (let row = 0; row < padded; row += 2) {
    let line = '\u001b[30;47m';
    for (let col = 0; col < padded; col++) {
      const top = at(row, col);
      const bottom = row + 1 < padded ? at(row + 1, col) : 0;
      if (top && bottom) line += '\u2588';
      else if (top) line += '\u2580';
      else if (bottom) line += '\u2584';
      else line += ' ';
    }
    lines.push(`${line}${RESET}`);
  }
  return lines.join('\n');
}

/**
 * Columns the default rendering needs, quiet zone included.
 */
function renderedWidth(text, { quietZone = 4 } = {}) {
  return (encode(text).modules.length + quietZone * 2) * 2;
}

function render(text, { quietZone = 4, style = 'blocks' } = {}) {
  const { modules } = encode(text);
  return style === 'compact'
    ? renderCompact(modules, quietZone)
    : renderBlocks(modules, quietZone);
}

module.exports = {
  VERSIONS,
  gfMultiply,
  generatorPolynomial,
  errorCorrection,
  pickVersion,
  toCodewords,
  formatBits,
  encode,
  render,
  renderedWidth
};
