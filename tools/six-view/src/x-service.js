'use strict';

/**
 * Looking after the X accounts: are they all right, and what have they posted.
 *
 * Every look happens in a window nobody sees, opened on the account's own
 * session, so the pane on screen is never pulled away from what the user is
 * doing. Only one such window is open at a time - eight accounts are checked
 * one after the other, not all at once.
 *
 * Everything it needs from the app is injected, so tests drive it with fakes.
 */

const {
  X_ORIGIN,
  X_STATE_LABELS,
  buildXPostsScript,
  buildXScrollScript,
  buildXStateScript,
  classifyXState,
  isXProblem,
  mergePosts,
} = require('./lib/x-scripts');
const { xAccountSites } = require('./lib/config-schema');
const { run, settle } = require('./lib/page-runner');

/** The first check waits until the app has settled after launch. */
const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;
/** A breath between accounts, so the checks do not arrive as a burst. */
const BETWEEN_ACCOUNTS_MS = 3000;
/** How long a page gets to load before it is read anyway. */
const LOAD_TIMEOUT_MS = 20000;

const DEFAULT_MAX_POSTS = 100;
const MAX_SCROLLS = 60;
/** Scrolls in a row that bring nothing new before the end is assumed. */
const IDLE_SCROLLS = 4;

class XService {
  /**
   * @param {{
   *   getConfig: () => object,
   *   getSite: (siteId: string) => object|null,
   *   openWindow: (site: object) => { contents: object, loadURL: (url: string) => Promise<void>, close: () => void },
   *   hasLoginCookie?: (site: object) => Promise<boolean|null>,
   *   announce?: (text: string) => Promise<any>,
   *   onStatus?: (status: object) => void,
   *   origin?: string,
   *   wait?: (ms: number) => Promise<void>,
   *   log?: (...args: any[]) => void,
   * }} deps
   */
  constructor(deps) {
    this.deps = deps;
    this.origin = deps.origin || X_ORIGIN;
    this.wait = deps.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    /** siteId -> { state, handle, checkedAt, detail } */
    this.states = new Map();
    /** Work waits its turn here so only one hidden window is ever open. */
    this.queue = Promise.resolve();
    this.timer = null;
    this.firstTimer = null;
    this.checkingAll = false;
  }

  log(...args) {
    if (this.deps.log) this.deps.log('[x]', ...args);
  }

  /** Run one job after the ones before it. */
  enqueue(job) {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => {});
    return next;
  }

  get watchConfig() {
    const config = this.deps.getConfig();
    return (config && config.xWatch) || { enabled: false, intervalMinutes: 60, notify: false };
  }

  /** Start (or restart, after a settings change) the regular check. */
  refresh() {
    this.stop();
    const watch = this.watchConfig;
    if (!watch.enabled) {
      this.emitStatus();
      return;
    }
    this.firstTimer = setTimeout(() => void this.checkAll(), FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(() => void this.checkAll(), watch.intervalMinutes * 60 * 1000);
    this.emitStatus();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.firstTimer) clearTimeout(this.firstTimer);
    this.timer = null;
    this.firstTimer = null;
  }

  status() {
    const config = this.deps.getConfig();
    const accounts = xAccountSites(config).map((site) => {
      const known = this.states.get(site.id) || { state: 'unknown', handle: '', checkedAt: 0 };
      return {
        siteId: site.id,
        name: site.name,
        group: site.group || '',
        state: known.state,
        label: known.checkedAt ? X_STATE_LABELS[known.state] || known.state : '未確認',
        handle: known.handle,
        checkedAt: known.checkedAt,
      };
    });
    return { enabled: this.watchConfig.enabled, checking: this.checkingAll, accounts };
  }

  emitStatus() {
    if (this.deps.onStatus) this.deps.onStatus(this.status());
  }

  /**
   * Open a hidden window on the account's session, load `url`, and give the
   * page time to draw. The caller closes it.
   */
  async open(site, url) {
    const win = this.deps.openWindow(site);
    try {
      await Promise.race([win.loadURL(url), this.wait(LOAD_TIMEOUT_MS)]);
    } catch (err) {
      // A redirect (to the login page, to the lock page) rejects the load
      // promise; the page that landed is what gets read.
      this.log(`load ${url}: ${err && err.message}`);
    }
    return win;
  }

  /** Read where an account stands, in a hidden window. */
  async look(site) {
    if (this.deps.hasLoginCookie) {
      const cookie = await this.deps.hasLoginCookie(site);
      if (cookie === false) return { state: 'logged-out', handle: '' };
    }

    const win = await this.open(site, `${this.origin}/home`);
    try {
      let snap = await run(win.contents, buildXStateScript());
      // X moved the page on (to the login or lock page) while it was read.
      if (snap.reason === 'context-lost') {
        await settle(win.contents);
        snap = await run(win.contents, buildXStateScript());
      }
      return { state: classifyXState(snap), handle: snap.handle || '' };
    } finally {
      win.close();
    }
  }

  /** Check one account now. */
  checkOne(siteId) {
    return this.enqueue(async () => {
      const site = this.deps.getSite(siteId);
      if (!site) return { ok: false, reason: 'unknown-site' };
      const found = await this.look(site).catch((err) => {
        this.log(`check ${siteId} failed: ${err && err.message}`);
        return { state: 'unknown', handle: '' };
      });
      await this.record(site, found);
      return { ok: true, ...found };
    });
  }

  /** Check every X account, one after another. */
  async checkAll() {
    if (this.checkingAll) return { ok: false, reason: 'busy' };
    this.checkingAll = true;
    this.emitStatus();
    try {
      const sites = xAccountSites(this.deps.getConfig());
      for (const [index, site] of sites.entries()) {
        if (index > 0) await this.wait(BETWEEN_ACCOUNTS_MS);
        await this.checkOne(site.id);
      }
      return { ok: true, checked: sites.length };
    } finally {
      this.checkingAll = false;
      this.emitStatus();
    }
  }

  /**
   * Keep what a check found, and tell Telegram when an account goes wrong or
   * comes back. "Couldn't tell" is never news: a slow page is not a ban.
   */
  async record(site, found) {
    const before = this.states.get(site.id);
    const handle = found.handle || (before && before.handle) || '';
    // `known` is the last definite answer. A look that could not tell in
    // between must not make a lock forgotten, or its recovery goes unreported.
    const was = (before && before.known) || 'unknown';
    const known = found.state === 'unknown' ? was : found.state;
    this.states.set(site.id, { state: found.state, known, handle, checkedAt: Date.now() });
    this.emitStatus();

    if (found.state === 'unknown') return;
    if (was === found.state) return;
    const wentWrong = isXProblem(found.state);
    const cameBack = found.state === 'ok' && isXProblem(was);
    if (!wentWrong && !cameBack) return;
    if (!this.watchConfig.notify || !this.deps.announce) return;

    const who = handle ? `${site.name}（@${handle}）` : site.name;
    const text = wentWrong
      ? `02View: ${who} が「${X_STATE_LABELS[found.state]}」になっています。確認してください。`
      : `02View: ${who} は「正常」に戻りました。`;
    await this.deps.announce(text);
  }

  /**
   * Collect an account's own posts from its profile, newest first, with their
   * numbers. `onProgress` hears how many have been found so far.
   */
  analyze(siteId, { maxPosts = DEFAULT_MAX_POSTS, onProgress } = {}) {
    return this.enqueue(async () => {
      const site = this.deps.getSite(siteId);
      if (!site) return { ok: false, reason: 'unknown-site' };

      const found = await this.look(site);
      await this.record(site, found);
      if (found.state !== 'ok' || !found.handle) {
        return { ok: false, reason: found.state === 'ok' ? 'no-handle' : found.state };
      }

      const win = await this.open(site, `${this.origin}/${found.handle}`);
      try {
        let posts = [];
        let idle = 0;
        for (let step = 0; step < MAX_SCROLLS && posts.length < maxPosts && idle < IDLE_SCROLLS; step += 1) {
          // Read, then scroll as a separate step, then wait for X to draw more.
          const batch = await run(win.contents, buildXPostsScript(found.handle));
          const merged = mergePosts(posts, batch.posts);
          posts = merged.posts;
          idle = merged.added === 0 ? idle + 1 : 0;
          if (onProgress) onProgress({ siteId, found: posts.length });
          await run(win.contents, buildXScrollScript());
          await this.wait(1500);
        }
        posts.sort((a, b) => String(b.time).localeCompare(String(a.time)));
        return { ok: true, handle: found.handle, posts: posts.slice(0, maxPosts) };
      } finally {
        win.close();
      }
    });
  }
}

module.exports = { XService, FIRST_CHECK_DELAY_MS };
