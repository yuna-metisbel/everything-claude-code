'use strict';

/**
 * Credential vault.
 *
 * Passwords are encrypted with Electron's safeStorage, which is backed by the
 * OS keychain (macOS Keychain / Windows DPAPI). The ciphertext lives in
 * credentials.json next to the config; the key never leaves the OS.
 *
 * `safeStorage` is injected so the module can be unit tested without Electron.
 */

const fs = require('fs');
const path = require('path');

const CREDENTIALS_FILENAME = 'credentials.json';
const FILE_VERSION = 1;

class SecretStore {
  /**
   * @param {string} baseDir  directory to store credentials.json in
   * @param {{isEncryptionAvailable:Function, encryptString:Function, decryptString:Function}} safeStorage
   */
  constructor(baseDir, safeStorage) {
    this.baseDir = baseDir;
    this.safeStorage = safeStorage;
    this.file = path.join(baseDir, CREDENTIALS_FILENAME);
  }

  isAvailable() {
    try {
      return Boolean(this.safeStorage && this.safeStorage.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  _readFile() {
    if (!fs.existsSync(this.file)) return { version: FILE_VERSION, entries: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const entries = parsed && typeof parsed.entries === 'object' && parsed.entries ? parsed.entries : {};
      return { version: FILE_VERSION, entries };
    } catch {
      return { version: FILE_VERSION, entries: {} };
    }
  }

  _writeFile(data) {
    fs.mkdirSync(this.baseDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      /* best effort - Windows ignores POSIX modes */
    }
  }

  /** Store a username/password pair for a site. Returns true on success. */
  set(siteId, username, password) {
    if (!siteId) return false;
    if (!this.isAvailable()) return false;

    const payload = JSON.stringify({
      username: typeof username === 'string' ? username : '',
      password: typeof password === 'string' ? password : '',
    });

    const data = this._readFile();
    data.entries[siteId] = this.safeStorage.encryptString(payload).toString('base64');
    this._writeFile(data);
    return true;
  }

  /** Retrieve `{ username, password }` for a site, or null when absent/undecryptable. */
  get(siteId) {
    if (!siteId || !this.isAvailable()) return null;
    const data = this._readFile();
    const encoded = data.entries[siteId];
    if (typeof encoded !== 'string' || !encoded) return null;

    try {
      const plain = this.safeStorage.decryptString(Buffer.from(encoded, 'base64'));
      const parsed = JSON.parse(plain);
      return {
        username: typeof parsed.username === 'string' ? parsed.username : '',
        password: typeof parsed.password === 'string' ? parsed.password : '',
      };
    } catch {
      return null;
    }
  }

  /** True when a credential is stored for the site (no decryption attempted). */
  has(siteId) {
    const data = this._readFile();
    return typeof data.entries[siteId] === 'string' && data.entries[siteId].length > 0;
  }

  /** Which sites currently have a stored credential: `{ [siteId]: boolean }`. */
  status(siteIds) {
    const data = this._readFile();
    const result = {};
    for (const id of siteIds) {
      result[id] = typeof data.entries[id] === 'string' && data.entries[id].length > 0;
    }
    return result;
  }

  clear(siteId) {
    const data = this._readFile();
    if (!(siteId in data.entries)) return false;
    delete data.entries[siteId];
    this._writeFile(data);
    return true;
  }

  clearAll() {
    this._writeFile({ version: FILE_VERSION, entries: {} });
  }
}

module.exports = { SecretStore, CREDENTIALS_FILENAME };
