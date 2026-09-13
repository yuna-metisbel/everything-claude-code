'use strict';

/**
 * Minimal Telegram Bot API client (no dependencies).
 *
 * Long polling is used rather than a webhook so the bridge works from a home
 * PC with no public address and nothing to host.
 *
 * The token is held here and nowhere else; it is never logged, never sent to
 * the renderer, and never written to the config file (it lives in the
 * safeStorage-backed vault).
 */

const API_ROOT = 'https://api.telegram.org/bot';

/** Replace a token with a short fingerprint so logs can never leak it. */
function maskToken(token) {
  if (typeof token !== 'string' || token.length < 8) return '(unset)';
  return `${token.slice(0, 4)}...${token.slice(-3)}`;
}

/**
 * A bot token looks like `<digits>:<35 or so url-safe chars>`. Checked so a
 * typo is reported in settings rather than silently failing every poll.
 */
function looksLikeToken(token) {
  return typeof token === 'string' && /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token.trim());
}

class TelegramClient {
  /**
   * @param {{token?: string, fetchImpl?: Function}} options
   */
  constructor(options = {}) {
    this.token = typeof options.token === 'string' ? options.token.trim() : '';
    this.fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    this.offset = 0;
  }

  get configured() {
    return looksLikeToken(this.token) && typeof this.fetchImpl === 'function';
  }

  async call(method, body, { timeoutMs = 15000, signal } = {}) {
    if (!this.configured) return { ok: false, error: 'not-configured' };

    const controller = signal ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await this.fetchImpl(`${API_ROOT}${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: signal || (controller ? controller.signal : undefined),
      });
      const payload = await response.json();
      if (!payload || payload.ok !== true) {
        return { ok: false, error: (payload && payload.description) || `http-${response.status}` };
      }
      return { ok: true, result: payload.result };
    } catch (err) {
      return { ok: false, error: err && err.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Confirm the token works and report the bot's @name. */
  async getMe() {
    const res = await this.call('getMe', {}, { timeoutMs: 10000 });
    if (!res.ok) return res;
    return { ok: true, username: res.result.username || '', id: res.result.id };
  }

  /**
   * @param {string|number} chatId
   * @param {string} text
   * @param {{replyToMessageId?: number, threadId?: number}} options
   */
  async sendMessage(chatId, text, options = {}) {
    const body = {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    };
    if (options.replyToMessageId) body.reply_to_message_id = options.replyToMessageId;
    if (options.threadId) body.message_thread_id = options.threadId;

    const res = await this.call('sendMessage', body, { timeoutMs: 15000 });
    if (!res.ok) return res;
    return { ok: true, messageId: res.result.message_id, chatId: res.result.chat.id };
  }

  /**
   * Long poll for new updates. `timeoutSeconds` is how long Telegram holds the
   * request open when nothing has arrived, so an idle bridge costs one request
   * per interval rather than constant traffic.
   */
  async getUpdates({ timeoutSeconds = 30, signal } = {}) {
    const res = await this.call(
      'getUpdates',
      {
        offset: this.offset || undefined,
        timeout: timeoutSeconds,
        allowed_updates: ['message'],
      },
      { timeoutMs: (timeoutSeconds + 10) * 1000, signal }
    );

    if (!res.ok) return { ok: false, error: res.error, updates: [] };

    const updates = Array.isArray(res.result) ? res.result : [];
    for (const update of updates) {
      if (update && Number.isFinite(update.update_id)) {
        this.offset = Math.max(this.offset, update.update_id + 1);
      }
    }
    return { ok: true, updates };
  }
}

module.exports = { TelegramClient, looksLikeToken, maskToken, API_ROOT };
