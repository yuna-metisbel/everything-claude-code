'use strict';

/**
 * Finding the DM list without being told where it is.
 *
 * Picking eight elements by hand is the honest way to configure a site nobody
 * has described to us, but it is eight chances to give up. This reads the page
 * the way a person does - a message list is a run of sibling rows that look
 * alike, each with a short name and a longer line of text - and proposes the
 * selectors, so the usual case is one button instead of eight clicks.
 *
 * It only ever reads. Nothing here clicks, submits or navigates, so running it
 * on a live account cannot send anything or mark anything as read.
 *
 * What it guesses is always checkable: the caller shows the sample it read
 * back, and every field stays editable and re-pickable by hand.
 */

const { HELPERS } = require('./dm-script');

/**
 * Shared vocabulary for "this looks like X".
 *
 * Written as source text rather than RegExp objects because it is spliced into
 * a script that runs in the page; `\\d` here is `\d` there.
 */
const PATTERNS = `
  const RE_NAME_HINT = /name|who|user|nick|title|handle|partner|相手|名前/i;
  const RE_TEXT_HINT = /msg|message|preview|body|text|last|comment|snippet|本文/i;
  const RE_UNREAD_HINT = /badge|unread|count|new|notif|未読/i;
  const RE_TIME_LIKE = /^\\s*(\\d{1,2}[:：]\\d{2}|\\d{1,2}\\/\\d{1,2}|\\d{1,2}月\\d{1,2}日|昨日|今日|(just )?now)\\s*$/i;
  const RE_DIGITS_ONLY = /^\\s*\\d{1,3}\\s*$/;
  const RE_DM_TAB = /(^|[^a-z])dm([^a-z]|$)|メッセージ|message|talk|chat|トーク|やりとり/i;
  const RE_COMPOSE = /メッセージ|入力|message|reply|返信|送信|本文/i;
  const RE_SEARCH = /search|検索|query|filter/i;
  const RE_SEND = /送信|送る|返信|send|submit|post/i;
  const RE_BACK = /戻る|一覧|back|close|閉じる|←|＜|&lt;/i;
`;

/**
 * Small readers used by every stage of the guess.
 *
 * `hintOf` gathers the attributes a site author writes for themselves - class,
 * id, name, placeholder, aria-label - because those name a thing far more
 * reliably than its position does.
 */
const READERS = `
  const isLeaf = (el) => el.children.length === 0;

  const hintOf = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const cls = el.className && el.className.baseVal !== undefined
      ? el.className.baseVal
      : String(el.className || '');
    return [
      cls,
      el.id || '',
      el.getAttribute('name') || '',
      el.getAttribute('placeholder') || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('data-testid') || '',
    ].join(' ');
  };

  const clickableText = (el) =>
    (textOf(el) || el.getAttribute('aria-label') || el.value || '').trim();

  const clickables = () =>
    Array.from(
      document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="button"]')
    ).filter(visible);

  /** How many of the rows a row-relative selector actually resolves in. */
  const resolvesIn = (rows, selector) => {
    if (!selector) return 0;
    let hits = 0;
    for (const row of rows) {
      try {
        if (row.querySelector(selector)) hits += 1;
      } catch (_) {
        return 0;
      }
    }
    return hits;
  };
`;

/**
 * Locating the list itself.
 *
 * Siblings that share a tag and a class are a repeat of one template, which is
 * what a rendered list is. The scoring then asks what separates a message list
 * from a nav bar or a tag cloud: rows link somewhere, rows carry two pieces of
 * text, rows are sentences rather than single words.
 */
const FIND_ROWS = `
  function findRowGroup() {
    const byParent = new Map();

    for (const el of document.body.querySelectorAll('*')) {
      const parent = el.parentElement;
      if (!parent || !visible(el)) continue;

      const text = textOf(el);
      if (text.length < 2 || text.length > 500) continue;

      const signature = el.tagName + '|' + stableClasses(el).sort().join('.');
      let groups = byParent.get(parent);
      if (!groups) {
        groups = new Map();
        byParent.set(parent, groups);
      }
      const members = groups.get(signature);
      if (members) members.push(el);
      else groups.set(signature, [el]);
    }

    let best = null;

    for (const [parent, groups] of byParent) {
      for (const members of groups.values()) {
        if (members.length < 2 || members.length > 200) continue;

        const linked = members.filter(
          (el) => el.matches('a[href]') || el.querySelector('a[href]')
        ).length;
        const withTwoTexts = members.filter(
          (el) => Array.from(el.querySelectorAll('*')).filter((n) => isLeaf(n) && textOf(n)).length >= 2
        ).length;
        const lengths = members.map((el) => textOf(el).length);
        const average = lengths.reduce((sum, n) => sum + n, 0) / members.length;

        let score = Math.min(members.length, 20);
        if (linked === members.length) score += 6;
        if (withTwoTexts === members.length) score += 8;
        else if (withTwoTexts >= members.length / 2) score += 3;
        if (average >= 6 && average <= 250) score += 2;
        // A nav bar is also a run of alike links; its rows are one word each
        // and it announces itself.
        if (average < 6) score -= 8;
        if (parent.closest('nav, header, footer, [role="navigation"]')) score -= 12;

        if (score > 6 && (!best || score > best.score)) {
          best = { parent, members, score };
        }
      }
    }

    return best;
  }

  /** A document-level selector that picks out exactly these rows. */
  function rowSelectorFor(group) {
    const row = group.members[0];

    for (const cls of stableClasses(row)) {
      const selector = '.' + cssEscape(cls);
      try {
        if (document.querySelectorAll(selector).length === group.members.length) return selector;
      } catch (_) { /* an unusable class is simply skipped */ }
    }

    const containerSelector = selectorFor(group.parent);
    if (containerSelector) {
      const selector = containerSelector + ' > ' + row.tagName.toLowerCase();
      try {
        if (document.querySelectorAll(selector).length === group.members.length) return selector;
      } catch (_) { /* fall through to giving up */ }
    }

    return '';
  }
`;

/**
 * Reading one row.
 *
 * The name is the short text, the message is the long one, and the unread mark
 * is the bare number. Where the site labelled them, the label wins - the shape
 * is only the fallback.
 */
const READ_ROW = `
  function readRow(row, rows) {
    const leaves = Array.from(row.querySelectorAll('*')).filter(
      (el) => isLeaf(el) && visible(el) && textOf(el)
    );
    if (leaves.length === 0) return { nameSelector: '', previewSelector: '', unreadSelector: '' };

    const badges = leaves.filter(
      (el) => RE_DIGITS_ONLY.test(textOf(el)) || RE_UNREAD_HINT.test(hintOf(el))
    );
    const rest = leaves.filter(
      (el) => !badges.includes(el) && !RE_TIME_LIKE.test(textOf(el))
    );

    const nameEl =
      rest.find((el) => RE_NAME_HINT.test(hintOf(el))) ||
      rest.filter((el) => textOf(el).length <= 40)[0] ||
      rest[0] ||
      null;

    const others = rest.filter((el) => el !== nameEl);
    const previewEl =
      others.find((el) => RE_TEXT_HINT.test(hintOf(el))) ||
      others.slice().sort((a, b) => textOf(b).length - textOf(a).length)[0] ||
      null;

    // An unread badge only exists on unread rows, so it is looked for across
    // the whole list rather than in this one row.
    let unreadEl = badges[0] || null;
    if (!unreadEl) {
      for (const other of rows) {
        const found = Array.from(other.querySelectorAll('*')).find(
          (el) =>
            isLeaf(el) &&
            visible(el) &&
            textOf(el) &&
            (RE_DIGITS_ONLY.test(textOf(el)) || RE_UNREAD_HINT.test(hintOf(el)))
        );
        if (found) {
          unreadEl = found;
          break;
        }
      }
    }

    const relative = (el) => {
      if (!el) return '';
      const owner = rows.find((candidate) => candidate.contains(el)) || row;
      return selectorFor(el, owner);
    };

    const nameSelector = relative(nameEl);
    const previewSelector = relative(previewEl);
    const unreadSelector = relative(unreadEl);

    // A guess that only resolves in the row it came from describes that row,
    // not the list, so it is dropped rather than shipped.
    const enough = Math.max(1, Math.ceil(rows.length / 2));
    return {
      nameSelector: resolvesIn(rows, nameSelector) >= enough ? nameSelector : '',
      previewSelector: resolvesIn(rows, previewSelector) >= enough ? previewSelector : '',
      unreadSelector: resolvesIn(rows, unreadSelector) >= 1 ? unreadSelector : '',
    };
  }
`;

/**
 * The three controls that are not part of a row: the tab that shows the list,
 * and - on an opened conversation - the reply box and its send button.
 */
const FIND_CONTROLS = `
  function findDmTab(rows) {
    const inRow = (el) => rows.some((row) => row.contains(el));
    const candidates = clickables().filter((el) => !inRow(el));

    const match = candidates.find((el) => {
      const href = el.getAttribute ? el.getAttribute('href') || '' : '';
      return RE_DM_TAB.test(clickableText(el)) || RE_DM_TAB.test(hintOf(el)) || RE_DM_TAB.test(href);
    });

    return match ? selectorFor(match) : '';
  }

  function findComposer() {
    const fields = Array.from(
      document.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable="true"]')
    )
      .filter(visible)
      .filter((el) => !RE_SEARCH.test(hintOf(el)));

    if (fields.length === 0) return { inputSelector: '', sendSelector: '' };

    const input =
      fields.find((el) => RE_COMPOSE.test(hintOf(el))) ||
      fields.find((el) => el.tagName === 'TEXTAREA') ||
      fields[fields.length - 1];

    const scope = input.form || input.closest('form, [class*="composer"], [class*="reply"]') || document;
    const buttons = Array.from(
      scope.querySelectorAll('button, [role="button"], input[type="submit"]')
    ).filter(visible);

    const send =
      buttons.find((el) => RE_SEND.test(clickableText(el)) || RE_SEND.test(hintOf(el))) ||
      buttons.find((el) => (el.getAttribute('type') || '').toLowerCase() === 'submit') ||
      buttons[0] ||
      null;

    return {
      inputSelector: selectorFor(input),
      sendSelector: send ? selectorFor(send) : '',
    };
  }

  function findBack(sendSelector) {
    const sent = sendSelector ? document.querySelector(sendSelector) : null;
    const match = clickables().find(
      (el) =>
        el !== sent &&
        (RE_BACK.test(clickableText(el)) || RE_BACK.test(hintOf(el)))
    );
    return match ? selectorFor(match) : '';
  }
`;

/**
 * Build the script that proposes DM selectors for whatever the pane shows.
 *
 * It reports what it found on *this* screen: the list screen yields the row
 * fields and the DM tab, an opened conversation yields the reply box, the send
 * button and the way back. The caller keeps whatever comes back and leaves the
 * rest alone, so running it once per screen fills everything in.
 *
 * @returns {string} an IIFE resolving to
 *   `{ ok, screen, rows, rowSelector, nameSelector, previewSelector,
 *      unreadSelector, openSelector, inputSelector, sendSelector,
 *      backSelector, sample }`
 */
function buildDmDetectScript() {
  return `(() => {
${HELPERS}
${PATTERNS}
${READERS}
${FIND_ROWS}
${READ_ROW}
${FIND_CONTROLS}

  const group = findRowGroup();
  const rows = group ? group.members : [];
  const rowSelector = group ? rowSelectorFor(group) : '';

  const fields = rowSelector
    ? readRow(rows[0], rows)
    : { nameSelector: '', previewSelector: '', unreadSelector: '' };

  const composer = findComposer();
  const openSelector = findDmTab(rows);
  const backSelector = findBack(composer.sendSelector);

  const sampleFrom = (selector) => {
    if (!selector || !rows.length) return '';
    try {
      const el = rows[0].querySelector(selector);
      return el ? textOf(el).slice(0, 24) : '';
    } catch (_) {
      return '';
    }
  };

  const found =
    (rowSelector ? 1 : 0) + (composer.inputSelector ? 1 : 0) + (openSelector ? 1 : 0);
  if (found === 0) return { ok: false, reason: 'not-found', path: location.pathname };

  return {
    ok: true,
    screen: rowSelector ? 'list' : 'thread',
    rows: rowSelector ? rows.length : 0,
    rowSelector,
    nameSelector: fields.nameSelector,
    previewSelector: fields.previewSelector,
    unreadSelector: fields.unreadSelector,
    openSelector,
    inputSelector: composer.inputSelector,
    sendSelector: composer.sendSelector,
    backSelector,
    sample: {
      name: sampleFrom(fields.nameSelector),
      preview: sampleFrom(fields.previewSelector),
    },
    path: location.pathname,
  };
})();`;
}

module.exports = { buildDmDetectScript };
