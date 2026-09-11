'use strict';

/**
 * Reads/writes sixview config.json. Takes the directory as an argument so it
 * can be tested without Electron (main.js passes app.getPath('userData')).
 */

const fs = require('fs');
const path = require('path');

const { createDefaultConfig, normalizeConfig } = require('./config-schema');

const CONFIG_FILENAME = 'config.json';

function configPath(baseDir) {
  return path.join(baseDir, CONFIG_FILENAME);
}

/**
 * Load and normalize the config. A missing or corrupt file falls back to
 * defaults instead of crashing the app.
 */
function loadConfig(baseDir) {
  const file = configPath(baseDir);
  if (!fs.existsSync(file)) {
    return { config: normalizeConfig(createDefaultConfig()), created: true, error: null };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { config: normalizeConfig(raw), created: false, error: null };
  } catch (err) {
    return {
      config: normalizeConfig(createDefaultConfig()),
      created: false,
      error: `設定ファイルを読み込めませんでした (${err.message})`,
    };
  }
}

/** Write the config atomically (tmp file + rename) so a crash cannot truncate it. */
function saveConfig(baseDir, rawConfig) {
  const config = normalizeConfig(rawConfig);
  fs.mkdirSync(baseDir, { recursive: true });
  const file = configPath(baseDir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return config;
}

module.exports = { CONFIG_FILENAME, configPath, loadConfig, saveConfig };
