'use strict';

/**
 * SixView - main process.
 *
 * Opens one window containing a 3 x 2 grid of independent browser panes.
 * Each pane has its own session partition, so six different accounts can be
 * logged in at once without fighting over cookies.
 *
 * Credentials are read here (never in the renderer) and injected straight
 * into the guest page.
 */

const path = require('path');

const { app, BrowserWindow, ipcMain, session, shell, dialog, safeStorage } = require('electron');

const { loadConfig, saveConfig, configPath } = require('./lib/config-store');
const { SecretStore } = require('./lib/secret-store');
const {
  partitionForSite,
  resolveColumns,
  resolveUserAgent,
  resolveZoomFactor,
} = require('./lib/config-schema');
const { buildAutofillScript, buildDetectScript, shouldAutofill } = require('./lib/autofill');
const { buildMenu } = require('./menu');

const RUN_ID = Date.now().toString(36);
/** Ignore a second auto-login for the same URL within this window. */
const AUTOFILL_DEBOUNCE_MS = 1500;
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'mediaKeySystem',
  'notifications',
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock',
]);

/** @type {BrowserWindow|null} */
let mainWindow = null;
/** @type {BrowserWindow|null} */
let settingsWindow = null;

let userDataDir = '';
let config = null;
let configError = null;
/** @type {SecretStore|null} */
let secrets = null;

/** siteId -> pane runtime */
const panes = new Map();
/** Electron Session -> siteId (used to identify guest webContents) */
const sessionToSiteId = new Map();

function log(...args) {
  console.log('[SixView]', ...args);
}

function sendToMain(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/** Mirror the "open at login" preference into the OS (macOS / Windows). */
function applyLoginItemSetting() {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(config.startup.openAtLogin) });
  } catch (err) {
    log(`could not update the login item: ${err.message}`);
  }
}

function getSite(siteId) {
  return config.sites.find((site) => site.id === siteId) || null;
}

// ---------------------------------------------------------------------------
// Pane sessions
// ---------------------------------------------------------------------------

/**
 * Create (or reuse) the Electron session for each pane and remember the
 * mapping so guest webContents can be traced back to their site.
 */
function setupPaneSessions() {
  sessionToSiteId.clear();

  for (const site of config.sites) {
    const partition = partitionForSite(site, RUN_ID);
    const paneSession = session.fromPartition(partition);

    paneSession.setUserAgent(resolveUserAgent(config, site) || app.userAgentFallback);

    paneSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    });

    sessionToSiteId.set(paneSession, site.id);

    const existing = panes.get(site.id) || {};
    panes.set(site.id, {
      ...existing,
      siteId: site.id,
      partition,
      session: paneSession,
      contents: existing.contents && !existing.contents.isDestroyed() ? existing.contents : null,
      lastAutofillUrl: '',
      lastAutofillAt: 0,
    });
  }
}

/** Attach listeners to a guest webContents once it shows up. */
function registerGuest(contents) {
  const siteId = sessionToSiteId.get(contents.session);
  if (!siteId) return;

  const pane = panes.get(siteId);
  if (!pane) return;
  pane.contents = contents;

  const pushState = (patch) => {
    sendToMain('pane:state', {
      siteId,
      url: contents.isDestroyed() ? '' : contents.getURL(),
      title: contents.isDestroyed() ? '' : contents.getTitle(),
      canGoBack: !contents.isDestroyed() && contents.navigationHistory.canGoBack(),
      canGoForward: !contents.isDestroyed() && contents.navigationHistory.canGoForward(),
      ...patch,
    });
  };

  contents.on('did-start-loading', () => pushState({ loading: true }));
  contents.on('did-stop-loading', () => pushState({ loading: false }));
  contents.on('page-title-updated', () => pushState({}));
  contents.on('did-navigate', () => pushState({}));
  contents.on('did-navigate-in-page', () => pushState({}));

  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 /* ERR_ABORTED */) return;
    pushState({ loading: false, error: `${errorDescription} (${validatedURL})` });
  });

  contents.on('did-finish-load', () => {
    contents.setZoomFactor(resolveZoomFactor(config, getSite(siteId)));
    pushState({ loading: false, error: '' });
    void runAutofill(siteId, { auto: true });
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (!/^https?:\/\//i.test(url)) {
      if (/^(mailto|tel|callto|sip|skype):/i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    }
    // Popups (SSO, print previews, CTI dialers) keep the pane's session.
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1100,
        height: 840,
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      },
    };
  });

  contents.on('destroyed', () => {
    if (pane.contents === contents) pane.contents = null;
  });
}

// ---------------------------------------------------------------------------
// Auto login
// ---------------------------------------------------------------------------

/**
 * Fill the login form of a pane.
 * @param {string} siteId
 * @param {{auto?: boolean}} options  auto = triggered by navigation (deduped)
 */
async function runAutofill(siteId, options = {}) {
  const pane = panes.get(siteId);
  const site = getSite(siteId);
  if (!pane || !pane.contents || pane.contents.isDestroyed() || !site) return;

  const url = pane.contents.getURL();
  const credentials = secrets ? secrets.get(siteId) : null;

  if (options.auto) {
    if (!shouldAutofill(site, url, credentials)) return;
    // Debounce repeat loads of the same URL so a single page cannot be typed
    // into twice, while a real reload still re-fills the form.
    const sameUrlJustNow =
      pane.lastAutofillUrl === url && Date.now() - pane.lastAutofillAt < AUTOFILL_DEBOUNCE_MS;
    if (sameUrlJustNow) return;
    pane.lastAutofillUrl = url;
    pane.lastAutofillAt = Date.now();
  } else if (!credentials || !credentials.username) {
    sendToMain('pane:state', { siteId, autofill: 'no-credentials' });
    return;
  }

  try {
    const result = await pane.contents.executeJavaScript(
      buildAutofillScript(site.autofill, credentials),
      true
    );
    sendToMain('pane:state', {
      siteId,
      autofill: result && result.status ? result.status : 'unknown',
      autofillSubmitted: Boolean(result && result.submitted),
    });
  } catch (err) {
    log(`autofill failed for ${siteId}: ${err.message}`);
    sendToMain('pane:state', { siteId, autofill: 'error' });
  }
}

/**
 * Inspect what a pane currently shows and report selectors for its login form,
 * so the settings window can fill them in without the user reading any HTML.
 */
async function detectLoginFields(siteId) {
  const pane = panes.get(siteId);
  if (!pane || !pane.contents || pane.contents.isDestroyed()) {
    return { ok: false, reason: 'pane-not-loaded' };
  }

  try {
    const result = await pane.contents.executeJavaScript(buildDetectScript(), true);
    return result && typeof result === 'object' ? result : { ok: false, reason: 'no-result' };
  } catch (err) {
    log(`login detection failed for ${siteId}: ${err.message}`);
    return { ok: false, reason: 'script-error' };
  }
}

// ---------------------------------------------------------------------------
// Pane commands
// ---------------------------------------------------------------------------

const ZOOM_STEPS = [0.3, 0.4, 0.5, 0.6, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

function stepZoom(current, direction) {
  const index = ZOOM_STEPS.findIndex((value) => Math.abs(value - current) < 0.02);
  const base = index === -1 ? ZOOM_STEPS.findIndex((value) => value >= current) : index;
  const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, (base === -1 ? 8 : base) + direction));
  return ZOOM_STEPS[next];
}

async function runPaneCommand(siteId, command) {
  const pane = panes.get(siteId);
  const site = getSite(siteId);
  if (!pane || !site) return { ok: false, reason: 'unknown-site' };

  const contents = pane.contents && !pane.contents.isDestroyed() ? pane.contents : null;

  switch (command) {
    case 'reload':
      if (contents) {
        pane.lastAutofillUrl = '';
        pane.lastAutofillAt = 0;
        contents.reload();
      }
      return { ok: Boolean(contents) };

    case 'back':
      if (contents && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
      return { ok: true };

    case 'forward':
      if (contents && contents.navigationHistory.canGoForward()) {
        contents.navigationHistory.goForward();
      }
      return { ok: true };

    case 'home':
      if (contents && site.url) {
        pane.lastAutofillUrl = '';
        pane.lastAutofillAt = 0;
        await contents.loadURL(site.url);
      }
      return { ok: true };

    case 'login':
      await runAutofill(siteId, { auto: false });
      return { ok: true };

    case 'external':
      if (site.url || (contents && contents.getURL())) {
        await shell.openExternal((contents && contents.getURL()) || site.url);
      }
      return { ok: true };

    case 'devtools':
      if (contents) contents.openDevTools({ mode: 'detach' });
      return { ok: true };

    case 'zoom-in':
    case 'zoom-out':
      if (contents) {
        contents.setZoomFactor(stepZoom(contents.getZoomFactor(), command === 'zoom-in' ? 1 : -1));
      }
      return { ok: true };

    case 'zoom-reset':
      if (contents) contents.setZoomFactor(resolveZoomFactor(config, site));
      return { ok: true };

    case 'focus':
      if (contents) contents.focus();
      return { ok: true };

    default:
      return { ok: false, reason: 'unknown-command' };
  }
}

/** Wipe cookies + storage for a pane (= full logout). */
async function clearPaneSession(siteId) {
  const pane = panes.get(siteId);
  if (!pane) return { ok: false };
  await pane.session.clearStorageData();
  pane.lastAutofillUrl = '';
  pane.lastAutofillAt = 0;
  if (pane.contents && !pane.contents.isDestroyed()) pane.contents.reload();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function createMainWindow() {
  const bounds = config.window;

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x === null ? undefined : bounds.x,
    y: bounds.y === null ? undefined : bounds.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#12141a',
    title: 'SixView',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
    },
  });

  if (bounds.maximized) mainWindow.maximize();

  // Never let a <webview> be created with Node access.
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    params.nodeintegration = 'false';
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', persistWindowBounds);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  void mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function persistWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const normal = mainWindow.getNormalBounds();
    config.window = {
      width: normal.width,
      height: normal.height,
      x: normal.x,
      y: normal.y,
      maximized: mainWindow.isMaximized(),
    };
    config = saveConfig(userDataDir, config);
  } catch (err) {
    log(`could not save window bounds: ${err.message}`);
  }
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 980,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    parent: mainWindow || undefined,
    title: 'SixView 設定',
    backgroundColor: '#12141a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  void settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function bootstrapPayload() {
  return {
    config,
    partitions: Object.fromEntries(config.sites.map((site) => [site.id, partitionForSite(site, RUN_ID)])),
    zoomFactors: Object.fromEntries(config.sites.map((site) => [site.id, resolveZoomFactor(config, site)])),
    columns: resolveColumns(config),
    credentialStatus: secrets ? secrets.status(config.sites.map((site) => site.id)) : {},
    encryptionAvailable: Boolean(secrets && secrets.isAvailable()),
    loginItemSupported: process.platform === 'darwin' || process.platform === 'win32',
    configPath: configPath(userDataDir),
    configError,
  };
}

function registerIpc() {
  ipcMain.handle('app:bootstrap', () => bootstrapPayload());

  ipcMain.handle('config:save', (_event, incoming) => {
    const previousIds = config.sites.map((site) => site.id);
    config = saveConfig(userDataDir, { ...incoming, window: config.window });
    configError = null;

    // A removed pane should not leave its password behind in the vault.
    const liveIds = new Set(config.sites.map((site) => site.id));
    for (const id of previousIds) {
      if (!liveIds.has(id) && secrets) secrets.clear(id);
    }

    applyLoginItemSetting();
    setupPaneSessions();
    sendToMain('app:config-changed', bootstrapPayload());
    return bootstrapPayload();
  });

  ipcMain.handle('creds:set', (_event, payload) => {
    if (!secrets || !payload || !payload.siteId) return { ok: false, reason: 'bad-request' };
    if (!secrets.isAvailable()) return { ok: false, reason: 'no-encryption' };
    const ok = secrets.set(payload.siteId, payload.username, payload.password);
    sendToMain('app:config-changed', bootstrapPayload());
    return { ok };
  });

  ipcMain.handle('creds:clear', (_event, payload) => {
    if (!secrets || !payload || !payload.siteId) return { ok: false };
    const ok = secrets.clear(payload.siteId);
    sendToMain('app:config-changed', bootstrapPayload());
    return { ok };
  });

  ipcMain.handle('pane:detect-login', (_event, payload) => {
    if (!payload || !payload.siteId) return { ok: false, reason: 'bad-request' };
    return detectLoginFields(payload.siteId);
  });

  ipcMain.handle('pane:command', (_event, payload) => {
    if (!payload || !payload.siteId) return { ok: false };
    return runPaneCommand(payload.siteId, payload.command);
  });

  ipcMain.handle('session:clear', async (_event, payload) => {
    if (!payload || !payload.siteId) return { ok: false };
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const options = {
      type: 'warning',
      buttons: ['キャンセル', 'ログアウトする'],
      defaultId: 0,
      cancelId: 0,
      message: 'このパネルのログイン状態を消去しますか？',
      detail: 'Cookie とサイトデータを削除して再読み込みします。保存済みのID/パスワードは消えません。',
    };
    const choice = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (choice.response !== 1) return { ok: false, cancelled: true };
    return clearPaneSession(payload.siteId);
  });

  ipcMain.on('settings:open', () => openSettingsWindow());
  ipcMain.on('settings:close', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
  });
  ipcMain.on('panes:reload-all', () => {
    for (const site of config.sites) void runPaneCommand(site.id, 'reload');
  });
  ipcMain.on('panes:login-all', () => {
    for (const site of config.sites) void runPaneCommand(site.id, 'login');
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview') registerGuest(contents);
  });

  app.whenReady().then(() => {
    userDataDir = app.getPath('userData');

    const loaded = loadConfig(userDataDir);
    config = loaded.config;
    configError = loaded.error;
    if (loaded.created) config = saveConfig(userDataDir, config);

    secrets = new SecretStore(userDataDir, safeStorage);

    applyLoginItemSetting();
    setupPaneSessions();
    registerIpc();
    buildMenu({
      onOpenSettings: openSettingsWindow,
      onReloadAll: () => {
        for (const site of config.sites) void runPaneCommand(site.id, 'reload');
      },
      onLoginAll: () => {
        for (const site of config.sites) void runPaneCommand(site.id, 'login');
      },
      onFocusPane: (index) => {
        const site = config.sites[index];
        if (!site) return;
        void runPaneCommand(site.id, 'focus');
        sendToMain('pane:focus', { siteId: site.id });
      },
      onToggleMaximizePane: () => sendToMain('pane:toggle-maximize', {}),
      getSites: () => config.sites,
    });
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
