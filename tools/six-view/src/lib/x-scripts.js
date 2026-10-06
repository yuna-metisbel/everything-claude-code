'use strict';

/**
 * Reading X pages: is this account all right, and what has it posted.
 *
 * Pure module - no Electron imports. The scripts it builds run inside a page
 * the account is logged in to, so like the DM and boost detectors they only
 * ever read: no clicks, no typing, no form posts. The one script that changes
 * anything scrolls the timeline, which is what a person reading it does.
 */

/** Where the checks start. Injectable so a test can stand in for X. */
const X_ORIGIN = 'https://x.com';

/**
 * A count as X prints it: "1,234", "1.2万", "3.4K", "2M". Returns 0 for
 * anything that is not a count.
 */
function parseCount(text) {
  const match = String(text || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(万|億|[KkMm])?/);
  if (!match) return 0;
  const scale = { 万: 1e4, 億: 1e8, K: 1e3, k: 1e3, M: 1e6, m: 1e6 }[match[2]] || 1;
  return Math.round(Number(match[1]) * scale);
}

/**
 * What a check found, in one word.
 *
 * `snapshot` is what buildXStateScript reads: where the page ended up, whether
 * the signed-in profile link is there, and the start of the page text.
 */
function classifyXState(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 'unknown';
  if (snapshot.cookie === false) return 'logged-out';

  const path = String(snapshot.path || '');
  if (/^\/account\/access/.test(path)) return 'locked';
  if (/^\/(i\/flow\/(login|signup)|login|logout)/.test(path)) return 'logged-out';

  const text = String(snapshot.text || '');
  if (/凍結されています|アカウントは凍結|account is suspended|account has been suspended/i.test(text)) {
    return 'suspended';
  }
  if (/アカウントがロックされています|your account (is|has been) locked/i.test(text)) return 'locked';

  if (snapshot.handle) return 'ok';
  if (snapshot.loginButton) return 'logged-out';
  return 'unknown';
}

/** Words for the status line and the Telegram message. */
const X_STATE_LABELS = {
  ok: '正常',
  'logged-out': 'ログアウト',
  locked: 'ロック',
  suspended: '凍結',
  unknown: '確認できず',
  checking: '確認中',
};

/** Is this a state someone has to go and fix? */
function isXProblem(state) {
  return state === 'logged-out' || state === 'locked' || state === 'suspended';
}

/**
 * Read the page an account lands on. Waits up to `waitMs` for the signed-in
 * profile link, because X draws the page after it loads.
 */
function buildXStateScript(waitMs = 12000) {
  return `(async () => {
  const deadline = Date.now() + ${Number(waitMs) || 0};
  const read = () => {
    const link = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    const href = link ? String(link.getAttribute('href') || '') : '';
    return {
      host: location.host,
      path: location.pathname,
      handle: href.replace(/^\\//, '').split('/')[0] || '',
      loginButton: Boolean(document.querySelector('[data-testid="loginButton"], a[href="/login"], a[href="/i/flow/login"]')),
      text: document.body ? document.body.innerText.slice(0, 3000) : '',
    };
  };
  for (;;) {
    const snap = read();
    if (snap.handle || /^\\/(account\\/access|i\\/flow\\/login|login)/.test(snap.path)) return snap;
    if (Date.now() > deadline) return snap;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
})()`;
}

/**
 * Read the posts on screen in a profile timeline.
 *
 * Only the account's own posts are kept: a repost of someone else shows up in
 * the timeline too, but its numbers are not this account's.
 */
function buildXPostsScript(handle) {
  const own = String(handle || '').replace(/^@/, '').toLowerCase();
  return `(() => {
  const own = ${JSON.stringify(own)};
  const count = (label) => {
    const m = String(label || '').replace(/,/g, '').match(/(\\d+(?:\\.\\d+)?)\\s*(万|億|[KkMm])?/);
    if (!m) return 0;
    const scale = { '万': 1e4, '億': 1e8, K: 1e3, k: 1e3, M: 1e6, m: 1e6 }[m[2]] || 1;
    return Math.round(Number(m[1]) * scale);
  };
  const labelOf = (root, ids) => {
    for (const id of ids) {
      const el = root.querySelector('[data-testid="' + id + '"]');
      if (el) return el.getAttribute('aria-label') || '';
    }
    return '';
  };
  const posts = [];
  for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
    const link = Array.from(article.querySelectorAll('a[href*="/status/"]')).find((a) => a.querySelector('time'));
    if (!link) continue;
    const parts = new URL(link.href, location.href).pathname.split('/');
    const author = String(parts[1] || '').toLowerCase();
    const id = parts[3] || '';
    if (!id || (own && author !== own)) continue;
    const time = link.querySelector('time');
    const textEl = article.querySelector('[data-testid="tweetText"]');
    const views = Array.from(article.querySelectorAll('a[href*="/analytics"]')).map((a) => a.getAttribute('aria-label') || '')[0] || '';
    posts.push({
      id,
      url: 'https://x.com/' + parts[1] + '/status/' + id,
      time: time ? time.getAttribute('datetime') || '' : '',
      text: textEl ? textEl.innerText.slice(0, 280) : '',
      replies: count(labelOf(article, ['reply'])),
      reposts: count(labelOf(article, ['retweet', 'unretweet'])),
      likes: count(labelOf(article, ['like', 'unlike'])),
      bookmarks: count(labelOf(article, ['bookmark', 'removeBookmark'])),
      views: count(views),
      hasMedia: Boolean(article.querySelector('[data-testid="tweetPhoto"], video')),
    });
  }
  return { ok: true, posts, atBottom: window.innerHeight + window.scrollY >= document.body.scrollHeight - 50 };
})()`;
}

/** Move the timeline down one screen, as a reader would. */
function buildXScrollScript() {
  return `(() => {
  window.scrollBy(0, Math.round(window.innerHeight * 0.9));
  return { ok: true };
})()`;
}

/** Fold a new batch into the posts already collected, keeping the newest numbers. */
function mergePosts(known, batch) {
  const byId = new Map(known.map((post) => [post.id, post]));
  let added = 0;
  for (const post of batch || []) {
    if (!post || !post.id) continue;
    if (!byId.has(post.id)) added += 1;
    byId.set(post.id, post);
  }
  return { posts: Array.from(byId.values()), added };
}

module.exports = {
  X_ORIGIN,
  X_STATE_LABELS,
  buildXPostsScript,
  buildXScrollScript,
  buildXStateScript,
  classifyXState,
  isXProblem,
  mergePosts,
  parseCount,
};
