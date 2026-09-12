'use strict';

/**
 * SixView config schema (pure module - no Electron imports).
 *
 * Kept free of Electron so it can be unit tested with plain Node.
 */

/** Panes the window ships with; the count is editable in settings. */
const DEFAULT_PANE_COUNT = 6;
const MIN_PANES = 1;
const MAX_PANES = 12;

/**
 * Columns to use when the layout is left on "auto", chosen so the grid stays
 * close to the window's own proportions (8 panes read best as 4 across, 2 down).
 */
const AUTO_COLUMNS = { 1: 1, 2: 2, 3: 3, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 3, 10: 5, 11: 4, 12: 4 };

const CONFIG_VERSION = 1;

/** Sites the tool ships with, in pane order (top row first). */
const DEFAULT_SITE_PRESETS = [
  { id: 'venry', name: 'Venry', url: 'https://mrvenrey.jp/' },
  { id: 'esutama', name: 'えすたま', url: 'https://estama.jp/admin/' },
  { id: 'ekichika', name: 'えきちか', url: 'https://ranking-deli.jp/admin/login' },
  { id: 'este-ranking', name: 'エステランキング', url: 'https://www.esthe-ranking.jp/login/' },
  { id: 'foope', name: 'ふーぺ', url: 'https://www.fuupe.jp/login' },
  { id: 'cti', name: 'CTI', url: 'https://prime-office-board.onrender.com/' },
];

const DEFAULT_AUTOFILL = {
  enabled: false,
  urlPattern: '',
  usernameSelector: '',
  passwordSelector: '',
  submitSelector: '',
  autoSubmit: false,
  delayMs: 600,
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function toBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

/** Zoom overrides: 0 (or anything unusable) means "use the global default". */
function clampZoomOverride(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(2, Math.max(0.25, num));
}

function toTrimmedString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.trim();
}

/**
 * Slugify an arbitrary label into a filesystem/partition safe id.
 */
function toSiteId(value, index) {
  const slug = toTrimmedString(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || `site-${index + 1}`;
}

/**
 * Only http(s) URLs are accepted. Everything else (javascript:, file:, ...)
 * is rejected so a bad config cannot escalate into local file access.
 */
function normalizeUrl(value) {
  const raw = toTrimmedString(value);
  if (!raw) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeAutofill(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return {
    enabled: toBoolean(source.enabled, DEFAULT_AUTOFILL.enabled),
    urlPattern: toTrimmedString(source.urlPattern, DEFAULT_AUTOFILL.urlPattern),
    usernameSelector: toTrimmedString(source.usernameSelector, DEFAULT_AUTOFILL.usernameSelector),
    passwordSelector: toTrimmedString(source.passwordSelector, DEFAULT_AUTOFILL.passwordSelector),
    submitSelector: toTrimmedString(source.submitSelector, DEFAULT_AUTOFILL.submitSelector),
    autoSubmit: toBoolean(source.autoSubmit, DEFAULT_AUTOFILL.autoSubmit),
    delayMs: clampNumber(source.delayMs, 0, 15000, DEFAULT_AUTOFILL.delayMs),
  };
}

function normalizeSite(raw, index, usedIds) {
  const source = isPlainObject(raw) ? raw : {};
  const preset = DEFAULT_SITE_PRESETS[index] || { id: `site-${index + 1}`, name: `サイト ${index + 1}` };

  const name = toTrimmedString(source.name, preset.name) || preset.name;
  let id = toSiteId(source.id || preset.id || name, index);
  while (usedIds.has(id)) {
    id = `${id}-${usedIds.size + 1}`;
  }
  usedIds.add(id);

  return {
    id,
    name,
    url: normalizeUrl(source.url),
    enabled: toBoolean(source.enabled, true),
    incognito: toBoolean(source.incognito, false),
    zoomFactor: clampZoomOverride(source.zoomFactor),
    userAgent: toTrimmedString(source.userAgent),
    autofill: normalizeAutofill(source.autofill),
  };
}

function createDefaultSites() {
  const usedIds = new Set();
  return DEFAULT_SITE_PRESETS.map((preset, index) => normalizeSite(preset, index, usedIds));
}

/**
 * A blank pane to append. `takenIds` keeps the new id distinct from the panes
 * already in the config, which is what keeps two accounts on the same site
 * from sharing a session.
 */
function createSite(takenIds = [], seed = {}) {
  const used = new Set(takenIds);
  let index = used.size;
  while (used.has(`site-${index + 1}`)) index += 1;
  return normalizeSite({ id: `site-${index + 1}`, name: `サイト ${index + 1}`, ...seed }, index, used);
}

/** Copy a pane for a second account: same site and selectors, its own session. */
function duplicateSite(site, takenIds = []) {
  const copy = JSON.parse(JSON.stringify(site));
  copy.name = `${site.name} (2)`;
  delete copy.id;
  const used = new Set(takenIds);
  let suffix = 2;
  while (used.has(`${site.id}-${suffix}`)) suffix += 1;
  copy.id = `${site.id}-${suffix}`;
  return normalizeSite(copy, takenIds.length, used);
}

/** Columns for a pane count, honouring an explicit override. */
function resolveColumns(config) {
  const explicit = config && config.layout ? Number(config.layout.columns) : 0;
  const count = config && Array.isArray(config.sites) ? config.sites.length : 0;
  if (Number.isFinite(explicit) && explicit >= 1 && explicit <= MAX_PANES) return Math.floor(explicit);
  return AUTO_COLUMNS[count] || Math.ceil(Math.sqrt(Math.max(1, count)));
}

function createDefaultConfig() {
  return {
    version: CONFIG_VERSION,
    window: { width: 1680, height: 1020, x: null, y: null, maximized: true },
    layout: { columns: 0 },
    startup: { openAtLogin: false },
    defaults: { zoomFactor: 0.67, userAgent: '' },
    sites: createDefaultSites(),
  };
}

function normalizeWindow(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const fallback = createDefaultConfig().window;
  const x = Number(source.x);
  const y = Number(source.y);
  return {
    width: Math.round(clampNumber(source.width, 800, 20000, fallback.width)),
    height: Math.round(clampNumber(source.height, 600, 20000, fallback.height)),
    x: Number.isFinite(x) ? Math.round(x) : null,
    y: Number.isFinite(y) ? Math.round(y) : null,
    maximized: toBoolean(source.maximized, fallback.maximized),
  };
}

/**
 * Turn anything loaded from disk into a complete, safe config object.
 * Keeps between MIN_PANES and MAX_PANES panes; a config with no sites at all
 * falls back to the shipped defaults rather than opening an empty window.
 */
function normalizeConfig(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const rawSites = Array.isArray(source.sites) && source.sites.length > 0 ? source.sites : DEFAULT_SITE_PRESETS;
  const count = Math.min(MAX_PANES, Math.max(MIN_PANES, rawSites.length));
  const usedIds = new Set();
  const sites = [];

  for (let index = 0; index < count; index += 1) {
    sites.push(normalizeSite(rawSites[index], index, usedIds));
  }

  const defaults = isPlainObject(source.defaults) ? source.defaults : {};
  const startup = isPlainObject(source.startup) ? source.startup : {};
  const layout = isPlainObject(source.layout) ? source.layout : {};

  return {
    version: CONFIG_VERSION,
    window: normalizeWindow(source.window),
    layout: { columns: clampNumber(Math.floor(Number(layout.columns) || 0), 0, MAX_PANES, 0) },
    startup: { openAtLogin: toBoolean(startup.openAtLogin, false) },
    defaults: {
      zoomFactor: clampNumber(defaults.zoomFactor, 0.25, 2, 0.67),
      userAgent: toTrimmedString(defaults.userAgent),
    },
    sites,
  };
}

/** Effective zoom for a pane: per-site override, else the global default. */
function resolveZoomFactor(config, site) {
  if (site && site.zoomFactor > 0) return site.zoomFactor;
  return config.defaults.zoomFactor;
}

/** Effective user agent for a pane, or '' to use Electron's default. */
function resolveUserAgent(config, site) {
  if (site && site.userAgent) return site.userAgent;
  return config.defaults.userAgent;
}

/**
 * Session partition for a pane. Persistent partitions keep cookies between
 * launches (stay logged in); incognito panes get a memory-only partition.
 */
function partitionForSite(site, runId = '') {
  if (site.incognito) {
    return `sixview-private-${site.id}${runId ? `-${runId}` : ''}`;
  }
  return `persist:sixview-${site.id}`;
}

/** Panes in display order, filling each row left to right. */
function paneSlots(config) {
  const columns = resolveColumns(config);
  return config.sites.map((site, index) => ({
    index,
    row: Math.floor(index / columns) + 1,
    column: (index % columns) + 1,
    site,
  }));
}

module.exports = {
  DEFAULT_PANE_COUNT,
  MIN_PANES,
  MAX_PANES,
  CONFIG_VERSION,
  DEFAULT_SITE_PRESETS,
  createDefaultConfig,
  createDefaultSites,
  createSite,
  duplicateSite,
  resolveColumns,
  normalizeConfig,
  normalizeSite,
  normalizeUrl,
  partitionForSite,
  paneSlots,
  resolveUserAgent,
  resolveZoomFactor,
  toSiteId,
};
