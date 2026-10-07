/**
 * Tests for tools/x-poster (Cloudflare Worker that posts to X through the API).
 *
 * D1 is stood in for by node:sqlite with the real schema, and the X and
 * Telegram APIs by a fetch that answers from a table.
 *
 * Run with: node tests/tools/x-poster.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const toolRoot = path.resolve(__dirname, '../../tools/x-poster');

/** Enough of the D1 API for the poster, over an in-memory SQLite. */
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(toolRoot, 'schema.sql'), 'utf8'));
  const statement = (sql, params = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => db.prepare(sql).get(...params) || null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => {
      const r = db.prepare(sql).run(...params);
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return { prepare: (sql) => statement(sql), raw: db };
}

/** fetch stand-in for api.x.com and api.telegram.org. */
function fakeApis({ postFails = false } = {}) {
  const calls = [];
  let nextTweet = 1000;
  const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body), json: async () => body });
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/oauth2/token')) {
      const form = new URLSearchParams(String(options.body));
      return reply(200, { access_token: `at-${form.get('grant_type')}`, refresh_token: 'rt-new', expires_in: 7200 });
    }
    if (url.endsWith('/users/me')) return reply(200, { data: { id: '42', username: 'willymatze', name: 'もち.' } });
    if (url.endsWith('/tweets')) {
      if (postFails) return reply(402, { title: 'CreditsDepleted', detail: 'no credits' });
      nextTweet += 1;
      return reply(201, { data: { id: String(nextTweet) } });
    }
    if (url.includes('api.telegram.org')) return reply(200, { ok: true, result: {} });
    return reply(404, {});
  };
  impl.calls = calls;
  return impl;
}

function env(db) {
  return {
    DB: db,
    SECRET_KEY: 'test-secret-key-0123456789',
    X_CLIENT_ID: 'cid',
    X_CLIENT_SECRET: 'csecret',
    PUBLIC_URL: 'https://x-poster.example.workers.dev',
    TELEGRAM_BOT_TOKEN: '123456:abc',
    TELEGRAM_CHAT_ID: '777',
    ADMIN_PASSWORD: 'pw',
  };
}

async function main() {
  const text = await import(path.join(toolRoot, 'src/lib/text.mjs'));
  const cryptoLib = await import(path.join(toolRoot, 'src/lib/crypto.mjs'));
  const core = await import(path.join(toolRoot, 'src/lib/core.mjs'));
  const telegram = await import(path.join(toolRoot, 'src/lib/telegram.mjs'));
  const ui = await import(path.join(toolRoot, 'src/ui.mjs'));

  let passed = 0;
  let failed = 0;
  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed += 1;
    } catch (err) {
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${err.message}`);
      failed += 1;
    }
  }

  console.log('\n=== Testing x-poster ===\n');

  /** Connect @willymatze through the OAuth flow, as X would. */
  async function connected(e, apis) {
    const link = await core.startConnect(e);
    const state = new URL(link).searchParams.get('state');
    const result = await core.finishConnect(e, { code: 'code-1', state }, apis);
    assert.strictEqual(result.ok, true, result.error);
    return (await core.listAccounts(e))[0];
  }

  await test('X counts Japanese as two and links as 23', () => {
    assert.strictEqual(text.weightedLength('hello'), 5);
    assert.strictEqual(text.weightedLength('こんにちは'), 10);
    assert.strictEqual(text.weightedLength('見て https://example.com/a/very/long/path'), 4 + 1 + 23);
    assert.strictEqual(text.textProblem('あ'.repeat(140)), '');
    assert.ok(/長すぎ/.test(text.textProblem('あ'.repeat(141))));
    assert.ok(/空/.test(text.textProblem('   ')));
  });

  await test('Japan times are read the ways people write them', () => {
    const now = Date.UTC(2026, 9, 7, 3, 0); // 2026-10-07 12:00 JST
    const jst = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 9, mi);
    assert.strictEqual(text.parseJst('2026-10-08 21:00', now), jst(2026, 10, 8, 21, 0));
    assert.strictEqual(text.parseJst('10/8 9:05', now), jst(2026, 10, 8, 9, 5));
    assert.strictEqual(text.parseJst('明日 9:00', now), jst(2026, 10, 8, 9, 0));
    assert.strictEqual(text.parseJst('21:00', now), jst(2026, 10, 7, 21, 0));
    assert.strictEqual(text.parseJst('9:00', now), jst(2026, 10, 8, 9, 0), 'a time already past means tomorrow');
    assert.strictEqual(text.parseJst('１０/８ ２１：００', now), jst(2026, 10, 8, 21, 0), 'full-width digits');
    assert.ok(Number.isNaN(text.parseJst('25:00', now)));
    assert.ok(Number.isNaN(text.parseJst('そのうち', now)));
    assert.strictEqual(text.formatJst(jst(2026, 10, 8, 21, 0)), '2026/10/08 21:00');
  });

  await test('the same words in different clothes are one text', () => {
    assert.strictEqual(text.normalizeForDuplicate('今日も 暑い！！'), text.normalizeForDuplicate('今日も暑い'));
    assert.strictEqual(text.normalizeForDuplicate('ＡＢＣ https://a.example/1'), text.normalizeForDuplicate('abc https://b.example/2'));
    assert.notStrictEqual(text.normalizeForDuplicate('今日も暑い'), text.normalizeForDuplicate('今日は暑い'));
  });

  await test('tokens are sealed and sessions expire', async () => {
    const sealed = await cryptoLib.seal('k', 'access-token');
    assert.ok(!sealed.includes('access-token'));
    assert.strictEqual(await cryptoLib.open('k', sealed), 'access-token');
    await assert.rejects(() => cryptoLib.open('other-key', sealed));
    const session = await cryptoLib.signSession('k', 1000, 0);
    assert.strictEqual(await cryptoLib.verifySession('k', session, 500), true);
    assert.strictEqual(await cryptoLib.verifySession('k', session, 1500), false, 'expired');
    assert.strictEqual(await cryptoLib.verifySession('other', session, 500), false, 'wrong key');
    assert.strictEqual(await cryptoLib.verifySession('k', `9999999999999.${session.split('.')[1]}`, 500), false, 'tampered');
  });

  await test('connecting keeps the tokens sealed and the link works once', async () => {
    const db = fakeD1();
    const e = env(db);
    const apis = fakeApis();
    const link = await core.startConnect(e);
    const u = new URL(link);
    assert.strictEqual(u.origin + u.pathname, 'https://x.com/i/oauth2/authorize');
    assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://x-poster.example.workers.dev/oauth/callback');
    assert.ok(u.searchParams.get('scope').includes('tweet.write'));
    const state = u.searchParams.get('state');

    const first = await core.finishConnect(e, { code: 'c', state }, apis);
    assert.deepStrictEqual(first, { ok: true, handle: 'willymatze' });
    const again = await core.finishConnect(e, { code: 'c', state }, apis);
    assert.strictEqual(again.ok, false, 'a used link is spent');

    const row = db.raw.prepare('SELECT * FROM accounts').get();
    assert.ok(!row.access_sealed.includes('at-'), 'the access token is not stored in the clear');
    assert.strictEqual(await cryptoLib.open(e.SECRET_KEY, row.access_sealed), 'at-authorization_code');
  });

  await test('one text cannot go out from two accounts', async () => {
    const db = fakeD1();
    const e = env(db);
    const acct = await connected(e, fakeApis());
    db.raw.prepare(
      "INSERT INTO accounts (x_user_id, handle, access_sealed, created_at) VALUES ('43', 'dahoue77262574', 'x', 0)"
    ).run();

    const a = await core.queuePost(e, { accountId: acct.id, text: '新作できました', source: 'web', confirmed: true });
    assert.strictEqual(a.ok, true);
    const b = await core.queuePost(e, { accountId: 2, text: '新作 できました！', source: 'web', confirmed: true });
    assert.strictEqual(b.ok, false);
    assert.ok(/@willymatze/.test(b.error), b.error);
    const c = await core.queuePost(e, { accountId: 2, text: '別の文です', source: 'web', confirmed: true });
    assert.strictEqual(c.ok, true);

    await core.cancelPost(e, a.id);
    const d = await core.queuePost(e, { accountId: 2, text: '新作できました', source: 'web', confirmed: true });
    assert.strictEqual(d.ok, true, 'a canceled post frees its text');
  });

  await test('due posts go out once, scheduled ones wait, failures are not retried', async () => {
    const db = fakeD1();
    const e = env(db);
    const apis = fakeApis();
    const acct = await connected(e, apis);
    const now = Date.now();
    const soon = await core.queuePost(e, { accountId: acct.id, text: '今すぐ', source: 'web', confirmed: true });
    const later = await core.queuePost(e, { accountId: acct.id, text: 'あとで', at: now + 3600e3, source: 'web', confirmed: true });

    const first = await core.dispatchDue(e, apis, now + 1000);
    assert.deepStrictEqual(first.map((o) => [o.id, o.ok]), [[soon.id, true]]);
    assert.strictEqual((await core.dispatchDue(e, apis, now + 2000)).length, 0, 'never twice');
    const posts = apis.calls.filter((c) => c.url.endsWith('/tweets'));
    assert.strictEqual(posts.length, 1);
    assert.deepStrictEqual(JSON.parse(posts[0].options.body), { text: '今すぐ' });

    const failing = fakeApis({ postFails: true });
    const due = await core.dispatchDue(e, failing, now + 3600e3 + 1);
    assert.strictEqual(due[0].id, later.id);
    assert.strictEqual(due[0].ok, false);
    assert.ok(/クレジット/.test(due[0].error), due[0].error);
    assert.strictEqual((await core.dispatchDue(e, failing, now + 7200e3)).length, 0, 'a failure is left for a person');
  });

  await test('an expiring token is refreshed before posting, and the new one kept', async () => {
    const db = fakeD1();
    const e = env(db);
    const apis = fakeApis();
    const acct = await connected(e, apis);
    db.raw.prepare('UPDATE accounts SET expires_at = 0').run();
    await core.queuePost(e, { accountId: acct.id, text: '更新テスト', source: 'web', confirmed: true });
    const out = await core.dispatchDue(e, apis);
    assert.strictEqual(out[0].ok, true);
    const tweet = apis.calls.find((c) => c.url.endsWith('/tweets'));
    assert.strictEqual(tweet.options.headers.Authorization, 'Bearer at-refresh_token');
    const row = db.raw.prepare('SELECT * FROM accounts').get();
    assert.ok(row.expires_at > Date.now());
    assert.strictEqual(await cryptoLib.open(e.SECRET_KEY, row.refresh_sealed), 'rt-new');
  });

  await test('Telegram commands are read, with the date taken off the text', () => {
    const now = Date.UTC(2026, 9, 7, 3, 0);
    const p = telegram.parseCommand('/post @willymatze こんにちは 世界', now);
    assert.deepStrictEqual([p.command, p.handle, p.text], ['post', 'willymatze', 'こんにちは 世界']);
    const y = telegram.parseCommand('/yoyaku @willymatze 10/8 21:00 夜の投稿です', now);
    assert.strictEqual(y.text, '夜の投稿です');
    assert.strictEqual(y.at, Date.UTC(2026, 9, 8, 12, 0));
    const t = telegram.parseCommand('/yoyaku @willymatze 21:00 今夜', now);
    assert.strictEqual(t.text, '今夜');
    assert.ok(telegram.parseCommand('/yoyaku @willymatze いつか 本文', now).error);
    assert.ok(telegram.parseCommand('/post こんにちは', now).error);
    assert.strictEqual(telegram.parseCommand('/list@MyBot', now).command, 'list');
  });

  await test('Telegram asks before posting, and listens to one chat only', async () => {
    const db = fakeD1();
    const e = env(db);
    const apis = fakeApis();
    await connected(e, apis);

    const stranger = await telegram.handleUpdate(e, { message: { chat: { id: 1 }, text: '/post @willymatze やあ' } }, { fetchImpl: apis });
    assert.deepStrictEqual(stranger, { ignored: true });
    assert.strictEqual(db.raw.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 0);

    await telegram.handleUpdate(e, { message: { chat: { id: 777 }, text: '/post @willymatze やあ' } }, { fetchImpl: apis });
    const post = db.raw.prepare('SELECT * FROM posts').get();
    assert.strictEqual(post.status, 'pending', 'nothing is queued until the button is pressed');
    const sent = apis.calls.filter((c) => c.url.endsWith('/sendMessage')).pop();
    const body = JSON.parse(sent.options.body);
    assert.ok(body.text.includes('やあ'));
    assert.deepStrictEqual(body.reply_markup.inline_keyboard[0].map((b) => b.callback_data), [`ok:${post.id}`, `no:${post.id}`]);
    assert.strictEqual((await core.dispatchDue(e, apis)).length, 0, 'a pending post is never sent');

    let dispatched = 0;
    await telegram.handleUpdate(
      e,
      { callback_query: { id: 'q', data: `ok:${post.id}`, message: { chat: { id: 777 }, message_id: 5, text: 'x' } } },
      { fetchImpl: apis, afterConfirm: async () => { dispatched += 1; } }
    );
    assert.strictEqual(db.raw.prepare('SELECT status FROM posts').get().status, 'scheduled');
    assert.strictEqual(dispatched, 1, 'a post due now goes out at once');
  });

  await test('a morning draft waits for a button, then books its suggested time', async () => {
    const db = fakeD1();
    const e = env(db);
    const apis = fakeApis();
    const acct = await connected(e, apis);
    const at = Date.now() + 3 * 3600e3;
    const draft = await core.queuePost(e, { accountId: acct.id, text: '朝の案です', at, source: 'drafter', draft: true });
    assert.strictEqual(draft.status, 'draft');
    assert.strictEqual((await core.dispatchDue(e, apis, at + 1000)).length, 0, 'a draft is never posted by itself');

    const twin = await core.queuePost(e, { accountId: acct.id, text: '朝の案です！', source: 'drafter', draft: true });
    assert.strictEqual(twin.ok, false, 'two drafts with the same words are one too many');

    await telegram.sendDraft(e, { id: draft.id, handle: 'willymatze', at, text: '朝の案です', note: 'お昼休み' }, apis);
    const sent = JSON.parse(apis.calls.filter((c) => c.url.endsWith('/sendMessage')).pop().options.body);
    assert.deepStrictEqual(sent.reply_markup.inline_keyboard[0].map((b) => b.callback_data), [`sch:${draft.id}`, `now:${draft.id}`, `no:${draft.id}`]);

    await telegram.handleUpdate(
      e,
      { callback_query: { id: 'q', data: `sch:${draft.id}`, message: { chat: { id: 777 }, message_id: 1, text: 'x' } } },
      { fetchImpl: apis }
    );
    const row = db.raw.prepare('SELECT status, scheduled_at FROM posts WHERE id = ?').get(draft.id);
    assert.deepStrictEqual([row.status, row.scheduled_at], ['scheduled', at], 'booked for the suggested time, not now');
  });

  await test('drafts nobody picks are dropped, and the drafter sees recent posts', async () => {
    const db = fakeD1();
    const e = env(db);
    const apis = fakeApis();
    const acct = await connected(e, apis);
    const old = await core.queuePost(e, { accountId: acct.id, text: '古い案', at: Date.now() + 60e3, source: 'drafter', draft: true });
    await core.queuePost(e, { accountId: acct.id, text: '投稿予定', at: Date.now() + 60e3, source: 'web', confirmed: true });
    const ctx = await core.draftContext(e);
    assert.deepStrictEqual(ctx.accounts.map((a) => a.handle), ['willymatze']);
    assert.ok(ctx.accounts[0].recent.includes('投稿予定'));

    await core.dispatchDue(e, apis, Date.now() + 8 * 3600e3);
    assert.strictEqual(db.raw.prepare('SELECT status FROM posts WHERE id = ?').get(old.id).status, 'canceled');
  });

  await test('the web screen escapes what it prints', () => {
    const page = ui.dashboardPage({
      accounts: [{ id: 1, handle: 'a', name: '<b>', status: 'ok' }],
      upcoming: [{ id: 2, handle: 'a', text: '<script>alert(1)</script>', status: 'scheduled', scheduled_at: Date.now() }],
      history: [],
      flash: { text: '"><img>', ok: false },
      connectUrl: '',
      telegramReady: false,
    });
    assert.ok(!page.includes('<script>alert(1)'));
    assert.ok(page.includes('&lt;script&gt;'));
    assert.ok(!page.includes('"><img>'));
  });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
