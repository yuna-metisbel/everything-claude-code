'use strict';

/**
 * DM bridge script generation (pure module - no Electron imports).
 *
 * Three scripts are generated here and executed inside a guest page by the
 * MAIN process:
 *
 *   - the element picker, which lets the user click the real button on the
 *     real page so nobody has to read HTML or send a page dump anywhere;
 *   - the scan, which reads the conversation list;
 *   - the send, which opens one conversation and posts a reply into it.
 *
 * Every selector is configured per pane, because the bridge has to work on
 * whatever the site looks like today.
 */

const { jsLiteral } = require('./autofill');

/**
 * Helpers shared by the generated scripts.
 *
 * `selectorFor` prefers a unique #id, then a [name=], then a class that is
 * unique within the parent, and falls back to a structural nth-of-type path -
 * the same ladder the login detector walks, so selectors stay readable.
 */
const HELPERS = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const visible = (el) => {
    if (!el || !el.getClientRects || el.getClientRects().length === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  };

  const cssEscape = (value) =>
    window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');

  const isStableId = (id) =>
    typeof id === 'string' && id !== '' && !/^[0-9]/.test(id) && !/[0-9]{4,}/.test(id);

  const stableClasses = (el) =>
    Array.from(el.classList || []).filter(
      (name) => name.length > 1 && !/[0-9]{3,}/.test(name) && !/^(css|sc|jsx)-/.test(name)
    );

  function selectorFor(el, root) {
    if (!el || el.nodeType !== 1) return '';
    const stop = root && root.nodeType === 1 ? root : document.body;

    // Inside a known container, a class that is unique there beats a
    // structural path: it keeps working when the markup around it shifts.
    if (root && root.nodeType === 1) {
      const own = stableClasses(el).find(
        (cls) => root.querySelectorAll('.' + cssEscape(cls)).length === 1
      );
      if (own) return '.' + cssEscape(own);
    }

    const parts = [];
    let node = el;

    while (node && node.nodeType === 1 && node !== stop) {
      if (isStableId(node.id) && document.querySelectorAll('#' + cssEscape(node.id)).length === 1) {
        parts.unshift('#' + cssEscape(node.id));
        return parts.join(' > ');
      }

      const tag = node.tagName.toLowerCase();
      let part = tag;

      const name = node.getAttribute && node.getAttribute('name');
      if (name) {
        part = tag + '[name="' + name.replace(/"/g, '\\\\"') + '"]';
      } else {
        const parent = node.parentElement;
        const classes = stableClasses(node);
        const unique = parent
          ? classes.find(
              (cls) => parent.querySelectorAll(':scope > .' + cssEscape(cls)).length === 1
            )
          : classes[0];
        if (unique) {
          part = tag + '.' + cssEscape(unique);
        } else if (parent) {
          const twins = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
          if (twins.length > 1) part = tag + ':nth-of-type(' + (twins.indexOf(node) + 1) + ')';
        }
      }

      parts.unshift(part);
      node = node.parentElement;
    }

    return parts.join(' > ');
  }

  async function waitFor(selector, timeoutMs, root) {
    if (!selector) return null;
    const scope = root || document;
    const deadline = Date.now() + (timeoutMs || 0);
    for (;;) {
      let found = null;
      try {
        found = scope.querySelector(selector);
      } catch {
        return null;
      }
      if (found && visible(found)) return found;
      if (Date.now() >= deadline) return found && visible(found) ? found : null;
      await sleep(120);
    }
  }

  const textOf = (el) => (el && typeof el.innerText === 'string' ? el.innerText.trim() : '');

  /** Native setter so React/Vue controlled inputs notice the change. */
  function setValue(el, value) {
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
      return;
    }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value');
    el.focus();
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
`;


/** How a row is identified across polls. Shared so scan and open agree. */
const KEY_FOR = `
  const keyFor = (row, name, index) => {
    const link = row.matches('a[href]') ? row : row.querySelector('a[href]');
    const href = link ? link.getAttribute('href') : '';
    if (href) return 'href:' + href;
    const attr = row.getAttribute('data-id') || row.getAttribute('data-key') || '';
    if (attr) return 'attr:' + attr;
    return name ? 'name:' + name : 'index:' + index;
  };
`;

/**
 * Overlay that lets the user click the element they mean.
 *
 * Resolves to `{ ok, selector, relative, tag, sample }` on click, or
 * `{ ok: false, reason: 'cancelled' }` on Escape. `sample` is a short excerpt
 * of the element's own text, shown back as a confirmation - it never leaves
 * the user's machine.
 *
 * @param {{label?: string, relativeTo?: string, timeoutMs?: number}} options
 */
function buildPickerScript(options = {}) {
  const label = jsLiteral(options.label || '要素をクリックしてください');
  const relativeTo = jsLiteral(options.relativeTo || '');
  const timeoutMs = jsLiteral(Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 60000);

  return `(async () => {
${HELPERS}
  const LABEL = ${label};
  const RELATIVE_TO = ${relativeTo};
  const TIMEOUT_MS = ${timeoutMs};

  if (window.__sixviewPickerActive) return { ok: false, reason: 'already-picking' };
  window.__sixviewPickerActive = true;

  const box = document.createElement('div');
  box.style.cssText = [
    'position:fixed', 'z-index:2147483647', 'pointer-events:none',
    'border:2px solid #ff2d78', 'background:rgba(255,45,120,0.18)',
    'border-radius:4px', 'transition:all 60ms ease-out',
  ].join(';');

  const hint = document.createElement('div');
  hint.textContent = LABEL + '（Escで中止）';
  hint.style.cssText = [
    'position:fixed', 'z-index:2147483647', 'left:0', 'right:0', 'top:0',
    'padding:8px 12px', 'background:#ff2d78', 'color:#fff', 'pointer-events:none',
    'font:600 13px/1.4 system-ui,sans-serif', 'text-align:center',
  ].join(';');

  document.body.appendChild(box);
  document.body.appendChild(hint);

  let current = null;

  const draw = (el) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
  };

  const onMove = (event) => {
    current = event.target;
    draw(current);
  };

  const cleanup = () => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    box.remove();
    hint.remove();
    window.__sixviewPickerActive = false;
  };

  let settle = null;
  const picked = new Promise((resolve) => {
    settle = resolve;
  });

  function onClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const el = event.target;
    let relative = '';
    if (RELATIVE_TO) {
      try {
        const row = el.closest(RELATIVE_TO);
        if (row) relative = selectorFor(el, row);
      } catch { /* an invalid row selector just means no relative form */ }
    }
    cleanup();
    settle({
      ok: true,
      selector: selectorFor(el),
      relative,
      tag: el.tagName.toLowerCase(),
      sample: textOf(el).slice(0, 24),
    });
  }

  function onKey(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cleanup();
    settle({ ok: false, reason: 'cancelled' });
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);

  const timer = sleep(TIMEOUT_MS).then(() => {
    if (!window.__sixviewPickerActive) return null;
    cleanup();
    return { ok: false, reason: 'timeout' };
  });

  return Promise.race([picked, timer]);
})();`;
}

/**
 * Bring the DM list on screen.
 *
 * Split out from the scan because clicking the DM tab usually navigates, and a
 * navigation tears down the script that is still running - so the click is the
 * last thing this script does, and the caller reads the list afterwards.
 */
function buildDmEnsureListScript(dm = {}) {
  const cfg = jsLiteral({
    openSelector: dm.openSelector || '',
    backSelector: dm.backSelector || '',
    rowSelector: dm.rowSelector || '',
  });

  return `(() => {
${HELPERS}
  const CFG = ${cfg};
  if (!CFG.rowSelector) return { ok: false, reason: 'no-row-selector' };

  const present = Array.from(document.querySelectorAll(CFG.rowSelector)).filter(visible).length;
  if (present > 0) return { ok: true, alreadyThere: true, rows: present };

  // From a conversation the way back to the list is "back", not the DM tab,
  // so both are tried - whichever this screen actually offers.
  const candidates = [CFG.openSelector, CFG.backSelector].filter(Boolean);
  if (candidates.length === 0) return { ok: false, reason: 'no-open-selector' };

  let target = null;
  for (const selector of candidates) {
    let found = null;
    try {
      found = document.querySelector(selector);
    } catch {
      found = null;
    }
    if (found && visible(found)) {
      target = found;
      break;
    }
  }
  if (!target) return { ok: false, reason: 'open-not-found' };

  // Nothing may be awaited past this point: the click can navigate away.
  target.click();
  return { ok: true, alreadyThere: false, clicked: true };
})();`;
}

/**
 * Read the conversation list. Pure reading - it never clicks, so it cannot be
 * cut short by a navigation.
 *
 * Each row carries a `key` that stays the same across polls (its link target
 * when it has one), the name, the preview text and the unread flag.
 */
function buildDmScanScript(dm = {}) {
  const cfg = jsLiteral({
    rowSelector: dm.rowSelector || '',
    nameSelector: dm.nameSelector || '',
    previewSelector: dm.previewSelector || '',
    unreadSelector: dm.unreadSelector || '',
    maxRows: 40,
  });

  return `(() => {
${HELPERS}
${KEY_FOR}
  const CFG = ${cfg};
  if (!CFG.rowSelector) return { ok: false, reason: 'no-row-selector', rows: [] };

  const rows = Array.from(document.querySelectorAll(CFG.rowSelector)).filter(visible);
  if (rows.length === 0) return { ok: false, reason: 'no-rows', rows: [] };

  const pick = (row, selector) => {
    if (!selector) return '';
    try {
      return textOf(row.querySelector(selector));
    } catch {
      return '';
    }
  };

  const out = rows.slice(0, CFG.maxRows).map((row, index) => {
    const name = pick(row, CFG.nameSelector) || textOf(row).split('\\n')[0] || '';
    let unread = false;
    if (CFG.unreadSelector) {
      try {
        const badge = row.querySelector(CFG.unreadSelector);
        unread = Boolean(badge && visible(badge) && textOf(badge) !== '0');
      } catch { /* a bad unread selector just means "cannot tell" */ }
    }
    return { key: keyFor(row, name, index), index, name, preview: pick(row, CFG.previewSelector), unread };
  });

  return { ok: true, reason: '', rows: out, path: location.pathname };
})();`;
}

/**
 * Open one conversation, found by the key the scan produced.
 *
 * Matching on the key means a list that reordered between the notification and
 * the reply still opens the right person; a key that is no longer in the list
 * is reported rather than approximated.
 */
function buildDmOpenThreadScript(dm = {}, key = '') {
  const cfg = jsLiteral({ rowSelector: dm.rowSelector || '', nameSelector: dm.nameSelector || '' });
  const wanted = jsLiteral(key);

  return `(() => {
${HELPERS}
${KEY_FOR}
  const CFG = ${cfg};
  const WANTED = ${wanted};
  if (!CFG.rowSelector || !WANTED) return { ok: false, reason: 'not-configured' };

  const rows = Array.from(document.querySelectorAll(CFG.rowSelector)).filter(visible);
  if (rows.length === 0) return { ok: false, reason: 'list-not-found' };

  let match = null;
  rows.forEach((row, index) => {
    if (match) return;
    let name = '';
    if (CFG.nameSelector) {
      try {
        name = textOf(row.querySelector(CFG.nameSelector));
      } catch { /* fall back to the row's own text */ }
    }
    if (!name) name = textOf(row).split('\\n')[0] || '';
    if (keyFor(row, name, index) === WANTED) match = row;
  });

  if (!match) return { ok: false, reason: 'thread-not-found' };

  // Last statement: opening a conversation usually navigates.
  match.click();
  return { ok: true, opened: true };
})();`;
}

/**
 * Type a reply into the open conversation and submit it.
 *
 * Submitting often navigates too, so the click is again the final statement and
 * the caller confirms the result by re-reading the list.
 */
function buildDmTypeScript(dm = {}, text = '') {
  const cfg = jsLiteral({ inputSelector: dm.inputSelector || '', sendSelector: dm.sendSelector || '' });
  const body = jsLiteral(typeof text === 'string' ? text : '');

  return `(async () => {
${HELPERS}
  const CFG = ${cfg};
  const TEXT = ${body};
  if (!TEXT) return { ok: false, reason: 'empty-text' };
  if (!CFG.inputSelector) return { ok: false, reason: 'not-configured' };

  const input = await waitFor(CFG.inputSelector, 10000);
  if (!input) return { ok: false, reason: 'input-not-found' };

  setValue(input, TEXT);
  await sleep(200);

  const button = CFG.sendSelector ? document.querySelector(CFG.sendSelector) : null;
  const form = input.closest('form');
  if (!button && !(form && typeof form.requestSubmit === 'function')) {
    return { ok: false, reason: 'send-not-found' };
  }

  // Nothing may be awaited past this point.
  if (button && visible(button) && !button.disabled) button.click();
  else form.requestSubmit();
  return { ok: true, submitted: true };
})();`;
}

module.exports = {
  HELPERS,
  buildPickerScript,
  buildDmEnsureListScript,
  buildDmScanScript,
  buildDmOpenThreadScript,
  buildDmTypeScript,
};
