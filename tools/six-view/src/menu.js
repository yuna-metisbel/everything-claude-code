'use strict';

/**
 * Application menu. On macOS the standard Edit menu is what makes
 * copy/paste/undo work inside the panes, so it must stay.
 */

const { Menu, app, shell } = require('electron');

const isMac = process.platform === 'darwin';

function buildMenu(handlers) {
  const paneItems = handlers.getSites().map((site, index) => ({
    label: `${index + 1}. ${site.name}`,
    // Only 1-9 can be typed as an accelerator; later panes are clicked instead.
    ...(index < 9 ? { accelerator: `CommandOrControl+${index + 1}` } : {}),
    click: () => handlers.onFocusPane(index),
  }));

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: 'SixView について' },
              { type: 'separator' },
              { label: '設定…', accelerator: 'Command+,', click: handlers.onOpenSettings },
              { type: 'separator' },
              { role: 'hide', label: 'SixView を隠す' },
              { role: 'hideOthers', label: 'ほかを隠す' },
              { role: 'unhide', label: 'すべて表示' },
              { type: 'separator' },
              { role: 'quit', label: 'SixView を終了' },
            ],
          },
        ]
      : []),
    {
      label: 'ファイル',
      submenu: [
        ...(isMac
          ? []
          : [{ label: '設定…', accelerator: 'Control+,', click: handlers.onOpenSettings }, { type: 'separator' }]),
        { label: 'すべて再読み込み', accelerator: 'CommandOrControl+Shift+R', click: handlers.onReloadAll },
        { label: 'すべて自動ログイン', accelerator: 'CommandOrControl+Shift+L', click: handlers.onLoginAll },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'ウインドウを閉じる' } : { role: 'quit', label: '終了' },
      ],
    },
    {
      label: '編集',
      submenu: [
        { role: 'undo', label: '取り消す' },
        { role: 'redo', label: 'やり直す' },
        { type: 'separator' },
        { role: 'cut', label: 'カット' },
        { role: 'copy', label: 'コピー' },
        { role: 'paste', label: 'ペースト' },
        { role: 'selectAll', label: 'すべてを選択' },
      ],
    },
    {
      label: 'パネル',
      submenu: [
        ...paneItems,
        { type: 'separator' },
        {
          label: '選択中のパネルを拡大 / 元に戻す',
          accelerator: 'CommandOrControl+Shift+M',
          click: handlers.onToggleMaximizePane,
        },
      ],
    },
    {
      label: '表示',
      submenu: [
        { role: 'togglefullscreen', label: 'フルスクリーン' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '開発者ツール' },
      ],
    },
    {
      label: 'ヘルプ',
      submenu: [
        {
          label: '使い方 (README)',
          click: () => shell.openExternal('https://github.com/affaan-m/everything-claude-code/tree/main/tools/six-view'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
