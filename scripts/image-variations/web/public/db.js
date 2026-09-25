/**
 * Small IndexedDB wrapper so the reference images, the settings and the last
 * run survive a reload - the difference between a page and an app.
 *
 * Every call degrades to a no-op when storage is unavailable (private mode,
 * blocked site data), because none of this is load-bearing.
 */

const DB_NAME = 'image-variations';
const DB_VERSION = 1;
const STORE = 'state';

let dbPromise = null;

function open() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('could not open IndexedDB'));
  }).catch(error => {
    dbPromise = null;
    throw error;
  });

  return dbPromise;
}

function transact(mode, run) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

export async function get(key, fallback = null) {
  try {
    const value = await transact('readonly', store => store.get(key));
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

export async function set(key, value) {
  try {
    await transact('readwrite', store => store.put(value, key));
    return true;
  } catch {
    return false;
  }
}

export async function remove(key) {
  try {
    await transact('readwrite', store => store.delete(key));
    return true;
  } catch {
    return false;
  }
}
