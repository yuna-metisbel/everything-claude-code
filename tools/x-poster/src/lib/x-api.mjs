/**
 * The X API, through the official OAuth 2.0 user sign-in. Each account grants
 * this app permission once on X's own screen; no password is ever held here.
 */

export const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'];
const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const API = 'https://api.x.com/2';

export function authorizeUrl({ clientId, redirectUri, state, challenge }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${params}`;
}

function basicAuth(clientId, clientSecret) {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

/** A short, readable reason from an X error body. */
export function errorText(status, body) {
  const first = body && Array.isArray(body.errors) ? body.errors[0] : null;
  const detail =
    (body && (body.detail || body.error_description || body.title || body.error)) ||
    (first && (first.message || first.detail)) ||
    (body && body.raw) ||
    '';
  const hints = {
    401: '連携が切れています。管理画面からもう一度連携してください',
    402: 'X API のクレジットが足りません',
    403: 'X に投稿を断られました',
    429: '投稿の回数制限です。少し時間をおいてください',
  };
  return [hints[status], detail].filter(Boolean).join(' / ') || `HTTP ${status}`;
}

async function tokenRequest(fetchImpl, { clientId, clientSecret }, form) {
  const res = await fetchImpl(`${API}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth(clientId, clientSecret),
    },
    body: new URLSearchParams({ client_id: clientId, ...form }),
  });
  const body = await readJson(res);
  if (!res.ok || !body.access_token) return { ok: false, error: errorText(res.status, body) };
  return {
    ok: true,
    accessToken: body.access_token,
    refreshToken: body.refresh_token || '',
    expiresAt: Date.now() + (Number(body.expires_in) || 7200) * 1000,
  };
}

export function exchangeCode(fetchImpl, app, { code, verifier, redirectUri }) {
  return tokenRequest(fetchImpl, app, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
}

export function refreshToken(fetchImpl, app, refresh) {
  return tokenRequest(fetchImpl, app, { grant_type: 'refresh_token', refresh_token: refresh });
}

export async function getMe(fetchImpl, accessToken) {
  const res = await fetchImpl(`${API}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await readJson(res);
  if (!res.ok || !body.data) return { ok: false, error: errorText(res.status, body) };
  return { ok: true, id: body.data.id, handle: body.data.username, name: body.data.name };
}

export async function createPost(fetchImpl, accessToken, text) {
  const res = await fetchImpl(`${API}/tweets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const body = await readJson(res);
  if (!res.ok || !body.data) return { ok: false, status: res.status, error: errorText(res.status, body) };
  return { ok: true, id: body.data.id };
}
