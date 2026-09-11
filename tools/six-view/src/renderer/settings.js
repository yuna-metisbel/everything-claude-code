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

let currentConfig = null;
let encryptionAvailable = false;

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

function buildSiteCard(site, index, hasCredential) {
  const fragment = siteTemplate.content.cloneNode(true);
  const card = fragment.querySelector('.site');

  card.querySelector('.site-index').textContent = String(index + 1);
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

function render(bootstrap) {
  currentConfig = bootstrap.config;
  encryptionAvailable = bootstrap.encryptionAvailable;

  document.getElementById('encryption-warning').hidden = encryptionAvailable;
  document.getElementById('config-path').textContent = bootstrap.configPath;
  document.getElementById('config-path').title = bootstrap.configPath;

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

  sitesRoot.textContent = '';
  currentConfig.sites.forEach((site, index) => {
    buildSiteCard(site, index, Boolean(bootstrap.credentialStatus[site.id]));
  });
}

document.getElementById('save').addEventListener('click', async () => {
  try {
    await window.sixview.saveConfig(currentConfig);
    flash('保存しました。パネルに反映されます。');
  } catch (err) {
    flash(`保存できませんでした: ${err.message}`, true);
  }
});

document.getElementById('close').addEventListener('click', () => window.sixview.closeSettings());

window.sixview.bootstrap().then(render);
