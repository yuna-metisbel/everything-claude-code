/**
 * X poster - Cloudflare Worker entry.
 *
 *   GET  /                 dashboard (password)
 *   POST /posts            queue a post (now or scheduled)
 *   POST /connect          make a one-time X sign-in link
 *   GET  /oauth/callback   X sends the account back here
 *   POST /telegram/webhook Telegram commands (secret header + one chat only)
 *   GET  /api/context      accounts and recent posts, for the morning drafter
 *   POST /api/drafts       the morning drafter hands in suggestions (DRAFTS_KEY)
 *   cron (every minute)    send what is due
 */

import { sameText, signSession, verifySession } from './lib/crypto.mjs';
import {
  cancelPost,
  confirmPost,
  draftContext,
  findAccount,
  disconnectAccount,
  dispatchDue,
  finishConnect,
  listAccounts,
  listPosts,
  postUrl,
  queuePost,
  startConnect,
} from './lib/core.mjs';
import { handleUpdate, registerWebhook, say, sendDraft } from './lib/telegram.mjs';
import { parseJst } from './lib/text.mjs';
import { dashboardPage, loginPage, resultPage } from './ui.mjs';

const COOKIE = 'xp_session';

const html = (body, status = 200, headers = {}) =>
  new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      ...headers,
    },
  });

const redirect = (to, headers = {}) => new Response(null, { status: 303, headers: { Location: to, ...headers } });

function cookieOf(request, name) {
  const raw = request.headers.get('Cookie') || '';
  const hit = raw.split(/;\s*/).find((part) => part.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
}

async function signedIn(request, env) {
  return verifySession(env.SECRET_KEY, cookieOf(request, COOKIE));
}

/** The secret Telegram sends back with every update, derived from SECRET_KEY. */
async function telegramSecret(env) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.SECRET_KEY}:telegram`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

function back(text, ok) {
  return redirect(`/?m=${encodeURIComponent(text)}&ok=${ok ? 1 : 0}`);
}

/** Send what is due and tell Telegram how it went. */
async function runDispatch(env) {
  const outcomes = await dispatchDue(env);
  for (const o of outcomes) {
    const text = o.ok
      ? `投稿しました（#${o.id} @${o.handle}）\n${postUrl(o.handle, o.tweetId)}`
      : `投稿できませんでした（#${o.id} @${o.handle}）\n${o.error}\n\n${o.text.slice(0, 60)}`;
    await say(env, text);
  }
  return outcomes;
}

async function dashboard(request, env, extra = {}) {
  const url = new URL(request.url);
  const flash = url.searchParams.get('m') ? { text: url.searchParams.get('m'), ok: url.searchParams.get('ok') === '1' } : null;
  const [accounts, upcoming, history] = await Promise.all([
    listAccounts(env),
    listPosts(env, { upcoming: true }),
    listPosts(env, { upcoming: false, limit: 20 }),
  ]);
  return html(
    dashboardPage({
      accounts,
      upcoming,
      history,
      flash,
      connectUrl: extra.connectUrl || '',
      telegramReady: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    })
  );
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

/**
 * The morning drafter's door. Its key can read what was posted lately and
 * hand in suggestions - nothing it sends is posted until a person presses a
 * button, so a leaked key cannot post anything.
 */
async function draftsApi(request, env, pathname) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.DRAFTS_KEY || !(await sameText(given, env.DRAFTS_KEY))) return json({ ok: false, error: 'unauthorized' }, 401);

  if (pathname === '/api/context' && request.method === 'GET') return json({ ok: true, ...(await draftContext(env)) });

  if (pathname === '/api/drafts' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const drafts = Array.isArray(body.drafts) ? body.drafts.slice(0, 40) : [];
    const results = [];
    for (const draft of drafts) {
      const account = await findAccount(env, draft.handle);
      if (!account || account.status === 'removed') {
        results.push({ handle: draft.handle, ok: false, error: 'unknown-account' });
        continue;
      }
      const at = parseJst(String(draft.at || ''));
      if (!Number.isFinite(at)) {
        results.push({ handle: draft.handle, ok: false, error: 'bad-time' });
        continue;
      }
      const queued = await queuePost(env, { accountId: account.id, text: draft.text, at, source: 'drafter', draft: true });
      if (!queued.ok) {
        results.push({ handle: draft.handle, ok: false, error: queued.error });
        continue;
      }
      await sendDraft(env, { id: queued.id, handle: account.handle, at, text: String(draft.text).trim(), note: String(draft.note || '').slice(0, 40) });
      results.push({ handle: account.handle, ok: true, id: queued.id });
    }
    return json({ ok: true, results });
  }
  return json({ ok: false, error: 'not-found' }, 404);
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (pathname.startsWith('/api/')) return draftsApi(request, env, pathname);

  // --- open to the world, each with its own check ---
  if (pathname === '/telegram/webhook' && method === 'POST') {
    const given = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
    if (!(await sameText(given, await telegramSecret(env)))) return new Response('forbidden', { status: 403 });
    const update = await request.json().catch(() => ({}));
    ctx.waitUntil(handleUpdate(env, update, { afterConfirm: () => runDispatch(env) }).catch((err) => console.log('telegram', err)));
    return new Response('ok');
  }

  if (pathname === '/oauth/callback' && method === 'GET') {
    if (url.searchParams.get('error')) return html(resultPage('連携', '連携がキャンセルされました。', false));
    const result = await finishConnect(env, {
      code: url.searchParams.get('code'),
      state: url.searchParams.get('state'),
    });
    if (result.ok) ctx.waitUntil(say(env, `@${result.handle} を連携しました`));
    return html(
      resultPage('連携', result.ok ? `@${result.handle} を連携しました。` : `連携できませんでした: ${result.error}`, result.ok),
      result.ok ? 200 : 400
    );
  }

  if (pathname === '/login' && method === 'POST') {
    const form = await request.formData();
    const ok = env.ADMIN_PASSWORD && (await sameText(form.get('password'), env.ADMIN_PASSWORD));
    if (!ok) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return html(loginPage('パスワードが違います'), 401);
    }
    const session = await signSession(env.SECRET_KEY);
    return redirect('/', {
      'Set-Cookie': `${COOKIE}=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 24 * 3600}`,
    });
  }

  // --- everything below needs the admin session ---
  if (!(await signedIn(request, env))) {
    return method === 'GET' ? html(loginPage()) : new Response('forbidden', { status: 403 });
  }

  if (pathname === '/' && method === 'GET') return dashboard(request, env);

  if (pathname === '/logout' && method === 'POST') {
    return redirect('/', { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  }

  if (pathname === '/posts' && method === 'POST') {
    const form = await request.formData();
    const rawAt = String(form.get('at') || '').trim();
    const at = rawAt ? parseJst(rawAt.replace('T', ' ')) : NaN;
    if (rawAt && !Number.isFinite(at)) return back('日時が読めません', false);
    const queued = await queuePost(env, {
      accountId: Number(form.get('account')),
      text: form.get('text'),
      at,
      source: 'web',
      confirmed: true,
    });
    if (!queued.ok) return back(queued.error, false);
    const now = queued.at <= Date.now() + 1000;
    if (now) ctx.waitUntil(runDispatch(env));
    return back(now ? `@${queued.handle} に投稿しています（#${queued.id}）。結果は下に出ます` : `@${queued.handle} に予約しました（#${queued.id}）`, true);
  }

  let m = pathname.match(/^\/posts\/(\d+)\/approve$/);
  if (m && method === 'POST') {
    const done = await confirmPost(env, Number(m[1]));
    if (done.ok && done.due) ctx.waitUntil(runDispatch(env));
    return back(done.ok ? `#${m[1]} を予約しました` : done.error, done.ok);
  }

  m = pathname.match(/^\/posts\/(\d+)\/cancel$/);
  if (m && method === 'POST') {
    const done = await cancelPost(env, Number(m[1]));
    return back(done.ok ? `#${m[1]} を取り消しました` : `#${m[1]} は取り消せません`, done.ok);
  }

  m = pathname.match(/^\/accounts\/(\d+)\/remove$/);
  if (m && method === 'POST') {
    await disconnectAccount(env, Number(m[1]));
    return back('連携を解除しました', true);
  }

  if (pathname === '/connect' && method === 'POST') {
    if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET) return back('X の Client ID / Secret がまだ設定されていません', false);
    return dashboard(request, env, { connectUrl: await startConnect(env) });
  }

  if (pathname === '/telegram/register' && method === 'POST') {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return back('Telegram のトークンかチャット ID が未設定です', false);
    const res = await registerWebhook(env, await telegramSecret(env));
    if (res.ok) ctx.waitUntil(say(env, 'X 投稿管理とつながりました。/help で使い方を表示します'));
    return back(res.ok ? 'Telegram とつながりました' : `Telegram につなげませんでした: ${res.description || ''}`, Boolean(res.ok));
  }

  return new Response('not found', { status: 404 });
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      console.log('error', err && err.stack);
      return html(resultPage('エラー', 'エラーが起きました。もう一度試してください。', false), 500);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runDispatch(env));
  },
};
