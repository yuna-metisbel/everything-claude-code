'use strict';
const assert = require('assert');
const crypto = require('crypto');

const qr = require('../../scripts/image-variations/web/qr');

console.log('=== Testing image-variations/web/qr.js ===\n');

let passed = 0;
let failed = 0;

function test(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${desc}: ${e.message}`);
    failed++;
  }
}

// The escape is assembled at runtime; spelled out, it trips no-control-regex.
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

function stripAnsi(text) {
  return text.replace(ANSI, '');
}

function fingerprint(modules) {
  return crypto.createHash('sha256')
    .update(modules.map(row => row.join('')).join(''))
    .digest('hex')
    .slice(0, 16);
}

console.log('galois field:');

test('multiplication is commutative and absorbs zero', () => {
  assert.strictEqual(qr.gfMultiply(0, 123), 0);
  assert.strictEqual(qr.gfMultiply(123, 0), 0);
  assert.strictEqual(qr.gfMultiply(7, 11), qr.gfMultiply(11, 7));
});
test('one is the identity', () => {
  for (const value of [1, 2, 37, 128, 255]) {
    assert.strictEqual(qr.gfMultiply(value, 1), value);
  }
});
test('the generator polynomial has one more term than its degree', () => {
  for (const degree of [7, 10, 15, 20, 26]) {
    assert.strictEqual(qr.generatorPolynomial(degree).length, degree + 1);
    assert.strictEqual(qr.generatorPolynomial(degree)[0], 1, 'it should be monic');
  }
});
test('error correction produces exactly the requested codeword count', () => {
  assert.strictEqual(qr.errorCorrection([1, 2, 3], 7).length, 7);
  assert.strictEqual(qr.errorCorrection(new Array(80).fill(0x41), 20).length, 20);
});

console.log('\nversion selection:');

test('picks the smallest version that fits', () => {
  assert.strictEqual(qr.pickVersion(1).version, 1);
  assert.strictEqual(qr.pickVersion(17).version, 1);
  assert.strictEqual(qr.pickVersion(18).version, 2);
  assert.strictEqual(qr.pickVersion(32).version, 2);
  assert.strictEqual(qr.pickVersion(33).version, 3);
  assert.strictEqual(qr.pickVersion(53).version, 3);
  assert.strictEqual(qr.pickVersion(78).version, 4);
  assert.strictEqual(qr.pickVersion(106).version, 5);
});
test('refuses a payload beyond version 5', () => {
  assert.throws(() => qr.pickVersion(107), /too long for versions 1-5/);
});
test('a token-carrying LAN URL still fits', () => {
  const url = `http://192.168.100.100:65535/?t=${'f'.repeat(32)}`;
  assert.ok(url.length <= 106, `the url grew to ${url.length} bytes`);
  assert.ok(qr.pickVersion(url.length).version <= 5);
});

console.log('\ncodewords:');

test('fills the data capacity exactly, error correction included', () => {
  for (const spec of qr.VERSIONS) {
    const codewords = qr.toCodewords(Buffer.from('x'.repeat(10)), spec);
    assert.strictEqual(codewords.length, spec.total, `version ${spec.version}`);
  }
});
test('starts with the byte-mode indicator and the length', () => {
  const spec = qr.pickVersion(5);
  const codewords = qr.toCodewords(Buffer.from('HELLO'), spec);
  // 0100 mode, then the 8-bit count 5 -> 0x40, 0x54
  assert.strictEqual(codewords[0], 0x40);
  assert.strictEqual(codewords[1], 0x54);
});

console.log('\nformat information:');

test('is fifteen bits for every mask', () => {
  for (let mask = 0; mask < 8; mask++) {
    const bits = qr.formatBits(mask);
    assert.ok(bits >= 0 && bits < (1 << 15), `mask ${mask} produced ${bits}`);
  }
});
test('differs between masks', () => {
  const seen = new Set();
  for (let mask = 0; mask < 8; mask++) {
    seen.add(qr.formatBits(mask));
  }
  assert.strictEqual(seen.size, 8);
});
test('round-trips back to level L and the mask it was built from', () => {
  // Undo the fixed 0x5412 mask and read the five data bits back, rather than
  // pinning remembered constants: 01 is level L, then the mask index.
  for (let mask = 0; mask < 8; mask++) {
    const raw = qr.formatBits(mask) ^ 0x5412;
    assert.strictEqual((raw >> 13) & 0b11, 0b01, `mask ${mask} lost the ECC level`);
    assert.strictEqual((raw >> 10) & 0b111, mask, `mask ${mask} lost its index`);
  }
});
test('leaves a remainder the BCH generator divides', () => {
  for (let mask = 0; mask < 8; mask++) {
    let value = qr.formatBits(mask) ^ 0x5412;
    for (let i = 14; i >= 10; i--) {
      if ((value >> i) & 1) {
        value ^= 0b10100110111 << (i - 10);
      }
    }
    assert.strictEqual(value, 0, `mask ${mask} is not a valid BCH codeword`);
  }
});

console.log('\nmatrix:');

test('is the right size for its version', () => {
  assert.strictEqual(qr.encode('a').modules.length, 21);
  assert.strictEqual(qr.encode('a'.repeat(20)).modules.length, 25);
  assert.strictEqual(qr.encode('a'.repeat(60)).modules.length, 33);
});
test('is square and holds only 0 or 1', () => {
  const { modules } = qr.encode('http://192.168.1.23:8787/');
  for (const row of modules) {
    assert.strictEqual(row.length, modules.length);
    for (const bit of row) {
      assert.ok(bit === 0 || bit === 1, `unexpected module ${bit}`);
    }
  }
});
test('carries a finder pattern in three corners', () => {
  const { modules } = qr.encode('http://192.168.1.23:8787/');
  const size = modules.length;
  const finderAt = (top, left) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const onRing = r === 0 || r === 6 || c === 0 || c === 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        const expected = onRing || inCore ? 1 : 0;
        if (modules[top + r][left + c] !== expected) {
          return false;
        }
      }
    }
    return true;
  };
  assert.ok(finderAt(0, 0), 'top left');
  assert.ok(finderAt(0, size - 7), 'top right');
  assert.ok(finderAt(size - 7, 0), 'bottom left');
});
test('alternates along both timing patterns', () => {
  const { modules } = qr.encode('http://192.168.1.23:8787/');
  for (let i = 8; i < modules.length - 8; i++) {
    assert.strictEqual(modules[6][i], i % 2 === 0 ? 1 : 0, `row timing at ${i}`);
    assert.strictEqual(modules[i][6], i % 2 === 0 ? 1 : 0, `column timing at ${i}`);
  }
});
test('keeps the always-dark module set', () => {
  const { modules } = qr.encode('hello there');
  assert.strictEqual(modules[modules.length - 8][8], 1);
});
test('is deterministic', () => {
  assert.strictEqual(fingerprint(qr.encode('HELLO').modules), fingerprint(qr.encode('HELLO').modules));
});

// Frozen from output verified against an independent QR decoder (jsQR), which
// read back the exact input for every version 1-5 including each capacity
// boundary. A change here means the encoder changed; re-verify before updating.
test('still produces the grid a real decoder accepted', () => {
  assert.strictEqual(fingerprint(qr.encode('HELLO').modules), '7a381bcb34d02f3a');
  assert.strictEqual(
    fingerprint(qr.encode('http://192.168.1.23:8787/?t=0123456789abcdef0123456789abcdef').modules),
    'f21342b49f20d190'
  );
});

console.log('\nrendering:');

test('draws a quiet zone around the symbol', () => {
  const lines = qr.render('HELLO').split('\n');
  const plain = lines.map(line => stripAnsi(line));
  assert.ok(/^ +$/.test(plain[0]), 'the first row should be blank');
  assert.ok(/^ +$/.test(plain[plain.length - 1]), 'the last row should be blank');
  assert.ok(plain.every(line => line.startsWith('    ')), 'every row needs a left margin');
});
test('is one character per module wide, two modules per line', () => {
  const { modules } = qr.encode('HELLO');
  const plain = qr.render('HELLO').split('\n').map(l => stripAnsi(l));
  const padded = modules.length + 8;
  assert.strictEqual(plain[0].length, padded);
  assert.strictEqual(plain.length, Math.ceil(padded / 2));
});
test('sets an explicit black-on-white so the polarity does not depend on the theme', () => {
  const line = qr.render('HELLO').split('\n')[0];
  assert.ok(line.startsWith(`${ESC}[30;47m`), 'each line should open black-on-white');
  assert.ok(line.endsWith(`${ESC}[0m`), 'and reset at the end');
});
test('uses only block characters and spaces', () => {
  const plain = stripAnsi(qr.render('HELLO')).replace(/\n/g, '');
  assert.match(plain, /^[▀▄█ ]+$/);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
