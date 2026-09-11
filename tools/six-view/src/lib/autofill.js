'use strict';

/**
 * Login auto-fill script generation (pure module - no Electron imports).
 *
 * The generated script is executed inside the guest page by the MAIN process,
 * so credentials never travel through the renderer.
 */

// `<` plus the two line separators JSON.stringify leaves raw (U+2028/U+2029).
const UNSAFE_JS_CHARS = new RegExp('[<' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');

/** Embed a value as a JavaScript literal that is safe to splice into source. */
function jsLiteral(value) {
  return JSON.stringify(value === undefined ? null : value).replace(
    UNSAFE_JS_CHARS,
    (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
  );
}

/**
 * Does this URL look like the login page for the site?
 *
 * - empty pattern  -> match any http(s) URL on the site
 * - `/regex/flags` -> treated as a regular expression
 * - anything else  -> case-insensitive substring match
 */
function matchesUrlPattern(pattern, url) {
  if (typeof url !== 'string' || !url) return false;
  const trimmed = typeof pattern === 'string' ? pattern.trim() : '';
  if (!trimmed) return /^https?:\/\//i.test(url);

  const regexMatch = /^\/(.*)\/([a-z]*)$/is.exec(trimmed);
  if (regexMatch) {
    try {
      return new RegExp(regexMatch[1], regexMatch[2]).test(url);
    } catch {
      return false;
    }
  }

  return url.toLowerCase().includes(trimmed.toLowerCase());
}

/** Should we attempt auto-fill for this navigation? */
function shouldAutofill(site, url, credentials) {
  if (!site || !site.autofill || !site.autofill.enabled) return false;
  if (!credentials || !credentials.username) return false;
  if (!site.autofill.usernameSelector && !site.autofill.passwordSelector) return false;
  return matchesUrlPattern(site.autofill.urlPattern, url);
}

/**
 * Build the JS injected into the page.
 *
 * Returns a self-invoking async expression resolving to
 * `{ status, filled, submitted, reason }` so the caller can report back.
 */
function buildAutofillScript(autofill, credentials) {
  const options = {
    usernameSelector: (autofill && autofill.usernameSelector) || '',
    passwordSelector: (autofill && autofill.passwordSelector) || '',
    submitSelector: (autofill && autofill.submitSelector) || '',
    autoSubmit: Boolean(autofill && autofill.autoSubmit),
    delayMs: Math.max(0, Number((autofill && autofill.delayMs) || 0)),
    username: (credentials && credentials.username) || '',
    password: (credentials && credentials.password) || '',
  };

  return `(async () => {
  const opts = ${jsLiteral(options)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitFor = async (selector, timeoutMs) => {
    if (!selector) return null;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let el = null;
      try { el = document.querySelector(selector); } catch (_) { return null; }
      if (el) return el;
      if (Date.now() > deadline) return null;
      await sleep(120);
    }
  };

  // Use the native value setter so React/Vue controlled inputs notice the change.
  const setValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) { desc.set.call(el, value); } else { el.value = value; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  if (opts.delayMs) await sleep(opts.delayMs);

  const userEl = await waitFor(opts.usernameSelector, 8000);
  const passEl = await waitFor(opts.passwordSelector, 4000);

  if (!userEl && !passEl) {
    return { status: 'skipped', filled: 0, submitted: false, reason: 'no-field' };
  }

  let filled = 0;
  if (userEl && opts.username) { userEl.focus(); setValue(userEl, opts.username); filled += 1; }
  if (passEl && opts.password) { passEl.focus(); setValue(passEl, opts.password); filled += 1; }

  let submitted = false;
  if (opts.autoSubmit && filled > 0) {
    await sleep(200);
    let submitEl = null;
    if (opts.submitSelector) submitEl = await waitFor(opts.submitSelector, 2000);
    if (submitEl) {
      submitEl.click();
      submitted = true;
    } else {
      const form = (passEl && passEl.form) || (userEl && userEl.form);
      if (form) {
        if (typeof form.requestSubmit === 'function') { form.requestSubmit(); } else { form.submit(); }
        submitted = true;
      }
    }
  }

  return { status: filled > 0 ? 'filled' : 'skipped', filled, submitted, reason: '' };
})();`;
}

module.exports = {
  buildAutofillScript,
  jsLiteral,
  matchesUrlPattern,
  shouldAutofill,
};
