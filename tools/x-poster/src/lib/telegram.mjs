/**
 * Telegram as a remote control.
 *
 * Only the one chat in TELEGRAM_CHAT_ID is listened to, and every post asks
 * "投稿する / やめる" with buttons before it is queued - a typo in a command
 * can never go straight out to an account.
 *
 * This bot must be a different bot from the 02View DM bridge: a bot that
 * delivers to this Worker (webhook) can no longer be polled by 02View.
 */

import { cancelPost, confirmPost, findAccount, listAccounts, listPosts, queuePost } from './core.mjs';
import { formatJst, parseJst, weightedLength } from './text.mjs';

const HELP = [
  '使い方',
  '',
  '/post @アカウント 本文',
  '  すぐ投稿（ボタンで確認してから）',
  '/yoyaku @アカウント 10/8 21:00 本文',
  '  予約投稿。日時は「2026-10-08 21:00」「明日 9:00」「21:00」も可',
  '/list  予約の一覧',
  '/cancel 番号  予約の取り消し',
  '/accounts  連携しているアカウント',
].join('\n');

async function call(env, method, body, fetchImpl = fetch) {
  const res = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ ok: false }));
}

export function say(env, text, extra = {}, fetchImpl = fetch) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return Promise.resolve({ ok: false });
  return call(env, 'sendMessage', { chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true, ...extra }, fetchImpl);
}

/**
 * "/yoyaku @handle 10/8 21:00 本文" -> { handle, at, text }. The date is one or
 * two words long; the longest reading that is a valid time wins.
 */
export function parseCommand(text, now = Date.now()) {
  const m = String(text || '').match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/);
  if (!m) return { command: '', args: '' };
  const command = m[1].toLowerCase();
  const args = m[2].trim();

  if (command === 'post' || command === 'yoyaku') {
    const h = args.match(/^@?([A-Za-z0-9_]{1,15})\s+([\s\S]+)$/);
    if (!h) return { command, error: 'アカウントと本文を入れてください（例: /post @handle こんにちは）' };
    const handle = h[1];
    let body = h[2].trim();
    let at = NaN;
    if (command === 'yoyaku') {
      const words = body.split(/\s+/);
      for (const take of [2, 1]) {
        const when = parseJst(words.slice(0, take).join(' '), now);
        if (Number.isFinite(when)) {
          at = when;
          body = body.replace(new RegExp(`^(\\S+\\s+){${take - 1}}\\S+\\s*`), '');
          break;
        }
      }
      if (!Number.isFinite(at)) return { command, error: '日時が読めません（例: 10/8 21:00、明日 9:00）' };
    }
    return { command, handle, at, text: body };
  }
  return { command, args };
}

function preview(post) {
  const when = post.at > Date.now() + 60 * 1000 ? `予約: ${formatJst(post.at)}` : 'すぐ投稿';
  return [`@${post.handle} に投稿します（#${post.id}）`, when, `${weightedLength(post.text)} / 280`, '', post.text].join('\n');
}

const buttons = (id) => ({
  reply_markup: {
    inline_keyboard: [[
      { text: '投稿する', callback_data: `ok:${id}` },
      { text: 'やめる', callback_data: `no:${id}` },
    ]],
  },
});

/**
 * Handle one Telegram update. `afterConfirm` runs when a post that is due now
 * was approved, so it goes out without waiting for the next minute.
 */
export async function handleUpdate(env, update, { afterConfirm, fetchImpl = fetch, now = Date.now() } = {}) {
  const fromChat = (update.message && update.message.chat && update.message.chat.id) ||
    (update.callback_query && update.callback_query.message && update.callback_query.message.chat.id);
  if (String(fromChat) !== String(env.TELEGRAM_CHAT_ID)) return { ignored: true };

  if (update.callback_query) {
    const q = update.callback_query;
    const [verb, rawId] = String(q.data || '').split(':');
    const id = Number(rawId);
    await call(env, 'answerCallbackQuery', { callback_query_id: q.id }, fetchImpl);
    const edit = (text) =>
      call(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text }, fetchImpl);
    if (verb === 'ok' || verb === 'sch' || verb === 'now') {
      const done = await confirmPost(env, id, { now: verb === 'now' });
      await edit(`${q.message.text}\n\n${done.ok ? (done.due ? '→ 投稿します' : `→ ${formatJst(done.at)} に予約しました`) : `→ ${done.error}`}`);
      if (done.ok && done.due && afterConfirm) await afterConfirm();
      return { confirmed: done.ok };
    }
    if (verb === 'no') {
      await cancelPost(env, id);
      await edit(`${q.message.text}\n\n→ やめました`);
      return { canceled: true };
    }
    return {};
  }

  const parsed = parseCommand(update.message && update.message.text, now);
  switch (parsed.command) {
    case 'post':
    case 'yoyaku': {
      if (parsed.error) return say(env, parsed.error, {}, fetchImpl);
      const account = await findAccount(env, parsed.handle);
      if (!account || account.status === 'removed') {
        return say(env, `@${parsed.handle} は連携されていません。/accounts で確認できます`, {}, fetchImpl);
      }
      const queued = await queuePost(env, {
        accountId: account.id,
        text: parsed.text,
        at: parsed.at,
        source: 'telegram',
        confirmed: false,
      });
      if (!queued.ok) return say(env, `投稿できません: ${queued.error}`, {}, fetchImpl);
      return say(env, preview({ ...queued, text: parsed.text }), buttons(queued.id), fetchImpl);
    }
    case 'list': {
      const posts = await listPosts(env, { upcoming: true });
      if (posts.length === 0) return say(env, '予約はありません', {}, fetchImpl);
      const lines = posts.map((p) => `#${p.id} ${formatJst(p.scheduled_at)} @${p.handle}${p.status === 'pending' ? '（確認待ち）' : ''}\n  ${p.text.slice(0, 40)}`);
      return say(env, lines.join('\n'), {}, fetchImpl);
    }
    case 'cancel': {
      const id = Number(String(parsed.args).replace(/^#/, ''));
      const done = id ? await cancelPost(env, id) : { ok: false };
      return say(env, done.ok ? `#${id} を取り消しました` : `#${parsed.args} は取り消せません（投稿済みか、番号違い）`, {}, fetchImpl);
    }
    case 'accounts': {
      const accounts = (await listAccounts(env)).filter((a) => a.status !== 'removed');
      const lines = accounts.map((a) => `@${a.handle}${a.status === 'reconnect' ? '（要再連携）' : ''}`);
      return say(env, lines.length ? lines.join('\n') : 'まだ連携しているアカウントはありません', {}, fetchImpl);
    }
    default:
      return say(env, HELP, {}, fetchImpl);
  }
}

/**
 * A morning suggestion, sent with its own buttons: book it for the suggested
 * time, post it now, or drop it. Nothing is queued until one is pressed.
 */
export function sendDraft(env, post, fetchImpl = fetch) {
  const text = [
    `【案 #${post.id}】@${post.handle}`,
    `おすすめ: ${formatJst(post.at)}${post.note ? `（${post.note}）` : ''}`,
    `${weightedLength(post.text)} / 280`,
    '',
    post.text,
  ].join('\n');
  return say(env, text, {
    reply_markup: {
      inline_keyboard: [[
        { text: `${formatJst(post.at).slice(11)} に予約`, callback_data: `sch:${post.id}` },
        { text: '今すぐ投稿', callback_data: `now:${post.id}` },
        { text: 'いらない', callback_data: `no:${post.id}` },
      ]],
    },
  }, fetchImpl);
}

/** Tell Telegram to deliver to this Worker, with a secret only we know. */
export function registerWebhook(env, secretToken, fetchImpl = fetch) {
  return call(env, 'setWebhook', {
    url: `${String(env.PUBLIC_URL).replace(/\/$/, '')}/telegram/webhook`,
    secret_token: secretToken,
    allowed_updates: ['message', 'callback_query'],
  }, fetchImpl);
}
