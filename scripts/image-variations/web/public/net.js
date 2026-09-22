/**
 * Talking to the local image-variations server.
 *
 * When the server is bound beyond loopback it issues an access token and
 * prints a URL carrying it. The token is kept per-origin in localStorage so
 * the query string only has to be used once.
 */

const TOKEN_KEY = 'image-variations.token';

function readStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function storeToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private mode and blocked storage are fine: the token stays in memory.
  }
}

let token = readStoredToken();

/**
 * Pick up ?t=... once, then drop it from the address bar so the token is
 * not left sitting in history or in a shared screenshot.
 */
export function adoptTokenFromUrl(location = window.location, history = window.history) {
  const url = new URL(location.href);
  const fromQuery = url.searchParams.get('t');
  if (!fromQuery) {
    return token;
  }

  token = fromQuery;
  storeToken(token);
  url.searchParams.delete('t');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  return token;
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (token) {
    headers['x-ecc-token'] = token;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (error) {
    throw new Error(`cannot reach the local server - is it still running? (${error.message})`);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `${response.status} ${response.statusText}`);
  }
  return payload;
}

export const listPresets = () => request('api/presets');

export const getConfig = preset => request(`api/config?preset=${encodeURIComponent(preset)}`);

export const plan = options => request('api/plan', { method: 'POST', body: options });

export const generateOne = options => request('api/generate-one', { method: 'POST', body: options });
