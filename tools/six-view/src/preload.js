'use strict';

/**
 * The only bridge between renderer and main. The renderer can ask for the
 * config and drive panes, but it can never read a stored password.
 */

const { contextBridge, ipcRenderer } = require('electron');

const PANE_EVENTS = [
  'pane:state',
  'pane:focus',
  'pane:toggle-maximize',
  'app:config-changed',
  'dm:status',
];

contextBridge.exposeInMainWorld('sixview', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  setCredentials: (siteId, username, password) =>
    ipcRenderer.invoke('creds:set', { siteId, username, password }),
  clearCredentials: (siteId) => ipcRenderer.invoke('creds:clear', { siteId }),
  paneCommand: (siteId, command) => ipcRenderer.invoke('pane:command', { siteId, command }),
  paneNavigate: (siteId, url) => ipcRenderer.invoke('pane:navigate', { siteId, url }),
  paneUpdate: (siteId, patch) => ipcRenderer.invoke('pane:update', { siteId, patch }),
  paneReopenAs: (siteId, options) => ipcRenderer.invoke('pane:reopen-as', { siteId, ...options }),
  detectLogin: (siteId) => ipcRenderer.invoke('pane:detect-login', { siteId }),
  clearSession: (siteId) => ipcRenderer.invoke('session:clear', { siteId }),

  // DM bridge. The bot token goes straight to the main process and is never
  // read back out - the renderer only ever learns whether one is stored.
  dmPick: (siteId, label, relativeTo) =>
    ipcRenderer.invoke('dm:pick', { siteId, label, relativeTo }),
  dmScan: (siteId) => ipcRenderer.invoke('dm:scan', { siteId }),
  dmDetect: (siteId) => ipcRenderer.invoke('dm:detect', { siteId }),
  dmStatus: () => ipcRenderer.invoke('dm:status'),
  boostPress: (siteId) => ipcRenderer.invoke('boost:press', { siteId }),
  boostDetect: (siteId) => ipcRenderer.invoke('boost:detect', { siteId }),
  boostStatus: () => ipcRenderer.invoke('boost:status'),
  setTelegramToken: (token) => ipcRenderer.invoke('telegram:set-token', { token }),
  testTelegram: (token, chatId) => ipcRenderer.invoke('telegram:test', { token, chatId }),
  discoverChatId: (token) => ipcRenderer.invoke('telegram:discover-chat', { token }),
  openSettings: () => ipcRenderer.send('settings:open'),
  closeSettings: () => ipcRenderer.send('settings:close'),
  reloadAll: () => ipcRenderer.send('panes:reload-all'),
  loginAll: () => ipcRenderer.send('panes:login-all'),

  on: (channel, listener) => {
    if (!PANE_EVENTS.includes(channel)) return () => {};
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
