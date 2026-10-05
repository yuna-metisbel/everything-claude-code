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
const closedBar = document.getElementById('closed-bar');
const closedList = document.getElementById('closed-list');
const reopenForm = document.getElementById('reopen-form');
const reopenTitle = document.getElementById('reopen-title');
const reopenName = document.getElementById('reopen-name');
const reopenUrl = document.getElementById('reopen-url');
const reopenWipe = document.getElementById('reopen-wipe');
const reopenStatus = document.getElementById('reopen-status');
const pageSetBar = document.getElementById('page-sets');

/** siteId -> { root, webview, els, signature } */
const panes = new Map();
let focusedSiteId = null;
let maximizedSiteId = null;

/**
 * What has to change for a pane's page to be rebuilt. The URL here is the one
 * the active tab resolves to, not the pane's own, so picking a tab reloads
 * every pane onto it.
 */
function paneSignature(url, partition, site) {
  return [url, partition, site.incognito ? '1' : '0'].join('|');
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

function createWebview(url, partition) {
  const webview = document.createElement('webview');
  webview.setAttribute('partition', partition);
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('src', url);
  return webview;
}

/** Say something briefly in the pane's status tooltip area. */
function flashPane(pane, message) {
  pane.els.url.dataset.flash = message;
  pane.els.url.textContent = message;
  setTimeout(() => {
    if (pane.els.url.dataset.flash !== message) return;
    delete pane.els.url.dataset.flash;
    pane.els.url.textContent = pane.lastUrl || '';
  }, 2500);
}

/**
 * The address line turns into an input when clicked, so a pane can be pointed
 * at a different page without going through settings. Enter goes, Escape
 * cancels; the change is temporary until "set as this pane's page" is used.
 */
function wireAddressBar(pane, site) {
  const { url, urlInput } = pane.els;

  const close = () => {
    urlInput.hidden = true;
    url.hidden = false;
  };

  url.addEventListener('click', () => {
    urlInput.value = pane.lastUrl || site.url || '';
    url.hidden = true;
    urlInput.hidden = false;
    urlInput.focus();
    urlInput.select();
  });

  urlInput.addEventListener('keydown', async (event) => {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (event.key !== 'Enter') return;

    const wanted = urlInput.value.trim();
    close();
    if (!wanted) return;

    const result = await window.sixview.paneNavigate(site.id, wanted);
    if (!result || !result.ok) flashPane(pane, 'そのページは開けません');
  });

  urlInput.addEventListener('blur', close);
}

function buildPane(site, index, partition, url) {
  const fragment = paneTemplate.content.cloneNode(true);
  const root = fragment.querySelector('.pane');

  const els = {
    index: root.querySelector('.pane-index'),
    name: root.querySelector('.pane-name'),
    private: root.querySelector('.pane-private'),
    status: root.querySelector('.pane-status'),
    url: root.querySelector('.pane-url'),
    urlInput: root.querySelector('.pane-url-input'),
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

  // Closing a pane only takes it out of the grid: settings, saved credential
  // and cookies all stay, and it comes back from the bar at the top.
  root.querySelector('[data-action="close"]').addEventListener('click', () => {
    void window.sixview.paneUpdate(site.id, { enabled: false });
  });

  // Make whatever is on screen this pane's start page.
  root.querySelector('[data-action="set-home"]').addEventListener('click', async () => {
    const current = pane.els.url.textContent.trim();
    if (!current) return;
    const result = await window.sixview.paneUpdate(site.id, { url: current });
    flashPane(pane, result && result.ok ? 'このページを次回から開きます' : 'この住所は設定できません');
  });

  els.name.addEventListener('dblclick', () => toggleMaximized(site.id));

  const pane = { root, els, webview: null, signature: '', lastUrl: url || '' };
  wireAddressBar(pane, site);
  panes.set(site.id, pane);
  grid.appendChild(root);
  updatePaneShell(pane, site, partition, url);
  return pane;
}

/** Update everything except the webview itself. */
function updatePaneShell(pane, site, partition, url) {
  pane.els.name.textContent = site.name;
  pane.els.name.title = site.name;
  pane.els.private.hidden = !site.incognito;
  pane.els.url.textContent = url || '';
  pane.root.dataset.partition = partition;
}

/** (Re)create the webview when the URL / partition changed. */
function syncPaneContent(pane, site, partition, url) {
  const signature = paneSignature(url, partition, site);
  if (pane.signature === signature) return;
  pane.signature = signature;

  if (pane.webview) {
    pane.webview.remove();
    pane.webview = null;
  }

  if (!url) {
    pane.els.empty.hidden = false;
    pane.els.status.className = 'pane-status';
    return;
  }

  pane.els.empty.hidden = true;
  pane.webview = createWebview(url, partition);
  pane.els.body.appendChild(pane.webview);
}

function applyState(state) {
  const pane = panes.get(state.siteId);
  if (!pane) return;

  if (typeof state.url === 'string' && state.url) {
    pane.lastUrl = state.url;
    if (!pane.els.url.dataset.flash) {
      pane.els.url.textContent = state.url;
      pane.els.url.title = state.url;
    }
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

/** The pane whose tile is being handed to a different site, if any. */
let reopenSiteId = '';

function hideReopenForm() {
  reopenSiteId = '';
  reopenForm.hidden = true;
  reopenStatus.textContent = '';
}

function showReopenForm(site) {
  reopenSiteId = site.id;
  reopenForm.hidden = false;
  reopenTitle.textContent = `「${site.name}」の枠を使う`;
  reopenName.value = site.name;
  reopenUrl.value = '';
  reopenWipe.checked = true;
  reopenStatus.textContent = '';
  reopenUrl.focus();
}

const REOPEN_PROBLEMS = {
  'bad-url': '住所が正しくありません（https:// から入力してください）',
  'unknown-site': 'このパネルは見つかりません',
};

reopenForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!reopenSiteId) return;

  reopenStatus.textContent = '開いています…';
  const result = await window.sixview.paneReopenAs(reopenSiteId, {
    url: reopenUrl.value,
    name: reopenName.value,
    // Unticking it keeps the password and the DM settings, for when the same
    // site simply moved to a different address.
    keep: !reopenWipe.checked,
  });

  if (result && result.ok) {
    hideReopenForm();
    return;
  }
  reopenStatus.textContent =
    (result && REOPEN_PROBLEMS[result.reason]) || '開けませんでした';
});

document.getElementById('reopen-cancel').addEventListener('click', hideReopenForm);
reopenForm.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideReopenForm();
});

/**
 * One chip per closed pane. The name puts the pane back as it was; the button
 * beside it hands the same tile to a different site.
 */
function renderClosedBar(closed) {
  closedList.textContent = '';
  closedBar.hidden = closed.length === 0;

  for (const site of closed) {
    const group = document.createElement('span');
    group.className = 'closed-chip-group';

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'closed-chip';
    chip.textContent = site.name;
    chip.title = `${site.name} をもう一度開く`;
    chip.addEventListener('click', () => {
      void window.sixview.paneUpdate(site.id, { enabled: true });
    });

    const other = document.createElement('button');
    other.type = 'button';
    other.className = 'closed-chip closed-chip-other';
    other.textContent = '別のサイト';
    other.title = `この枠を別のサイト用にして開く`;
    other.addEventListener('click', () => showReopenForm(site));

    group.append(chip, other);
    closedList.appendChild(group);
  }

  // The pane being re-pointed may have been reopened or removed elsewhere.
  if (reopenSiteId && !closed.some((site) => site.id === reopenSiteId)) hideReopenForm();
}

/**
 * The tabs that point every pane at one page.
 *
 * Only one tab is ever "on"; clicking another is the whole interaction, and
 * the panes reload from the config change that comes back.
 */
function renderPageSets(config) {
  const sets = Array.isArray(config.pageSets) ? config.pageSets : [];
  pageSetBar.textContent = '';
  // A single tab is just the panes as they are, so there is nothing to switch.
  pageSetBar.hidden = sets.length < 2;

  for (const set of sets) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'page-set';
    tab.textContent = set.name;
    tab.title = set.url
      ? `すべてのパネルを ${set.url} にします`
      : 'それぞれのパネルの最初のページに戻します';
    if (set.id === config.activePageSet) {
      tab.classList.add('is-active');
      tab.setAttribute('aria-current', 'page');
    }
    tab.addEventListener('click', () => {
      if (set.id === config.activePageSet) return;
      void window.sixview.switchPageSet(set.id);
    });
    pageSetBar.appendChild(tab);
  }
}

function render(bootstrap) {
  const { config, partitions } = bootstrap;

  grid.style.setProperty('--columns', String(bootstrap.columns || 3));
  document.querySelector('.brand-mark').textContent = String(
    config.sites.filter((site) => site.enabled !== false).length
  );
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

  renderPageSets(config);
  const sets = Array.isArray(config.pageSets) ? config.pageSets : [];
  const homeTab = sets.find((set) => !set.url) || sets[0] || { id: '', name: 'ホーム' };
  const onHomeTab = !config.activePageSet || config.activePageSet === homeTab.id;
  const homeTabName = homeTab.name;

  const visible = config.sites.filter((site) => site.enabled !== false);
  const closed = config.sites.filter((site) => site.enabled === false);

  visible.forEach((site, index) => {
    const partition = partitions[site.id];
    const url = (bootstrap.paneUrls && bootstrap.paneUrls[site.id]) || '';
    let pane = panes.get(site.id);
    if (!pane) {
      pane = buildPane(site, index, partition, url);
      // Put a new pane in its own place rather than at the end, so a pane that
      // was closed and reopened comes back where it was. Panes already on
      // screen are never moved: detaching a webview reloads the page inside it.
      const at = grid.children[index];
      if (at && at !== pane.root) grid.insertBefore(pane.root, at);
    }
    pane.els.index.textContent = String(index + 1);
    updatePaneShell(pane, site, partition, url);
    syncPaneContent(pane, site, partition, url);

    // "Make this the pane's first page" would otherwise record the tab's page
    // as the pane's own, and there would be no way back to the real one.
    const setHome = pane.root.querySelector('[data-action="set-home"]');
    setHome.disabled = !onHomeTab;
    setHome.title = onHomeTab
      ? '今開いているページを、このパネルの最初のページにする'
      : `「${homeTabName}」に戻してから使ってください`;
  });

  // Drop panes that were closed, or whose site id disappeared. Removing the
  // element takes its webview with it, so a closed pane costs no memory.
  const liveIds = new Set(visible.map((site) => site.id));
  for (const [id, pane] of panes) {
    if (liveIds.has(id)) continue;
    pane.root.remove();
    panes.delete(id);
    if (focusedSiteId === id) focusedSiteId = null;
    if (maximizedSiteId === id) maximizedSiteId = null;
  }

  renderClosedBar(closed);

  if (!focusedSiteId && visible.length > 0) setFocused(visible[0].id);
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
