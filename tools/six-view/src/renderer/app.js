'use strict';

/**
 * Renderer for the 3 x 2 grid.
 *
 * It only builds DOM and forwards commands - navigation, credentials and
 * auto-login all happen in the main process.
 */

const grid = document.getElementById('grid');
const notice = document.getElementById('notice');
const paneTemplate = document.getElementById('pane-template');

/** siteId -> { root, webview, els, signature } */
const panes = new Map();
let focusedSiteId = null;
let maximizedSiteId = null;

function paneSignature(site, partition) {
  return [site.url, partition, site.incognito ? '1' : '0'].join('|');
}

function showNotice(message) {
  if (!message) {
    notice.hidden = true;
    notice.textContent = '';
    return;
  }
  notice.hidden = false;
  notice.textContent = message;
}

function setFocused(siteId) {
  focusedSiteId = siteId;
  for (const [id, pane] of panes) {
    pane.root.classList.toggle('is-focused', id === siteId);
  }
}

function applyMaximized() {
  grid.classList.toggle('is-maximized', Boolean(maximizedSiteId));
  for (const [id, pane] of panes) {
    pane.root.classList.toggle('is-hidden', Boolean(maximizedSiteId) && id !== maximizedSiteId);
  }
}

function toggleMaximized(siteId) {
  maximizedSiteId = maximizedSiteId === siteId ? null : siteId;
  applyMaximized();
}

function createWebview(site, partition) {
  const webview = document.createElement('webview');
  webview.setAttribute('partition', partition);
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('src', site.url);
  return webview;
}

function buildPane(site, index, partition) {
  const fragment = paneTemplate.content.cloneNode(true);
  const root = fragment.querySelector('.pane');

  const els = {
    index: root.querySelector('.pane-index'),
    name: root.querySelector('.pane-name'),
    private: root.querySelector('.pane-private'),
    status: root.querySelector('.pane-status'),
    url: root.querySelector('.pane-url'),
    body: root.querySelector('.pane-body'),
    empty: root.querySelector('.pane-empty'),
  };

  els.index.textContent = String(index + 1);

  root.addEventListener('mousedown', () => setFocused(site.id), true);

  root.querySelectorAll('[data-command]').forEach((button) => {
    button.addEventListener('click', () => {
      setFocused(site.id);
      void window.sixview.paneCommand(site.id, button.dataset.command);
    });
  });

  root.querySelector('[data-action="maximize"]').addEventListener('click', () => {
    setFocused(site.id);
    toggleMaximized(site.id);
  });

  root.querySelector('[data-action="logout"]').addEventListener('click', () => {
    void window.sixview.clearSession(site.id);
  });

  root.querySelector('[data-action="settings"]').addEventListener('click', () => {
    window.sixview.openSettings();
  });

  els.name.addEventListener('dblclick', () => toggleMaximized(site.id));

  const pane = { root, els, webview: null, signature: '' };
  panes.set(site.id, pane);
  grid.appendChild(root);
  updatePaneShell(pane, site, partition);
  return pane;
}

/** Update everything except the webview itself. */
function updatePaneShell(pane, site, partition) {
  pane.els.name.textContent = site.name;
  pane.els.name.title = site.name;
  pane.els.private.hidden = !site.incognito;
  pane.els.url.textContent = site.url || '';
  pane.root.dataset.partition = partition;
}

/** (Re)create the webview when the URL / partition changed. */
function syncPaneContent(pane, site, partition) {
  const signature = paneSignature(site, partition);
  if (pane.signature === signature) return;
  pane.signature = signature;

  if (pane.webview) {
    pane.webview.remove();
    pane.webview = null;
  }

  if (!site.url) {
    pane.els.empty.hidden = false;
    pane.els.status.className = 'pane-status';
    return;
  }

  pane.els.empty.hidden = true;
  pane.webview = createWebview(site, partition);
  pane.els.body.appendChild(pane.webview);
}

function applyState(state) {
  const pane = panes.get(state.siteId);
  if (!pane) return;

  if (typeof state.url === 'string' && state.url) {
    pane.els.url.textContent = state.url;
    pane.els.url.title = state.url;
  }

  if (state.error) {
    pane.els.status.className = 'pane-status is-error';
    pane.els.status.title = state.error;
    return;
  }

  if (state.loading === true) {
    pane.els.status.className = 'pane-status is-loading';
    pane.els.status.title = '読み込み中';
  } else if (state.loading === false) {
    pane.els.status.className = 'pane-status is-ready';
    pane.els.status.title = '読み込み完了';
  }

  if (state.autofill) {
    const labels = {
      filled: '自動ログイン: 入力しました',
      skipped: '自動ログイン: 入力欄が見つかりません',
      'no-credentials': '自動ログイン: ID/パスワードが未登録です',
      error: '自動ログイン: 失敗しました',
    };
    pane.els.status.title = labels[state.autofill] || pane.els.status.title;
  }
}

function render(bootstrap) {
  const { config, partitions } = bootstrap;

  grid.style.setProperty('--columns', String(bootstrap.columns || 3));
  document.querySelector('.brand-mark').textContent = String(config.sites.length);
  if (bootstrap.appName) {
    document.querySelector('.brand-name').textContent = bootstrap.appName;
    document.title = bootstrap.appName;
  }

  const messages = [];
  if (bootstrap.configError) messages.push(bootstrap.configError);
  if (!bootstrap.encryptionAvailable) {
    messages.push(
      'OS の安全な保存領域が使えないため、ID/パスワードは保存できません。ログイン状態の保持（Cookie）のみ利用できます。'
    );
  }
  showNotice(messages.join('  /  '));

  config.sites.forEach((site, index) => {
    const partition = partitions[site.id];
    const pane = panes.get(site.id) || buildPane(site, index, partition);
    updatePaneShell(pane, site, partition);
    syncPaneContent(pane, site, partition);
  });

  // Drop panes whose site id disappeared (config replaced wholesale).
  const liveIds = new Set(config.sites.map((site) => site.id));
  for (const [id, pane] of panes) {
    if (liveIds.has(id)) continue;
    pane.root.remove();
    panes.delete(id);
    if (focusedSiteId === id) focusedSiteId = null;
    if (maximizedSiteId === id) maximizedSiteId = null;
  }

  if (!focusedSiteId && config.sites.length > 0) setFocused(config.sites[0].id);
  applyMaximized();
}

document.getElementById('reload-all').addEventListener('click', () => window.sixview.reloadAll());
document.getElementById('login-all').addEventListener('click', () => window.sixview.loginAll());
document.getElementById('open-settings').addEventListener('click', () => window.sixview.openSettings());

window.sixview.on('pane:state', applyState);
window.sixview.on('pane:focus', (payload) => setFocused(payload.siteId));
window.sixview.on('pane:toggle-maximize', () => {
  if (focusedSiteId) toggleMaximized(focusedSiteId);
});
window.sixview.on('app:config-changed', render);

window.sixview.bootstrap().then(render);
