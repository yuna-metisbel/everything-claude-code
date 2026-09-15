'use strict';

/**
 * Pressing the boost button on a schedule.
 *
 * The site decides when a boost is available, not this file: it looks at the
 * button every few minutes and presses it only when the page is offering it.
 * That keeps the behaviour the same as a person watching for the button to
 * come back, and means nothing has to know a site's cooldown.
 *
 * Two guards keep it from becoming a hammer:
 *
 *   - a minimum gap between presses, for sites that never grey the button out;
 *   - an optional hours window, so a pane is not boosted at four in the
 *     morning when nobody is looking.
 */

const { buildBoostReadScript, buildBoostPressScript } = require('./lib/boost-script');
const { run, settle } = require('./lib/page-runner');
const { boostIsUsable, withinHours } = require('./lib/config-schema');

/** Give a pane time to load before the first look at its button. */
const FIRST_CHECK_DELAY_MS = 20000;

/** Plain-language reasons, for the settings window. */
const PROBLEMS = {
  'not-configured': 'ボタンの場所がまだ指定されていません。',
  'pane-not-loaded': 'パネルがまだ読み込まれていません。',
  'not-found': 'ボタンが見つかりません。指定し直してください。',
  'not-visible': 'ボタンが画面に出ていません。',
  'not-ready': 'まだ押せる状態ではありません（時間が来ていないようです）。',
  'outside-hours': '押す時間帯の外です。',
  'too-soon': '前に押してから間がないので見送りました。',
  'script-error': 'ページを読み取れませんでした。',
  'no-result': 'ページを読み取れませんでした。',
};

class BoostService {
  /**
   * @param {{
   *   getConfig: () => object,
   *   getSite: (siteId: string) => object|null,
   *   getContents: (siteId: string) => object|null,
   *   announce?: (text: string) => Promise<object>,
   *   now?: () => number,
   *   log?: (...args: unknown[]) => void,
   *   onStatus?: (status: object) => void,
   * }} deps
   */
  constructor(deps) {
    this.deps = deps;
    /** siteId -> interval handle */
    this.timers = new Map();
    /** siteId -> epoch ms of the last press we made */
    this.lastPressed = new Map();
    /** siteId -> true while a check is in flight, so a slow page cannot stack */
    this.checking = new Set();
    this.pressedCount = 0;
    this.lastError = '';
    this.lastResult = '';
  }

  log(...args) {
    if (this.deps.log) this.deps.log('[boost]', ...args);
  }

  now() {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /** (Re)build every timer from the current config. */
  refresh() {
    this.stopTimers();

    const config = this.deps.getConfig();
    const watched = (config.sites || []).filter(boostIsUsable);

    for (const site of watched) {
      const everyMs = Math.max(3, Number(site.boost.checkMinutes) || 10) * 60 * 1000;
      const handle = setInterval(() => void this.check(site.id), everyMs);
      if (handle.unref) handle.unref();
      this.timers.set(site.id, handle);

      const first = setTimeout(() => void this.check(site.id), FIRST_CHECK_DELAY_MS);
      if (first.unref) first.unref();
    }

    this.emitStatus();
  }

  stopTimers() {
    for (const handle of this.timers.values()) clearInterval(handle);
    this.timers.clear();
  }

  stop() {
    this.stopTimers();
  }

  status() {
    return {
      watching: this.timers.size,
      pressed: this.pressedCount,
      lastResult: this.lastResult,
      lastError: this.lastError,
    };
  }

  emitStatus() {
    if (this.deps.onStatus) this.deps.onStatus(this.status());
  }

  /** Human-readable form of a reason code, for the settings window. */
  static explain(reason) {
    return PROBLEMS[reason] || '押せませんでした。';
  }

  /**
   * Look at one pane's boost button and press it if it is being offered.
   *
   * @param {string} siteId
   * @param {{force?: boolean}} options `force` skips the hours window and the
   *   minimum gap, for the "press it now" button in settings. It never skips
   *   the page's own state: a button the site is refusing is still not pressed.
   * @returns {Promise<object>}
   */
  async check(siteId, options = {}) {
    const force = options.force === true;
    const site = this.deps.getSite(siteId);
    if (!site || !site.boost || !site.boost.selector) {
      return { ok: false, reason: 'not-configured' };
    }
    if (!force && !boostIsUsable(site)) return { ok: false, reason: 'not-configured' };

    const contents = this.deps.getContents(siteId);
    if (!contents || contents.isDestroyed()) return { ok: false, reason: 'pane-not-loaded' };

    if (this.checking.has(siteId)) return { ok: false, reason: 'busy' };
    this.checking.add(siteId);

    try {
      const boost = site.boost;
      const now = this.now();

      if (!force) {
        if (!withinHours(new Date(now).getHours(), boost.fromHour, boost.toHour)) {
          return { ok: true, pressed: false, reason: 'outside-hours' };
        }
        const last = this.lastPressed.get(siteId) || 0;
        const gapMs = Math.max(5, Number(boost.minGapMinutes) || 60) * 60 * 1000;
        if (last && now - last < gapMs) {
          return { ok: true, pressed: false, reason: 'too-soon' };
        }
      }

      const before = await run(contents, buildBoostReadScript(boost.selector));
      if (!before.ok) return before;
      if (!before.found) return { ok: true, pressed: false, reason: 'not-found', state: before };
      if (!before.pressable) {
        return {
          ok: true,
          pressed: false,
          reason: before.visible ? 'not-ready' : 'not-visible',
          state: before,
        };
      }

      const pressed = await run(contents, buildBoostPressScript(boost.selector));
      // The click can navigate, which kills the script mid-flight: that is a
      // press, not a failure, so only an outright refusal counts as one.
      if (!pressed.ok && pressed.reason !== 'context-lost') {
        return { ok: true, pressed: false, reason: pressed.reason, state: before };
      }

      await settle(contents);
      this.lastPressed.set(siteId, now);
      this.pressedCount += 1;

      // Confirm by looking again: a button that has gone or gone grey is proof
      // the site took it. One that is still offered leaves us unsure, which is
      // reported rather than glossed over - the gap guard stops a retry loop.
      const after = await run(contents, buildBoostReadScript(boost.selector));
      const confirmed = after.ok && (!after.found || !after.pressable);

      this.lastResult = `${site.name}: ${confirmed ? '押しました' : '押しましたが確認できませんでした'}`;
      this.lastError = '';
      this.log(`pressed ${siteId}${confirmed ? '' : ' (unconfirmed)'}`);
      this.emitStatus();

      if (boost.notify && this.deps.announce) {
        const note = confirmed
          ? `[${site.name}] ブーストを押しました。`
          : `[${site.name}] ブーストを押しましたが、反映されたか確認できませんでした。`;
        await this.deps.announce(note);
      }

      return { ok: true, pressed: true, confirmed, state: after };
    } catch (err) {
      this.lastError = String((err && err.message) || err);
      this.log(`check failed for ${siteId}: ${this.lastError}`);
      this.emitStatus();
      return { ok: false, reason: 'script-error' };
    } finally {
      this.checking.delete(siteId);
    }
  }
}

module.exports = { BoostService, FIRST_CHECK_DELAY_MS };
