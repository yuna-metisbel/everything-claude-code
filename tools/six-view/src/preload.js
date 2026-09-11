'use strict';

/**
 * The only bridge between renderer and main. The renderer can ask for the
 * config and drive panes, but it can never read a stored password.
 */

const { contextBridge, ipcRenderer } = require('electron');

const PANE_EVENTS = ['pane:state', 'pane:focus', 'pane:toggle-maximize', 'app:config-changed'];

contextBridge.exposeInMainWorld('sixview', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  setCredentials: (siteId, username, password) =>
    ipcRenderer.invoke('creds:set', { siteId, username, password }),
  clearCredentials: (siteId) => ipcRenderer.invoke('creds:clear', { siteId }),
  paneCommand: (siteId, command) => ipcRenderer.invoke('pane:command', { siteId, command }),
  clearSession: (siteId) => ipcRenderer.invoke('session:clear', { siteId }),
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
