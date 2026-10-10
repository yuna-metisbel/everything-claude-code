/**
 * The web screen. One column, readable on a phone, always light.
 * Everything that comes from the database is escaped before it is printed.
 */

import { formatJst, weightedLength } from './lib/text.mjs';

export function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
:root { --ink:#1a1a1a; --dim:#5c5c5c; --line:#e3e3e3; --pink:#e6007e; --green:#00a651; --red:#d90429; --bg:#ffffff; --soft:#f6f6f6; color-scheme: light; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.6 'Noto Sans JP', sans-serif; }
main { max-width:640px; margin:0 auto; padding:16px 16px 48px; }
h1 { font-size:22px; margin:8px 0 16px; }
h1 span { color:var(--pink); }
h2 { font-size:17px; margin:28px 0 10px; padding-left:10px; border-left:4px solid var(--pink); }
.card { border:1px solid var(--line); border-radius:12px; padding:14px; margin:10px 0; background:#fff; }
label { display:block; font-weight:700; font-size:14px; margin:12px 0 6px; }
select, textarea, input[type=text], input[type=password], input[type=datetime-local] { width:100%; font:inherit; color:var(--ink); padding:10px 12px; border:2px solid var(--line); border-radius:10px; background:#fff; }
select:focus, textarea:focus, input:focus { outline:none; border-color:var(--pink); }
textarea { min-height:140px; resize:vertical; }
.row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
.btn { display:inline-block; border:0; border-radius:10px; padding:12px 18px; font:inherit; font-weight:700; cursor:pointer; text-decoration:none; text-align:center; }
.btn-pink { background:var(--pink); color:#fff; }
.btn-green { background:var(--green); color:#fff; }
.btn-line { background:#fff; color:var(--ink); border:2px solid var(--line); }
.btn-small { padding:6px 12px; font-size:14px; }
.wide { width:100%; }
.count { font-size:13px; color:var(--dim); text-align:right; }
.count.over { color:var(--red); font-weight:700; }
.msg { padding:12px 14px; border-radius:10px; margin:10px 0; font-weight:700; }
.msg.ok { background:#e6f6ec; color:#00753a; }
.msg.err { background:#fde8eb; color:var(--red); }
.acct { display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--line); }
.acct:last-child { border-bottom:0; }
.tag { font-size:12px; font-weight:700; border-radius:999px; padding:2px 10px; }
.tag-ok { background:#e6f6ec; color:#00753a; }
.tag-warn { background:#fde8eb; color:var(--red); }
.tag-wait { background:#fff0f7; color:var(--pink); }
.post { padding:12px 0; border-bottom:1px solid var(--line); }
.post:last-child { border-bottom:0; }
.post-head { display:flex; justify-content:space-between; gap:8px; font-size:14px; color:var(--dim); }
.post-text { white-space:pre-wrap; overflow-wrap:anywhere; margin:6px 0; }
.hint { font-size:13px; color:var(--dim); }
.link-box { word-break:break-all; font-size:13px; background:var(--soft); padding:10px; border-radius:8px; }
a { color:var(--pink); }
`;

function page(title, body, script = '') {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="robots" content="noindex">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
<style>${STYLE}</style></head>
<body><main>${body}</main>${script ? `<script>${script}</script>` : ''}</body></html>`;
}

export function loginPage(error = '') {
  return page('ログイン', `
<h1>X 投稿<span>管理</span></h1>
${error ? `<div class="msg err">${esc(error)}</div>` : ''}
<form method="post" action="/login" class="card">
  <label for="pw">パスワード</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" required>
  <p><button class="btn btn-pink wide" type="submit">ログイン</button></p>
</form>`);
}

export function resultPage(title, message, ok) {
  return page(title, `
<h1>X 投稿<span>管理</span></h1>
<div class="msg ${ok ? 'ok' : 'err'}">${esc(message)}</div>
<p class="hint">この画面は閉じて大丈夫です。</p>`);
}

const STATUS = {
  draft: ['案', 'tag-wait'],
  pending: ['確認待ち', 'tag-wait'],
  scheduled: ['予約', 'tag-wait'],
  posting: ['投稿中', 'tag-wait'],
  posted: ['投稿済み', 'tag-ok'],
  failed: ['失敗', 'tag-warn'],
  canceled: ['取り消し', 'tag-warn'],
};

function postRow(post, { cancel = false } = {}) {
  const [label, cls] = STATUS[post.status] || [post.status, 'tag-wait'];
  const when = post.posted_at ? formatJst(post.posted_at) : formatJst(post.scheduled_at);
  const link = post.tweet_id
    ? ` <a href="https://x.com/${esc(post.handle)}/status/${esc(post.tweet_id)}" target="_blank" rel="noopener">見る</a>`
    : '';
  return `<div class="post">
  <div class="post-head"><span>#${post.id} @${esc(post.handle)} ・ ${esc(when)}</span><span class="tag ${cls}">${label}</span></div>
  <div class="post-text">${esc(post.text)}</div>
  ${post.error ? `<div class="hint" style="color:var(--red)">${esc(post.error)}</div>` : ''}
  <div class="row">${link}
  ${post.status === 'draft' ? `<form method="post" action="/posts/${post.id}/approve" onsubmit="return confirm('#${post.id} を ${esc(when)} に予約しますか？')"><button class="btn btn-pink btn-small" type="submit">この案を予約</button></form>` : ''}
  ${cancel ? `<form method="post" action="/posts/${post.id}/cancel" onsubmit="return confirm('#${post.id} を取り消しますか？')"><button class="btn btn-line btn-small" type="submit">取り消す</button></form>` : ''}
  </div>
</div>`;
}

export function dashboardPage({ accounts, upcoming, history, flash, connectUrl, telegramReady }) {
  const live = accounts.filter((a) => a.status !== 'removed');
  const options = live
    .map((a) => `<option value="${a.id}">@${esc(a.handle)}${a.name ? `（${esc(a.name)}）` : ''}</option>`)
    .join('');

  const body = `
<h1>X 投稿<span>管理</span></h1>
${flash ? `<div class="msg ${flash.ok ? 'ok' : 'err'}">${esc(flash.text)}</div>` : ''}

<h2>投稿する</h2>
${live.length === 0 ? '<p class="hint">まだアカウントがありません。下の「アカウントの連携」から始めてください。</p>' : `
<form method="post" action="/posts" class="card" id="post-form">
  <label for="account">アカウント</label>
  <select id="account" name="account">${options}</select>
  <label for="text">本文</label>
  <textarea id="text" name="text" required></textarea>
  <div class="count" id="count">0 / 280</div>
  <label for="at">日時（空欄ならすぐ投稿）</label>
  <input id="at" name="at" type="datetime-local">
  <p class="hint">日本時間です。同じ文を別のアカウントで使うことはできません。</p>
  <button class="btn btn-pink wide" type="submit" id="submit">投稿する</button>
</form>`}

<h2>予約・確認待ち</h2>
<div class="card">${upcoming.length ? upcoming.map((p) => postRow(p, { cancel: p.status !== 'posting' })).join('') : '<p class="hint">ありません</p>'}</div>

<h2>最近の結果</h2>
<div class="card">${history.length ? history.map((p) => postRow(p)).join('') : '<p class="hint">ありません</p>'}</div>

<h2>アカウントの連携</h2>
<div class="card">
  ${live.map((a) => `<div class="acct"><span>@${esc(a.handle)}</span>
    <span class="row"><span class="tag ${a.status === 'ok' ? 'tag-ok' : 'tag-warn'}">${a.status === 'ok' ? '連携中' : '要再連携'}</span>
    <form method="post" action="/accounts/${a.id}/remove" onsubmit="return confirm('@${esc(a.handle)} の連携を解除しますか？予約も取り消されます')"><button class="btn btn-line btn-small" type="submit">解除</button></form></span></div>`).join('')}
  ${connectUrl ? `
    <p><strong>連携リンクを作りました（30分有効・1回だけ使えます）</strong></p>
    <div class="link-box" id="link">${esc(connectUrl)}</div>
    <p class="row"><button class="btn btn-green btn-small" type="button" id="copy">リンクをコピー</button></p>
    <p class="hint">02View で、連携したいアカウントのパネルのアドレス欄にこのリンクを貼って開き、「許可する」を押してください。アカウントごとに新しいリンクを作ります。</p>` : `
    <form method="post" action="/connect"><button class="btn btn-green wide" type="submit">連携リンクを作る</button></form>`}
</div>

<h2>Telegram</h2>
<div class="card">
  <p class="hint">${telegramReady ? '設定済みです。ボットに /help と送ると使い方が出ます。' : 'ボットのトークンとチャット ID を設定すると使えます。'}</p>
  <form method="post" action="/telegram/register"><button class="btn btn-line wide" type="submit">Telegram をつなぐ（つなぎ直す）</button></form>
</div>

<form method="post" action="/logout"><p><button class="btn btn-line wide" type="submit">ログアウト</button></p></form>`;

  const script = `
(function () {
  var text = document.getElementById('text');
  var count = document.getElementById('count');
  function weight(s) {
    var n = 0;
    s = s.replace(/https?:\\/\\/\\S+/g, function () { n += 23; return ''; });
    for (var ch of s) { var c = ch.codePointAt(0); n += (c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037)) ? 1 : 2; }
    return n;
  }
  if (text) text.addEventListener('input', function () {
    var n = weight(text.value.trim());
    count.textContent = n + ' / 280';
    count.className = 'count' + (n > 280 ? ' over' : '');
  });
  var form = document.getElementById('post-form');
  if (form) form.addEventListener('submit', function (e) {
    var a = document.getElementById('account');
    var at = document.getElementById('at').value;
    var who = a.options[a.selectedIndex].text;
    if (!confirm(who + ' に' + (at ? at.replace('T', ' ') + ' に予約' : 'すぐ投稿') + 'します。よろしいですか？')) e.preventDefault();
  });
  var copy = document.getElementById('copy');
  if (copy) copy.addEventListener('click', function () {
    navigator.clipboard.writeText(document.getElementById('link').textContent).then(function () { copy.textContent = 'コピーしました'; });
  });
})();`;
  return page('X 投稿管理', body, script);
}

export { weightedLength };
