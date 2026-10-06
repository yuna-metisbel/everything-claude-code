/**
 * What the poster does, independent of how it was asked (web or Telegram).
 *
 * `env` is the Worker environment: DB (D1), SECRET_KEY, X_CLIENT_ID,
 * X_CLIENT_SECRET, PUBLIC_URL. `fetchImpl` is injectable for tests.
 */

import { open, pkcePair, randomToken, seal } from './crypto.mjs';
import { textHash, textProblem } from './text.mjs';
import { authorizeUrl, createPost, exchangeCode, getMe, refreshToken } from './x-api.mjs';

/** One text, one account: the same words from two accounts is spam to X. */
const DUPLICATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Posts taken per minute, so one slow run cannot pile up. */
const BATCH = 10;
/** Refresh a token this long before it runs out. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const STATE_TTL_MS = 30 * 60 * 1000;

const LIVE = ['pending', 'scheduled', 'posting', 'posted'];

function app(env) {
  return { clientId: env.X_CLIENT_ID, clientSecret: env.X_CLIENT_SECRET };
}

export function redirectUri(env) {
  return `${String(env.PUBLIC_URL).replace(/\/$/, '')}/oauth/callback`;
}

// --- accounts -------------------------------------------------------------

export async function listAccounts(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, handle, name, status, created_at FROM accounts ORDER BY id'
  ).all();
  return results || [];
}

export async function findAccount(env, handleOrId) {
  const key = String(handleOrId || '').trim().replace(/^@/, '');
  if (!key) return null;
  return env.DB.prepare('SELECT * FROM accounts WHERE lower(handle) = lower(?1) OR id = ?2')
    .bind(key, /^\d+$/.test(key) ? Number(key) : -1)
    .first();
}

/** Start a sign-in: a one-time link the account opens while logged in to X. */
export async function startConnect(env) {
  const state = randomToken(24);
  const { verifier, challenge } = await pkcePair();
  await env.DB.prepare('DELETE FROM oauth_states WHERE created_at < ?1').bind(Date.now() - STATE_TTL_MS).run();
  await env.DB.prepare('INSERT INTO oauth_states (state, verifier, created_at) VALUES (?1, ?2, ?3)')
    .bind(state, verifier, Date.now())
    .run();
  return authorizeUrl({ clientId: env.X_CLIENT_ID, redirectUri: redirectUri(env), state, challenge });
}

/** X sent the account back with a code: keep its tokens. */
export async function finishConnect(env, { code, state }, fetchImpl = fetch) {
  if (!code || !state) return { ok: false, error: '連携の情報が足りません' };
  const row = await env.DB.prepare('SELECT verifier, created_at FROM oauth_states WHERE state = ?1').bind(state).first();
  await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?1').bind(state).run();
  if (!row || row.created_at < Date.now() - STATE_TTL_MS) {
    return { ok: false, error: '連携リンクの期限が切れています。管理画面で作り直してください' };
  }

  const token = await exchangeCode(fetchImpl, app(env), { code, verifier: row.verifier, redirectUri: redirectUri(env) });
  if (!token.ok) return token;
  const me = await getMe(fetchImpl, token.accessToken);
  if (!me.ok) return me;

  const access = await seal(env.SECRET_KEY, token.accessToken);
  const refresh = token.refreshToken ? await seal(env.SECRET_KEY, token.refreshToken) : '';
  await env.DB.prepare(
    `INSERT INTO accounts (x_user_id, handle, name, access_sealed, refresh_sealed, expires_at, status, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'ok', ?7)
     ON CONFLICT(x_user_id) DO UPDATE SET handle = ?2, name = ?3, access_sealed = ?4,
       refresh_sealed = ?5, expires_at = ?6, status = 'ok'`
  )
    .bind(me.id, me.handle, me.name || '', access, refresh, token.expiresAt, Date.now())
    .run();
  return { ok: true, handle: me.handle };
}

/** A usable access token, refreshed first when it is about to run out. */
async function accessTokenFor(env, account, fetchImpl) {
  if (account.expires_at - REFRESH_MARGIN_MS > Date.now()) {
    return { ok: true, token: await open(env.SECRET_KEY, account.access_sealed) };
  }
  if (!account.refresh_sealed) return { ok: false, error: '連携が切れています。もう一度連携してください' };

  const refreshed = await refreshToken(fetchImpl, app(env), await open(env.SECRET_KEY, account.refresh_sealed));
  if (!refreshed.ok) {
    await env.DB.prepare("UPDATE accounts SET status = 'reconnect' WHERE id = ?1").bind(account.id).run();
    return refreshed;
  }
  // X hands out a new refresh token each time; the old one stops working.
  await env.DB.prepare('UPDATE accounts SET access_sealed = ?1, refresh_sealed = ?2, expires_at = ?3, status = ?4 WHERE id = ?5')
    .bind(
      await seal(env.SECRET_KEY, refreshed.accessToken),
      refreshed.refreshToken ? await seal(env.SECRET_KEY, refreshed.refreshToken) : account.refresh_sealed,
      refreshed.expiresAt,
      'ok',
      account.id
    )
    .run();
  return { ok: true, token: refreshed.accessToken };
}

export async function disconnectAccount(env, id) {
  await env.DB.prepare("UPDATE posts SET status = 'canceled', error = '連携解除' WHERE account_id = ?1 AND status IN ('pending', 'scheduled')")
    .bind(id)
    .run();
  await env.DB.prepare("UPDATE accounts SET status = 'removed', access_sealed = '', refresh_sealed = '' WHERE id = ?1")
    .bind(id)
    .run();
}

// --- posts ----------------------------------------------------------------

/**
 * Queue a post. `confirmed: false` leaves it waiting for a yes (Telegram);
 * the web screen asks before it sends, so it queues confirmed.
 */
export async function queuePost(env, { accountId, text, at, source, confirmed }) {
  const body = String(text || '').trim();
  const problem = textProblem(body);
  if (problem) return { ok: false, error: problem };

  const account = await env.DB.prepare('SELECT id, handle, status FROM accounts WHERE id = ?1').bind(accountId).first();
  if (!account || account.status === 'removed') return { ok: false, error: 'そのアカウントは連携されていません' };

  const when = Number.isFinite(at) && at > Date.now() ? at : Date.now();
  const hash = await textHash(body);
  const placeholders = LIVE.map((_, i) => `?${i + 3}`).join(', ');
  const twin = await env.DB.prepare(
    `SELECT p.id, a.handle, p.account_id FROM posts p JOIN accounts a ON a.id = p.account_id
     WHERE p.text_hash = ?1 AND p.created_at > ?2 AND p.status IN (${placeholders}) LIMIT 1`
  )
    .bind(hash, Date.now() - DUPLICATE_WINDOW_MS, ...LIVE)
    .first();
  if (twin) {
    return {
      ok: false,
      error:
        twin.account_id === account.id
          ? `同じ内容をこのアカウントで30日以内に投稿済み（予約済み）です（#${twin.id}）`
          : `同じ内容が @${twin.handle} で使われています（#${twin.id}）。アカウントごとに違う文にしてください`,
    };
  }

  const status = confirmed ? 'scheduled' : 'pending';
  const result = await env.DB.prepare(
    `INSERT INTO posts (account_id, text, text_hash, status, scheduled_at, source, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(account.id, body, hash, status, when, source, Date.now())
    .run();
  return { ok: true, id: result.meta.last_row_id, handle: account.handle, at: when, status };
}

/** The yes for a pending post. A time that has passed meanwhile means now. */
export async function confirmPost(env, id) {
  const post = await env.DB.prepare("SELECT * FROM posts WHERE id = ?1 AND status = 'pending'").bind(id).first();
  if (!post) return { ok: false, error: 'その投稿は確認待ちではありません' };
  await env.DB.prepare("UPDATE posts SET status = 'scheduled', scheduled_at = ?1 WHERE id = ?2")
    .bind(Math.max(post.scheduled_at, Date.now()), id)
    .run();
  return { ok: true, due: post.scheduled_at <= Date.now() };
}

export async function cancelPost(env, id) {
  const done = await env.DB.prepare(
    "UPDATE posts SET status = 'canceled' WHERE id = ?1 AND status IN ('pending', 'scheduled')"
  )
    .bind(id)
    .run();
  return { ok: done.meta.changes > 0 };
}

export async function listPosts(env, { upcoming = false, limit = 30 } = {}) {
  const sql = upcoming
    ? `SELECT p.*, a.handle FROM posts p JOIN accounts a ON a.id = p.account_id
       WHERE p.status IN ('pending', 'scheduled', 'posting') ORDER BY p.scheduled_at LIMIT ?1`
    : `SELECT p.*, a.handle FROM posts p JOIN accounts a ON a.id = p.account_id
       WHERE p.status IN ('posted', 'failed', 'canceled') ORDER BY COALESCE(p.posted_at, p.created_at) DESC LIMIT ?1`;
  const { results } = await env.DB.prepare(sql).bind(limit).all();
  return results || [];
}

/**
 * Send what is due. Each post is claimed (scheduled -> posting) before it is
 * sent, so two runs that overlap cannot post it twice. Returns what happened,
 * for the Telegram report.
 */
export async function dispatchDue(env, fetchImpl = fetch, now = Date.now()) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM posts WHERE status = 'scheduled' AND scheduled_at <= ?1 ORDER BY scheduled_at LIMIT ?2"
  )
    .bind(now, BATCH)
    .all();

  const outcomes = [];
  for (const post of results || []) {
    const claim = await env.DB.prepare("UPDATE posts SET status = 'posting' WHERE id = ?1 AND status = 'scheduled'")
      .bind(post.id)
      .run();
    if (claim.meta.changes === 0) continue;

    const account = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?1').bind(post.account_id).first();
    let outcome;
    if (!account || account.status === 'removed') {
      outcome = { ok: false, error: 'アカウントの連携がありません' };
    } else {
      const token = await accessTokenFor(env, account, fetchImpl);
      outcome = token.ok ? await createPost(fetchImpl, token.token, post.text) : token;
    }

    if (outcome.ok) {
      await env.DB.prepare("UPDATE posts SET status = 'posted', posted_at = ?1, tweet_id = ?2, error = NULL WHERE id = ?3")
        .bind(Date.now(), outcome.id, post.id)
        .run();
    } else {
      // Never retried on its own: a post that X turned down once is better
      // looked at by a person than sent again and again.
      await env.DB.prepare("UPDATE posts SET status = 'failed', error = ?1 WHERE id = ?2")
        .bind(String(outcome.error || '失敗').slice(0, 300), post.id)
        .run();
    }
    outcomes.push({
      id: post.id,
      handle: account ? account.handle : '?',
      ok: outcome.ok,
      tweetId: outcome.id || '',
      error: outcome.error || '',
      text: post.text,
    });
  }
  return outcomes;
}

export function postUrl(handle, tweetId) {
  return `https://x.com/${handle}/status/${tweetId}`;
}
