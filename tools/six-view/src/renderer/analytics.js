'use strict';

/**
 * Post analysis window.
 *
 * Asks the main process to read one account's own posts, then shows them as a
 * table that sorts by any column. Nothing here touches X directly.
 */

const accountSelect = document.getElementById('account');
const maxSelect = document.getElementById('max-posts');
const runButton = document.getElementById('run');
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const table = document.getElementById('table');
const rowsEl = document.getElementById('rows');

let posts = [];
let sortKey = 'views';
let sortDesc = true;
let running = false;

const REASONS = {
  'logged-out': 'このアカウントはログアウトしています。X タブでログインし直してください。',
  locked: 'このアカウントはロックされています。',
  suspended: 'このアカウントは凍結されています。',
  unknown: 'アカウントの状態を確認できませんでした。少し待ってもう一度試してください。',
  'no-handle': 'アカウント名を読み取れませんでした。',
  'unknown-site': 'このパネルは見つかりません。',
};

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('is-error', isError);
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString('ja-JP');
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function likeRate(post) {
  return post.views > 0 ? post.likes / post.views : 0;
}

function renderAccounts(status) {
  const accounts = (status && status.accounts) || [];
  const keep = accountSelect.value;
  accountSelect.textContent = '';
  for (const account of accounts) {
    const option = document.createElement('option');
    option.value = account.siteId;
    option.textContent = account.handle ? `${account.name}（@${account.handle}）` : account.name;
    accountSelect.appendChild(option);
  }
  if (keep && accounts.some((account) => account.siteId === keep)) accountSelect.value = keep;
  runButton.disabled = running || accounts.length === 0;
  if (accounts.length === 0) setStatus('X のタブがある時だけ使えます。');
}

function renderSummary() {
  const total = (key) => posts.reduce((sum, post) => sum + (post[key] || 0), 0);
  const views = total('views');
  const likes = total('likes');
  const stats = [
    ['投稿数', formatNumber(posts.length)],
    ['合計表示', formatNumber(views)],
    ['合計いいね', formatNumber(likes)],
    ['1投稿あたり表示', formatNumber(Math.round(views / Math.max(1, posts.length)))],
    ['いいね率', views > 0 ? `${((likes / views) * 100).toFixed(2)}%` : '-'],
  ];
  summaryEl.textContent = '';
  for (const [label, value] of stats) {
    const box = document.createElement('div');
    box.className = 'stat';
    const l = document.createElement('div');
    l.className = 'stat-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'stat-value';
    v.textContent = value;
    box.append(l, v);
    summaryEl.appendChild(box);
  }
  summaryEl.hidden = posts.length === 0;
}

function sortedPosts() {
  const value = (post) => {
    if (sortKey === 'rate') return likeRate(post);
    if (sortKey === 'time' || sortKey === 'text') return String(post[sortKey] || '');
    return post[sortKey] || 0;
  };
  return [...posts].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const order = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return sortDesc ? -order : order;
  });
}

function renderTable() {
  table.hidden = posts.length === 0;
  for (const th of table.querySelectorAll('th')) {
    const on = th.dataset.sort === sortKey;
    th.classList.toggle('is-sorted', on);
    th.dataset.arrow = on ? (sortDesc ? ' ▼' : ' ▲') : '';
    th.textContent = th.textContent.replace(/ [▼▲]$/, '') + th.dataset.arrow;
  }

  rowsEl.textContent = '';
  for (const post of sortedPosts()) {
    const tr = document.createElement('tr');
    tr.title = 'ブラウザでこの投稿を開く';
    const cells = [
      [formatTime(post.time), ''],
      [post.text || (post.hasMedia ? '（画像・動画のみ）' : '（本文なし）'), 'text'],
      [formatNumber(post.views), 'num'],
      [formatNumber(post.likes), 'num'],
      [formatNumber(post.reposts), 'num'],
      [formatNumber(post.replies), 'num'],
      [formatNumber(post.bookmarks), 'num'],
      [post.views > 0 ? `${(likeRate(post) * 100).toFixed(1)}%` : '-', 'num'],
    ];
    for (const [text, cls] of cells) {
      const td = document.createElement('td');
      if (cls) td.className = cls;
      td.textContent = text;
      tr.appendChild(td);
    }
    tr.addEventListener('click', () => void window.sixview.xOpenPost(post.url));
    rowsEl.appendChild(tr);
  }
}

table.querySelector('thead').addEventListener('click', (event) => {
  const th = event.target.closest('th');
  if (!th || !th.dataset.sort) return;
  if (sortKey === th.dataset.sort) {
    sortDesc = !sortDesc;
  } else {
    sortKey = th.dataset.sort;
    sortDesc = th.dataset.sort !== 'text';
  }
  renderTable();
});

runButton.addEventListener('click', async () => {
  const siteId = accountSelect.value;
  if (!siteId || running) return;
  running = true;
  runButton.disabled = true;
  setStatus('読み込んでいます…（100件で1〜2分かかります）');
  try {
    const result = await window.sixview.xAnalyze(siteId, Number(maxSelect.value));
    if (!result || !result.ok) {
      setStatus(REASONS[result && result.reason] || '読み込めませんでした。', true);
      return;
    }
    posts = result.posts || [];
    setStatus(`@${result.handle} の投稿を ${posts.length} 件読み込みました。`);
    renderSummary();
    renderTable();
  } catch (err) {
    setStatus(`読み込めませんでした: ${err.message}`, true);
  } finally {
    running = false;
    runButton.disabled = accountSelect.options.length === 0;
  }
});

window.sixview.on('x:progress', (progress) => {
  if (running && progress.siteId === accountSelect.value) {
    setStatus(`読み込んでいます… ${progress.found} 件`);
  }
});
window.sixview.on('x:status', renderAccounts);

window.sixview.xStatus().then(renderAccounts);
