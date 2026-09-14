'use strict';

/**
 * Settings window.
 *
 * Site settings are edited as one config object and saved together.
 * Credentials are written one site at a time through the credential vault and
 * are never read back into this window.
 */

const sitesRoot = document.getElementById('sites');
const siteTemplate = document.getElementById('site-template');
const saveStatus = document.getElementById('save-status');

const MAX_PANES = 12;

let currentConfig = null;
let encryptionAvailable = false;
let credentialStatus = {};
let presets = [];

/** Copy a pane so a second account on the same site gets its own session. */
function duplicateSite(site, takenIds) {
  const copy = JSON.parse(JSON.stringify(site));
  const used = new Set(takenIds);
  let suffix = 2;
  while (used.has(`${site.id}-${suffix}`)) suffix += 1;
  copy.id = `${site.id}-${suffix}`;
  copy.name = `${site.name} (${suffix})`;
  return copy;
}

/** A new pane, optionally seeded from one of the shipped presets. */
function blankSite(takenIds, preset = {}) {
  const used = new Set(takenIds);
  let index = used.size + 1;
  while (used.has(`site-${index}`)) index += 1;
  return {
    id: preset.key && preset.key !== 'blank' ? `${preset.key}-${index}` : `site-${index}`,
    name: preset.name || `サイト ${index}`,
    url: preset.url || '',
    enabled: true,
    incognito: false,
    zoomFactor: 0,
    userAgent: '',
    autofill: {
      enabled: true,
      urlPattern: '',
      usernameSelector: '',
      passwordSelector: '',
      submitSelector: '',
      autoSubmit: false,
      delayMs: 600,
    },
    dm: {
      enabled: false,
      openSelector: '',
      rowSelector: '',
      nameSelector: '',
      previewSelector: '',
      unreadSelector: '',
      inputSelector: '',
      sendSelector: '',
      backSelector: '',
      intervalSeconds: 90,
    },
  };
}

/** Read `a.b.c` out of an object. */
function getPath(object, path) {
  return path.split('.').reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), object);
}

/** Write `a.b.c` into an object, creating intermediate objects. */
function setPath(object, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let target = object;
  for (const key of keys) {
    if (typeof target[key] !== 'object' || target[key] === null) target[key] = {};
    target = target[key];
  }
  target[last] = value;
}

function flash(message, isError = false) {
  saveStatus.textContent = message;
  saveStatus.style.color = isError ? '#ff6b6b' : '#8b93a7';
  if (!message) return;
  setTimeout(() => {
    if (saveStatus.textContent === message) saveStatus.textContent = '';
  }, 4000);
}

function readInput(input) {
  if (input.type === 'checkbox') return input.checked;
  if (input.type === 'number') return input.value === '' ? 0 : Number(input.value);
  return input.value;
}

function writeInput(input, value) {
  if (input.type === 'checkbox') {
    input.checked = Boolean(value);
    return;
  }
  input.value = value === null || value === undefined ? '' : String(value);
}

function renderCredStatus(card, hasCredential) {
  const status = card.querySelector('.cred-status');
  if (!encryptionAvailable) {
    status.textContent = 'この環境では保存できません（Cookie によるログイン保持のみ利用できます）。';
    return;
  }
  status.textContent = hasCredential
    ? '保存済み — 上書きするには入力して「認証情報を保存」を押してください。'
    : '未登録 — ID とパスワードを入力して「認証情報を保存」を押してください。';
}

const PICK_PROBLEMS = {
  'pane-not-loaded': 'パネルがまだ読み込まれていません。先にその画面を表示してください。',
  cancelled: '中止しました。',
  timeout: '時間切れです。もう一度「指定」を押してください。',
  'already-picking': 'ほかの指定が進行中です。パネルをクリックするか Esc で終わらせてください。',
  'script-error': 'ページを読み取れませんでした。',
  'no-result': 'ページを読み取れませんでした。',
  'bad-request': 'ページを読み取れませんでした。',
};

const SCAN_PROBLEMS = {
  'not-configured': '「1件の行」がまだ指定されていません。',
  'pane-not-loaded': 'パネルがまだ読み込まれていません。',
  'no-row-selector': '「1件の行」がまだ指定されていません。',
  'open-not-found': '「DM を開くボタン」が見つかりません。指定し直してください。',
  'no-rows': 'メッセージの行が見つかりません。DM 一覧を表示した状態で試してください。',
  busy: '読み取り中です。少し待ってから試してください。',
  'script-error': 'ページを読み取れませんでした。',
};

/**
 * Fill the DM selectors by clicking the real elements in the pane.
 *
 * Row-relative fields record their selector relative to the row, so the same
 * one selector works for every conversation in the list.
 */
function wireDmPickers(card, site) {
  const status = card.querySelector('.dm-status');

  card.querySelectorAll('.dm-pick').forEach((rowEl) => {
    const field = rowEl.dataset.pick;
    const input = rowEl.querySelector(`[data-field="${field}"]`);
    const relativeField = rowEl.dataset.relative;

    rowEl.querySelector('[data-action="pick"]').addEventListener('click', async () => {
      const relativeTo = relativeField ? getPath(site, relativeField) || '' : '';
      if (relativeField && !relativeTo) {
        status.textContent = '先に「1件の行」を指定してください。';
        return;
      }

      status.textContent = 'パネルの中の場所をクリックしてください（Esc で中止）。';
      const picked = await window.sixview.dmPick(site.id, rowEl.dataset.label || '', relativeTo);

      if (!picked || !picked.ok) {
        status.textContent = PICK_PROBLEMS[picked && picked.reason] || '指定できませんでした。';
        return;
      }

      // Prefer the row-relative form: an absolute path would only ever match
      // the one conversation that happened to be clicked.
      const selector = relativeField ? picked.relative || picked.selector : picked.selector;
      writeInput(input, selector);
      setPath(site, field, selector);
      status.textContent = picked.sample
        ? `指定しました（${picked.sample}）`
        : '指定しました。';
    });
  });

  card.querySelector('[data-action="dm-test"]').addEventListener('click', async () => {
    status.textContent = '読み取り中…';
    const result = await window.sixview.dmScan(site.id);
    if (!result || !result.ok) {
      status.textContent = SCAN_PROBLEMS[result && result.reason] || '読み取れませんでした。';
      return;
    }
    const rows = result.rows || [];
    const unread = rows.filter((row) => row.unread).length;
    const first = rows[0];
    status.textContent = first
      ? `${rows.length}件を読み取りました（未読 ${unread}件）。先頭: ${first.name || '名前なし'} / ${first.preview || '本文なし'}`
      : '行が見つかりませんでした。';
  });
}

function buildSiteCard(site, index, hasCredential) {
  const fragment = siteTemplate.content.cloneNode(true);
  const card = fragment.querySelector('.site');

  card.querySelector('.site-index').textContent = String(index + 1);

  card.querySelector('[data-action="duplicate"]').addEventListener('click', () => {
    if (currentConfig.sites.length >= MAX_PANES) {
      flash(`パネルは最大 ${MAX_PANES} 個までです。`, true);
      return;
    }
    currentConfig.sites.splice(index + 1, 0, duplicateSite(site, currentConfig.sites.map((s) => s.id)));
    renderSites();
    flash('複製しました。表示名を変えて、別アカウントの ID とパスワードを保存してください。');
  });

  card.querySelector('[data-action="remove"]').addEventListener('click', () => {
    if (currentConfig.sites.length <= 1) {
      flash('パネルは 1 つ以上必要です。', true);
      return;
    }
    currentConfig.sites.splice(index, 1);
    renderSites();
    flash(`${site.name} を削除しました。「保存して反映」で確定します（保存済みの認証情報も消えます）。`);
  });
  const title = card.querySelector('.site-title');
  title.textContent = site.name;

  card.querySelectorAll('[data-field]').forEach((input) => {
    writeInput(input, getPath(site, input.dataset.field));
    input.addEventListener('input', () => {
      setPath(site, input.dataset.field, readInput(input));
      if (input.dataset.field === 'name') title.textContent = site.name;
    });
  });

  const detectStatus = card.querySelector('.detect-status');
  card.querySelector('[data-action="detect"]').addEventListener('click', async () => {
    detectStatus.textContent = '検出中…';
    const found = await window.sixview.detectLogin(site.id);
    const problems = {
      'pane-not-loaded': 'パネルがまだ読み込まれていません。先にそのサイトを表示してください。',
      'no-password-field': 'パスワード欄が見つかりません。ログイン画面を表示してから試してください。',
      'script-error': 'ページを読み取れませんでした。',
      'no-result': 'ページを読み取れませんでした。',
      'bad-request': 'ページを読み取れませんでした。',
    };

    if (!found || !found.ok) {
      detectStatus.textContent = problems[found && found.reason] || '検出できませんでした。';
      return;
    }

    const fill = (field, value) => {
      if (!value) return false;
      const input = card.querySelector(`[data-field="${field}"]`);
      writeInput(input, value);
      setPath(site, field, value);
      return true;
    };

    fill('autofill.usernameSelector', found.usernameSelector);
    fill('autofill.passwordSelector', found.passwordSelector);
    fill('autofill.submitSelector', found.submitSelector);

    const patternInput = card.querySelector('[data-field="autofill.urlPattern"]');
    if (!patternInput.value && found.path && found.path !== '/') {
      writeInput(patternInput, found.path);
      setPath(site, 'autofill.urlPattern', found.path);
    }

    const enabled = card.querySelector('[data-field="autofill.enabled"]');
    enabled.checked = true;
    setPath(site, 'autofill.enabled', true);

    detectStatus.textContent = found.usernameSelector
      ? '検出しました。ID / パスワードを保存して「保存して反映」を押してください。'
      : 'パスワード欄だけ検出しました。ID 欄のセレクタは手入力してください。';
  });

  wireDmPickers(card, site);

  const usernameInput = card.querySelector('[data-cred="username"]');
  const passwordInput = card.querySelector('[data-cred="password"]');

  if (!encryptionAvailable) {
    usernameInput.disabled = true;
    passwordInput.disabled = true;
  }

  card.querySelector('[data-cred-action="save"]').addEventListener('click', async () => {
    const username = usernameInput.value;
    const password = passwordInput.value;
    if (!username && !password) {
      flash('ID とパスワードを入力してください。', true);
      return;
    }
    const result = await window.sixview.setCredentials(site.id, username, password);
    if (result && result.ok) {
      usernameInput.value = '';
      passwordInput.value = '';
      renderCredStatus(card, true);
      flash(`${site.name} の認証情報を保存しました。`);
    } else {
      flash('認証情報を保存できませんでした。', true);
    }
  });

  card.querySelector('[data-cred-action="clear"]').addEventListener('click', async () => {
    await window.sixview.clearCredentials(site.id);
    usernameInput.value = '';
    passwordInput.value = '';
    renderCredStatus(card, false);
    flash(`${site.name} の認証情報を削除しました。`);
  });

  renderCredStatus(card, hasCredential);
  sitesRoot.appendChild(fragment);
}

/** Redraw the list of pane cards from currentConfig. */
function renderSites() {
  sitesRoot.textContent = '';
  currentConfig.sites.forEach((site, index) => {
    buildSiteCard(site, index, Boolean(credentialStatus[site.id]));
  });
  document.getElementById('pane-count').textContent = `（${currentConfig.sites.length} 画面）`;
}

function render(bootstrap) {
  currentConfig = bootstrap.config;
  encryptionAvailable = bootstrap.encryptionAvailable;
  credentialStatus = bootstrap.credentialStatus || {};
  presets = bootstrap.presets || [];

  const presetSelect = document.getElementById('preset');
  presetSelect.textContent = '';
  for (const preset of presets) {
    const option = document.createElement('option');
    option.value = preset.key;
    option.textContent = preset.label;
    presetSelect.appendChild(option);
  }

  // 02View and SixView share this window, so the name has to follow the build.
  if (bootstrap.appName) {
    document.querySelectorAll('.brand-name').forEach((el) => {
      el.textContent = bootstrap.appName;
    });
    document.title = `${bootstrap.appName} 設定`;
  }

  document.getElementById('encryption-warning').hidden = encryptionAvailable;
  document.getElementById('config-path').textContent = bootstrap.configPath;
  document.getElementById('config-path').title = bootstrap.configPath;

  const columns = document.getElementById('columns');
  columns.value = String((currentConfig.layout && currentConfig.layout.columns) || 0);
  columns.addEventListener('change', () => {
    if (!currentConfig.layout) currentConfig.layout = {};
    currentConfig.layout.columns = Number(columns.value);
  });

  const openAtLogin = document.getElementById('open-at-login');
  openAtLogin.checked = Boolean(currentConfig.startup && currentConfig.startup.openAtLogin);
  openAtLogin.disabled = !bootstrap.loginItemSupported;
  document.getElementById('login-item-note').hidden = Boolean(bootstrap.loginItemSupported);
  openAtLogin.addEventListener('change', () => {
    if (!currentConfig.startup) currentConfig.startup = {};
    currentConfig.startup.openAtLogin = openAtLogin.checked;
  });

  const defaultZoom = document.getElementById('default-zoom');
  const defaultUa = document.getElementById('default-ua');
  writeInput(defaultZoom, currentConfig.defaults.zoomFactor);
  writeInput(defaultUa, currentConfig.defaults.userAgent);
  defaultZoom.addEventListener('input', () => {
    currentConfig.defaults.zoomFactor = readInput(defaultZoom);
  });
  defaultUa.addEventListener('input', () => {
    currentConfig.defaults.userAgent = readInput(defaultUa);
  });

  renderTelegram(bootstrap);
  renderSites();
}

/** The Telegram card: token in the vault, the rest in the config. */
function renderTelegram(bootstrap) {
  if (!currentConfig.telegram) currentConfig.telegram = { enabled: false, chatId: '', pollSeconds: 30, confirmBeforeSend: true };
  const telegram = currentConfig.telegram;

  const enabled = document.getElementById('tg-enabled');
  const confirm = document.getElementById('tg-confirm');
  const chat = document.getElementById('tg-chat');
  const token = document.getElementById('tg-token');
  const tokenStatus = document.getElementById('tg-token-status');
  const status = document.getElementById('tg-status');

  enabled.checked = Boolean(telegram.enabled);
  confirm.checked = telegram.confirmBeforeSend !== false;
  chat.value = telegram.chatId || '';
  tokenStatus.textContent = bootstrap.telegramTokenStored ? '保存済み' : '未登録';

  enabled.addEventListener('change', () => {
    telegram.enabled = enabled.checked;
  });
  confirm.addEventListener('change', () => {
    telegram.confirmBeforeSend = confirm.checked;
  });
  chat.addEventListener('input', () => {
    telegram.chatId = chat.value.trim();
  });

  if (!encryptionAvailable) token.disabled = true;

  document.getElementById('tg-save').addEventListener('click', async () => {
    const value = token.value.trim();
    const result = await window.sixview.setTelegramToken(value);
    if (result && result.ok) {
      token.value = '';
      tokenStatus.textContent = value ? '保存済み' : '未登録';
      status.textContent = value ? 'トークンを保存しました。' : 'トークンを削除しました。';
    } else {
      status.textContent = 'トークンを保存できませんでした。';
    }
  });

  document.getElementById('tg-test').addEventListener('click', async () => {
    status.textContent = '接続中…';
    const result = await window.sixview.testTelegram(token.value.trim(), chat.value.trim());
    if (!result || !result.ok) {
      status.textContent =
        result && result.reason === 'bad-token'
          ? 'トークンの形式が違います。@BotFather が出した文字列をそのまま貼ってください。'
          : `接続できませんでした（${(result && result.reason) || 'unknown'}）。`;
      return;
    }
    status.textContent = result.sent
      ? `つながりました（@${result.username}）。Telegram にテストメッセージを送りました。`
      : `トークンは有効です（@${result.username}）。チャット ID を入れてもう一度テストしてください。`;
  });
}

document.getElementById('add-pane').addEventListener('click', () => {
  if (currentConfig.sites.length >= MAX_PANES) {
    flash(`パネルは最大 ${MAX_PANES} 個までです。`, true);
    return;
  }
  const chosen = presets.find((preset) => preset.key === document.getElementById('preset').value) || {};
  currentConfig.sites.push(blankSite(currentConfig.sites.map((site) => site.id), chosen));
  renderSites();
  document.getElementById('sites').lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

document.getElementById('enable-all-autofill').addEventListener('click', () => {
  // For configs made before auto-login defaulted to on: flip every pane at once
  // rather than opening eight cards to tick the same box.
  for (const site of currentConfig.sites) {
    if (!site.autofill) site.autofill = {};
    site.autofill.enabled = true;
  }
  renderSites();
  flash('すべてのパネルで自動ログインをオンにしました。「保存して反映」を押してください。');
});

document.getElementById('save').addEventListener('click', async () => {
  try {
    const saved = await window.sixview.saveConfig(currentConfig);
    if (saved && saved.credentialStatus) credentialStatus = saved.credentialStatus;
    flash('保存しました。パネルに反映されます。');
  } catch (err) {
    flash(`保存できませんでした: ${err.message}`, true);
  }
});

document.getElementById('close').addEventListener('click', () => window.sixview.closeSettings());

window.sixview.bootstrap().then(render);
