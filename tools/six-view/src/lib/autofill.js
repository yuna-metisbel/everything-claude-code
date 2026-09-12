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

  // `/.../flags` is a regex literal - but only when the trailing part is made
  // of real regex flags, so a plain path like `/admin/login` stays a substring.
  const regexMatch = /^\/(.*)\/([dgimsuvy]*)$/s.exec(trimmed);
  if (regexMatch) {
    try {
      return new RegExp(regexMatch[1], regexMatch[2]).test(url);
    } catch {
      // Fall through to substring matching rather than never matching.
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

  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const waitFor = async (selector, timeoutMs) => {
    if (!selector) return null;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let el = null;
      try { el = document.querySelector(selector); } catch (_) { return null; }
      if (el && visible(el)) return el;
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

  const advance = async (fromEl) => {
    let button = null;
    if (opts.submitSelector) button = await waitFor(opts.submitSelector, 1500);
    if (button) { button.click(); return true; }
    const form = fromEl && fromEl.form;
    if (form) {
      if (typeof form.requestSubmit === 'function') { form.requestSubmit(); } else { form.submit(); }
      return true;
    }
    // Multi-step sign-ins (X, Google, Microsoft) often have no form element.
    const fallback = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')]
      .filter(visible)
      .filter((el) => !el.disabled);
    if (fallback.length === 1) { fallback[0].click(); return true; }
    return false;
  };

  if (opts.delayMs) await sleep(opts.delayMs);

  const userEl = await waitFor(opts.usernameSelector, 8000);
  let passEl = await waitFor(opts.passwordSelector, userEl ? 3000 : 8000);

  if (!userEl && !passEl) {
    return { status: 'skipped', filled: 0, submitted: false, twoStep: false, reason: 'no-field' };
  }

  let filled = 0;
  if (userEl && opts.username) { userEl.focus(); setValue(userEl, opts.username); filled += 1; }

  // Two-step sign-in: the password field only appears after the ID is submitted.
  let twoStep = false;
  if (!passEl && filled > 0 && opts.passwordSelector && opts.password) {
    twoStep = true;
    await sleep(250);
    const advanced = await advance(userEl);
    if (!advanced) {
      return { status: 'partial', filled, submitted: false, twoStep, reason: 'no-next-button' };
    }
    passEl = await waitFor(opts.passwordSelector, 12000);
    if (!passEl) {
      return { status: 'partial', filled, submitted: false, twoStep, reason: 'no-password-step' };
    }
  }

  if (passEl && opts.password) { passEl.focus(); setValue(passEl, opts.password); filled += 1; }

  let submitted = false;
  if (opts.autoSubmit && passEl && opts.password) {
    await sleep(250);
    submitted = await advance(passEl);
  }

  return { status: filled > 0 ? 'filled' : 'skipped', filled, submitted, twoStep, reason: '' };
})();`;
}

/**
 * Build the JS that inspects a loaded page and reports CSS selectors for its
 * login form. Lets the user fill the selector fields with one click instead of
 * digging through developer tools.
 *
 * Resolves to `{ ok, usernameSelector, passwordSelector, submitSelector, path }`.
 */
function buildDetectScript() {
  return `(() => {
  const esc = (value) =>
    window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');

  const unique = (selector) => {
    try { return document.querySelectorAll(selector).length === 1; } catch (_) { return false; }
  };

  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  // Prefer a stable hook (id, then name); fall back to a structural path.
  const selectorFor = (el) => {
    if (!el) return '';
    if (el.id && unique('#' + esc(el.id))) return '#' + esc(el.id);

    const name = el.getAttribute('name');
    if (name) {
      const byName = el.tagName.toLowerCase() + '[name="' + name.replace(/["\\\\]/g, '\\\\$&') + '"]';
      if (unique(byName)) return byName;
    }

    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id && unique('#' + esc(node.id))) {
        parts.unshift('#' + esc(node.id));
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    const path = parts.join(' > ');
    return unique(path) ? path : '';
  };

  const textTypes = ['text', 'email', 'tel', 'number', ''];
  const textInputs = (root) =>
    [...root.querySelectorAll('input')].filter(
      (el) => visible(el) && textTypes.includes((el.getAttribute('type') || '').toLowerCase())
    );

  const submitIn = (root) =>
    [...root.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type]), [role="button"]')]
      .filter(visible)
      .filter((el) => !el.disabled)[0] || null;

  const passwordEl = [...document.querySelectorAll('input[type="password"]')].filter(visible)[0] || null;

  if (!passwordEl) {
    // Step 1 of a two-step sign-in (X, Google, Microsoft): ID field only.
    const candidates = textInputs(document);
    const preferred =
      candidates.find((el) => (el.getAttribute('autocomplete') || '').includes('username')) ||
      candidates.find((el) => /user|login|account|mail|id/i.test((el.getAttribute('name') || '') + (el.id || ''))) ||
      candidates.find((el) => (el.getAttribute('type') || '').toLowerCase() === 'email') ||
      candidates[0] ||
      null;

    if (!preferred) {
      return { ok: false, reason: 'no-login-field', usernameSelector: '', passwordSelector: '', submitSelector: '', twoStep: false, path: location.pathname };
    }

    return {
      ok: true,
      reason: '',
      usernameSelector: selectorFor(preferred),
      passwordSelector: '',
      submitSelector: selectorFor(submitIn(preferred.form || document)),
      twoStep: true,
      path: location.pathname,
    };
  }

  const scope = passwordEl.form || document;
  const candidates = textInputs(scope);
  // The ID field is normally the last text input before the password field.
  const before = candidates.filter(
    (el) => passwordEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING
  );
  const usernameEl = before[before.length - 1] || candidates[0] || null;

  return {
    ok: true,
    reason: '',
    usernameSelector: selectorFor(usernameEl),
    passwordSelector: selectorFor(passwordEl),
    submitSelector: selectorFor(submitIn(scope)),
    twoStep: false,
    path: location.pathname,
  };
})();`;
}

module.exports = {
  buildAutofillScript,
  buildDetectScript,
  jsLiteral,
  matchesUrlPattern,
  shouldAutofill,
};
