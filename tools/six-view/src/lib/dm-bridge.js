'use strict';

/**
 * DM bridge bookkeeping (pure module - no Electron, no network).
 *
 * Decides which scanned rows are worth a notification, formats them, and
 * remembers which Telegram message belongs to which conversation so a reply
 * can be routed back to the right person on the right account.
 *
 * Kept free of I/O so the rules can be unit tested without a browser or a bot.
 */

/** How many outgoing notifications stay repliable. Oldest are dropped first. */
const MAX_ROUTES = 500;

/** JSON keeps the three fields separable without reserving a delimiter. */
function signatureOf(row) {
  return JSON.stringify([row.name || '', row.preview || '', Boolean(row.unread)]);
}

function previewOfSignature(signature) {
  try {
    const parsed = JSON.parse(signature);
    return Array.isArray(parsed) ? parsed[1] || '' : '';
  } catch {
    return '';
  }
}

/** A name to show when the site gives us nothing useful. */
function displayName(row) {
  const name = row && row.name ? String(row.name).trim() : '';
  return name || '(名前なし)';
}

class DmBridge {
  constructor(options = {}) {
    this.maxRoutes = Number(options.maxRoutes) > 0 ? Number(options.maxRoutes) : MAX_ROUTES;
    /** siteId -> Map<key, signature> */
    this.seen = new Map();
    /** siteId -> Set<key> to skip once (our own reply changed the preview) */
    this.suppressed = new Map();
    /** telegram message_id -> { siteId, key, name } */
    this.routes = new Map();
  }

  /** True once a pane has been scanned, so the first scan can stay silent. */
  hasBaseline(siteId) {
    return this.seen.has(siteId);
  }

  /** Forget a pane entirely (pane removed, or monitoring turned off). */
  forget(siteId) {
    this.seen.delete(siteId);
    this.suppressed.delete(siteId);
  }

  /**
   * Ignore the next change on a conversation. Called right after the bridge
   * posts a reply, so our own text coming back as the list preview does not
   * bounce straight back out as a notification.
   */
  suppressNext(siteId, key) {
    if (!this.suppressed.has(siteId)) this.suppressed.set(siteId, new Set());
    this.suppressed.get(siteId).add(key);
  }

  /**
   * Compare a scan against what this pane looked like last time.
   *
   * The first scan only records a baseline - eight accounts' worth of history
   * should not arrive as notifications the moment the app starts.
   *
   * @returns {{primed: boolean, notify: Array<object>}}
   */
  diff(siteId, rows) {
    const list = Array.isArray(rows) ? rows.filter((row) => row && row.key) : [];
    const previous = this.seen.get(siteId);
    const next = new Map(list.map((row) => [row.key, signatureOf(row)]));

    if (!previous) {
      this.seen.set(siteId, next);
      return { primed: true, notify: [] };
    }

    const skip = this.suppressed.get(siteId);
    const notify = [];

    for (const row of list) {
      const before = previous.get(row.key);
      const after = signatureOf(row);
      if (before === after) continue;

      if (skip && skip.has(row.key)) {
        skip.delete(row.key);
        continue;
      }

      const previewChanged =
        before === undefined || previewOfSignature(before) !== (row.preview || '');

      // A row is worth reporting when it carries an unread marker, or when the
      // latest message text itself changed (sites that drop the badge as soon
      // as the list is rendered still show the new text).
      if (row.unread || previewChanged) notify.push(row);
    }

    this.seen.set(siteId, next);
    return { primed: false, notify };
  }

  /** Message body for one conversation. */
  formatNotification(siteName, row) {
    const head = `[${siteName}] ${displayName(row)}`;
    const body = row && row.preview ? String(row.preview).trim() : '';
    const foot = 'このメッセージに返信すると、02のこの相手に送信されます。';
    return `${head}\n${body || '(本文なし)'}\n\n${foot}`;
  }

  /**
   * Remember that a Telegram message stands for one conversation, so replying
   * to it routes back correctly. Oldest routes fall off the end.
   */
  rememberRoute(messageId, siteId, row) {
    if (!Number.isFinite(messageId)) return;
    this.routes.set(messageId, { siteId, key: row.key, name: displayName(row) });
    while (this.routes.size > this.maxRoutes) {
      const oldest = this.routes.keys().next();
      if (oldest.done) break;
      this.routes.delete(oldest.value);
    }
  }

  /**
   * Turn an incoming Telegram update into a send instruction.
   *
   * Only replies to one of our own notifications are acted on: a bare message
   * in the chat has no conversation attached to it, and guessing would mean
   * sending a customer someone else's answer.
   *
   * @returns {{siteId: string, key: string, name: string, text: string,
   *            chatId: number, messageId: number}|null}
   */
  resolveReply(update) {
    const message = update && update.message;
    if (!message || typeof message.text !== 'string' || !message.text.trim()) return null;

    const replyTo = message.reply_to_message;
    if (!replyTo || !Number.isFinite(replyTo.message_id)) return null;

    const route = this.routes.get(replyTo.message_id);
    if (!route) return null;

    return {
      siteId: route.siteId,
      key: route.key,
      name: route.name,
      text: message.text.trim(),
      chatId: message.chat && message.chat.id,
      messageId: message.message_id,
    };
  }
}

module.exports = { DmBridge, signatureOf, displayName, MAX_ROUTES };
