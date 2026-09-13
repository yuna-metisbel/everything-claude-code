'use strict';

/**
 * The DM bridge runtime.
 *
 * Watches each pane's message list, pushes new messages to Telegram, and posts
 * replies back into the pane they came from. Everything it needs from the app
 * is injected, so the wiring in main.js stays thin and this file can be driven
 * by a fake in tests.
 *
 * Two rules shape the whole design:
 *
 *   - only a *reply* to one of our own notifications is ever posted back, so a
 *     stray message in the Telegram chat can never be sent to a customer;
 *   - the bot token lives in the credential vault and is read here, never in
 *     the renderer and never in the config file.
 */

const { TelegramClient } = require('./lib/telegram');
const { DmBridge } = require('./lib/dm-bridge');
const {
  buildDmEnsureListScript,
  buildDmOpenThreadScript,
  buildDmScanScript,
  buildDmTypeScript,
  buildPickerScript,
} = require('./lib/dm-script');
const { dmCanSend, dmIsUsable } = require('./lib/config-schema');

/** Give a pane a moment after launch before the first scan. */
const FIRST_SCAN_DELAY_MS = 8000;
/** How long Telegram holds an idle long-poll open. */
const DEFAULT_POLL_SECONDS = 30;
/** Back off this long after a failed poll so a bad token does not spin. */
const POLL_ERROR_BACKOFF_MS = 15000;
/** How long to let a page settle after a click that navigates. */
const NAVIGATION_SETTLE_MS = 2000;

/**
 * Run a script in a pane.
 *
 * A click that navigates tears the page's JS context down, which rejects the
 * pending call. That is an expected outcome here, not a failure: it is reported
 * as `context-lost` so the caller can confirm by looking at the page instead.
 */
async function run(contents, script) {
  try {
    const result = await contents.executeJavaScript(script, true);
    return result && typeof result === 'object' ? result : { ok: false, reason: 'no-result' };
  } catch (err) {
    const message = String((err && err.message) || err);
    if (/destroyed|Script failed to execute|context/i.test(message)) {
      return { ok: false, reason: 'context-lost' };
    }
    return { ok: false, reason: 'script-error', message };
  }
}

/** Wait for a navigation to finish, or for the settle window to lapse. */
function settle(contents, ms = NAVIGATION_SETTLE_MS) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      contents.removeListener('did-stop-loading', finish);
      resolve();
    };
    contents.once('did-stop-loading', finish);
    setTimeout(finish, ms);
  });
}

/** Plain-language reasons, for the message that goes back to Telegram. */
const SEND_PROBLEMS = {
  'thread-not-found': 'その会話が一覧に見つかりません',
  'list-not-found': 'メッセージ一覧を開けません',
  'input-not-found': '入力欄が見つかりません',
  'send-not-found': '送信ボタンが見つかりません',
  'not-configured': '設定が終わっていません',
  'no-rows': 'メッセージ一覧を開けません',
  'open-not-found': 'DM ボタンが見つかりません',
  'script-error': 'ページを操作できませんでした',
};

class DmService {
  /**
   * @param {{
   *   getConfig: () => object,
   *   getSite: (siteId: string) => object|null,
   *   getContents: (siteId: string) => object|null,
   *   getToken: () => string,
   *   confirmSend?: (info: object) => Promise<boolean>,
   *   onStatus?: (status: object) => void,
   *   log?: (...args: any[]) => void,
   * }} deps
   */
  constructor(deps) {
    this.deps = deps;
    this.bridge = new DmBridge();
    this.client = new TelegramClient({ token: '' });

    /** siteId -> interval handle */
    this.timers = new Map();
    /** siteId -> true while a scan is in flight (a slow page must not stack) */
    this.scanning = new Set();

    this.polling = false;
    this.pollAbort = null;
    this.botUsername = '';
    this.lastError = '';
    this.sentCount = 0;
    this.deliveredCount = 0;
  }

  log(...args) {
    if (this.deps.log) this.deps.log('[dm]', ...args);
  }

  get telegramConfig() {
    const config = this.deps.getConfig();
    return (config && config.telegram) || { enabled: false, chatId: '', pollSeconds: DEFAULT_POLL_SECONDS };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** (Re)build every timer and the poll loop from the current config. */
  refresh() {
    this.stopTimers();

    const config = this.deps.getConfig();
    const telegram = this.telegramConfig;
    this.client.token = (this.deps.getToken() || '').trim();

    const watched = (config.sites || []).filter(dmIsUsable);

    for (const site of watched) {
      const everyMs = Math.max(20, Number(site.dm.intervalSeconds) || 90) * 1000;
      const handle = setInterval(() => void this.scan(site.id), everyMs);
      if (handle.unref) handle.unref();
      this.timers.set(site.id, handle);

      const first = setTimeout(() => void this.scan(site.id), FIRST_SCAN_DELAY_MS);
      if (first.unref) first.unref();
    }

    // Panes that stopped being watched should not keep a stale baseline: if
    // they are switched back on later, the first scan primes again instead of
    // reporting everything that happened in between.
    const live = new Set(watched.map((site) => site.id));
    for (const siteId of [...this.bridge.seen.keys()]) {
      if (!live.has(siteId)) this.bridge.forget(siteId);
    }

    if (telegram.enabled && this.client.configured) this.startPolling();
    else this.stopPolling();

    this.emitStatus();
  }

  stopTimers() {
    for (const handle of this.timers.values()) clearInterval(handle);
    this.timers.clear();
  }

  stop() {
    this.stopTimers();
    this.stopPolling();
  }

  status() {
    return {
      running: this.timers.size > 0,
      watching: this.timers.size,
      polling: this.polling,
      tokenStored: this.client.configured,
      botUsername: this.botUsername,
      sent: this.sentCount,
      delivered: this.deliveredCount,
      lastError: this.lastError,
    };
  }

  emitStatus() {
    if (this.deps.onStatus) this.deps.onStatus(this.status());
  }

  // -------------------------------------------------------------------------
  // Watching panes
  // -------------------------------------------------------------------------

  /**
   * Scan one pane and push anything new to Telegram.
   * @returns {Promise<object>} the raw scan result, for the "test now" button
   */
  async scan(siteId) {
    const site = this.deps.getSite(siteId);
    const contents = this.deps.getContents(siteId);
    if (!site || !dmIsUsable(site)) return { ok: false, reason: 'not-configured' };
    if (!contents || contents.isDestroyed()) return { ok: false, reason: 'pane-not-loaded' };
    if (this.scanning.has(siteId)) return { ok: false, reason: 'busy' };

    this.scanning.add(siteId);
    try {
      const result = await this.readList(site, contents);
      if (!result || result.ok !== true) return result;

      const { primed, notify } = this.bridge.diff(siteId, result.rows);
      if (!primed && notify.length > 0) await this.notify(site, notify);
      return { ...result, primed, notified: primed ? 0 : notify.length };
    } finally {
      this.scanning.delete(siteId);
    }
  }

  /**
   * Get the conversation list, opening the DM screen first when the pane is
   * sitting somewhere else. Reading is a separate pass from clicking so a
   * navigation cannot cut the read short.
   */
  async readList(site, contents) {
    const first = await run(contents, buildDmScanScript(site.dm));
    if (first.ok) return first;
    if (first.reason !== 'no-rows') return first;

    // Two hops at most: a conversation may need "back" first, and the screen
    // it lands on may still need the DM tab.
    for (let hop = 0; hop < 2; hop += 1) {
      const opened = await run(contents, buildDmEnsureListScript(site.dm));
      if (!opened.ok && opened.reason !== 'context-lost') return opened;

      await settle(contents);
      const again = await run(contents, buildDmScanScript(site.dm));
      if (again.ok || again.reason !== 'no-rows') return again;
    }

    return { ok: false, reason: 'no-rows', rows: [] };
  }

  /** Push one pane's new rows out, remembering how to reply to each. */
  async notify(site, rows) {
    const telegram = this.telegramConfig;
    if (!telegram.enabled || !telegram.chatId || !this.client.configured) return;

    for (const row of rows) {
      const text = this.bridge.formatNotification(site.name, row);
      const res = await this.client.sendMessage(telegram.chatId, text);
      if (!res.ok) {
        this.lastError = `Telegram送信に失敗: ${res.error}`;
        this.log(`telegram send failed: ${res.error}`);
        this.emitStatus();
        return;
      }
      this.bridge.rememberRoute(res.messageId, site.id, row);
      this.sentCount += 1;
    }
    this.lastError = '';
    this.emitStatus();
  }

  // -------------------------------------------------------------------------
  // Replies coming back
  // -------------------------------------------------------------------------

  startPolling() {
    if (this.polling) return;
    this.polling = true;
    void this.pollLoop();
  }

  stopPolling() {
    this.polling = false;
    if (this.pollAbort) {
      this.pollAbort.abort();
      this.pollAbort = null;
    }
  }

  async pollLoop() {
    while (this.polling) {
      const telegram = this.telegramConfig;
      if (!telegram.enabled || !this.client.configured) break;

      this.pollAbort = new AbortController();
      const res = await this.client.getUpdates({
        timeoutSeconds: telegram.pollSeconds || DEFAULT_POLL_SECONDS,
        signal: this.pollAbort.signal,
      });
      this.pollAbort = null;

      if (!this.polling) break;

      if (!res.ok) {
        // A timed-out long poll is the normal idle case, not a failure.
        if (res.error !== 'timeout') {
          this.lastError = `Telegram受信に失敗: ${res.error}`;
          this.emitStatus();
          await new Promise((resolve) => setTimeout(resolve, POLL_ERROR_BACKOFF_MS));
        }
        continue;
      }

      for (const update of res.updates) {
        const instruction = this.bridge.resolveReply(update);
        if (instruction) await this.deliver(instruction);
        else await this.explainIgnored(update);
      }
    }
    this.polling = false;
  }

  /**
   * Say why a message was not forwarded, but only for a plain message in the
   * bridge's own chat - staying quiet would look like the reply had been sent.
   */
  async explainIgnored(update) {
    const message = update && update.message;
    if (!message || typeof message.text !== 'string') return;
    if (message.text.startsWith('/')) return;

    const telegram = this.telegramConfig;
    if (!telegram.chatId || String(message.chat && message.chat.id) !== String(telegram.chatId)) return;

    await this.client.sendMessage(
      telegram.chatId,
      '送信できません。02に送るには、通知メッセージを「リプライ」する形で返信してください。',
      { replyToMessageId: message.message_id }
    );
  }

  /** Post one reply into the pane it belongs to, then report back. */
  async deliver(instruction) {
    const site = this.deps.getSite(instruction.siteId);
    const telegram = this.telegramConfig;
    const reply = (text) =>
      this.client.sendMessage(telegram.chatId, text, { replyToMessageId: instruction.messageId });

    if (!site || !dmCanSend(site)) {
      await reply('送信できません。このパネルは返信の設定が終わっていません。');
      return;
    }

    const contents = this.deps.getContents(instruction.siteId);
    if (!contents || contents.isDestroyed()) {
      await reply(`送信できません。${site.name} のパネルが開いていません。`);
      return;
    }

    if (telegram.confirmBeforeSend && this.deps.confirmSend) {
      const approved = await this.deps.confirmSend({
        siteName: site.name,
        name: instruction.name,
        text: instruction.text,
      });
      if (!approved) {
        await reply('送信を取り消しました（PC側でキャンセル）。');
        return;
      }
    }

    const result = await this.postReply(site, contents, instruction);

    if (result.ok) {
      // Our own text becomes the list preview; do not bounce it back out.
      this.bridge.suppressNext(instruction.siteId, instruction.key);
      this.deliveredCount += 1;
      await reply(
        result.verified
          ? `送信しました → ${site.name} / ${instruction.name}`
          : `送信しました（確認は取れませんでした） → ${site.name} / ${instruction.name}\n02View で届いているか見てください。`
      );
    } else {
      await reply(`送信できませんでした（${SEND_PROBLEMS[result.reason] || result.reason || 'unknown'}）。02View で確認してください。`);
    }
    this.emitStatus();
  }

  /**
   * Open the conversation, type the reply, submit it, then confirm.
   *
   * Both the open and the submit usually navigate, so each is its own pass and
   * the outcome is checked by re-reading the list rather than trusted from the
   * script that was torn down mid-click.
   */
  async postReply(site, contents, instruction) {
    const listed = await this.readList(site, contents);
    if (!listed.ok) return { ok: false, reason: listed.reason };

    const opened = await run(contents, buildDmOpenThreadScript(site.dm, instruction.key));
    if (!opened.ok && opened.reason !== 'context-lost') return { ok: false, reason: opened.reason };
    await settle(contents);

    const typed = await run(contents, buildDmTypeScript(site.dm, instruction.text));
    if (!typed.ok && typed.reason !== 'context-lost') return { ok: false, reason: typed.reason };
    await settle(contents);

    // Confirm from the list: our text should now be this conversation's latest.
    const after = await this.readList(site, contents);
    const row = after.ok ? (after.rows || []).find((entry) => entry.key === instruction.key) : null;
    const verified = Boolean(row && row.preview && instruction.text.startsWith(row.preview.slice(0, 8)));

    // The list is re-read here, so record it as the new baseline rather than
    // letting the next poll report our own message as news.
    if (after.ok) this.bridge.diff(site.id, after.rows);

    return { ok: true, verified };
  }

  // -------------------------------------------------------------------------
  // Setup helpers
  // -------------------------------------------------------------------------

  /** Let the user click the element they mean, inside the real page. */
  async pick(siteId, options = {}) {
    const contents = this.deps.getContents(siteId);
    if (!contents || contents.isDestroyed()) return { ok: false, reason: 'pane-not-loaded' };
    contents.focus();
    try {
      const result = await contents.executeJavaScript(buildPickerScript(options), true);
      return result && typeof result === 'object' ? result : { ok: false, reason: 'no-result' };
    } catch (err) {
      this.log(`picker failed for ${siteId}: ${err.message}`);
      return { ok: false, reason: 'script-error' };
    }
  }

  /**
   * Check a token and chat id by actually sending a message, so the user sees
   * the bridge work end to end before any customer message goes near it.
   */
  async testToken(token, chatId) {
    const probe = new TelegramClient({ token, fetchImpl: this.client.fetchImpl });
    if (!probe.configured) return { ok: false, reason: 'bad-token' };

    const me = await probe.getMe();
    if (!me.ok) return { ok: false, reason: me.error };
    this.botUsername = me.username;

    if (!chatId) return { ok: true, username: me.username, sent: false };

    const sent = await probe.sendMessage(chatId, '02View: 接続テストです。これが届いていれば設定は完了です。');
    if (!sent.ok) return { ok: false, reason: sent.error, username: me.username };

    return { ok: true, username: me.username, sent: true };
  }
}

module.exports = { DmService, FIRST_SCAN_DELAY_MS };
