/**
 * Secrets at rest and sessions.
 *
 * X access tokens are stored encrypted (AES-GCM) with a key derived from the
 * SECRET_KEY worker secret, so a copy of the database alone is useless.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text) {
  const s = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function derive(secret, purpose, usage) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
  const params = { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('x-poster'), info: enc.encode(purpose) };
  return usage === 'aes'
    ? crypto.subtle.deriveKey(params, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    : crypto.subtle.deriveKey(params, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
}

export async function seal(secret, plain) {
  const key = await derive(secret, 'tokens', 'aes');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  return `${b64url(iv)}.${b64url(body)}`;
}

export async function open(secret, sealed) {
  const [iv, body] = String(sealed || '').split('.');
  const key = await derive(secret, 'tokens', 'aes');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, key, fromB64url(body));
  return dec.decode(plain);
}

/** A signed, expiring session value for the admin cookie. */
export async function signSession(secret, ttlMs = 30 * 24 * 60 * 60 * 1000, now = Date.now()) {
  const key = await derive(secret, 'session', 'hmac');
  const payload = String(now + ttlMs);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(secret, value, now = Date.now()) {
  const [payload, sig] = String(value || '').split('.');
  if (!payload || !sig || !(Number(payload) > now)) return false;
  const key = await derive(secret, 'session', 'hmac');
  try {
    return await crypto.subtle.verify('HMAC', key, fromB64url(sig), enc.encode(payload));
  } catch {
    return false;
  }
}

/** Compare two strings without leaking where they differ. */
export async function sameText(a, b) {
  const [x, y] = await Promise.all([a, b].map((v) => crypto.subtle.digest('SHA-256', enc.encode(String(v || '')))));
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i += 1) diff |= u[i] ^ v[i];
  return diff === 0;
}

/** PKCE pair for the X OAuth 2.0 sign-in. */
export async function pkcePair() {
  const verifier = randomToken(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
  return { verifier, challenge };
}
