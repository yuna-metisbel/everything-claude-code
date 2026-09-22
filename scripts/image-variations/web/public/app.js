/**
 * image-variations PWA.
 *
 * The page holds no credentials: it asks the local server for the option
 * patterns, gets a plan of prompts, then walks that plan a few requests at a
 * time so progress shows up image by image instead of all at the end.
 */

import * as net from './net.js';
import * as db from './db.js';
import { LANGUAGES, applyStatic, detectLanguage, setLanguage, t } from './i18n.js';

const MAX_REFERENCE_IMAGES = 5;
const CONCURRENCY = 2;

const el = id => document.getElementById(id);
const ui = {
  status: el('status'),
  lang: el('lang'),
  file: el('file'),
  drop: el('drop'),
  dropText: el('drop-text'),
  refs: el('refs'),
  preset: el('preset'),
  count: el('count'),
  seed: el('seed'),
  categories: el('categories'),
  template: el('template'),
  plan: el('plan'),
  generate: el('generate'),
  runHint: el('run-hint'),
  planCard: el('plan-card'),
  planSummary: el('plan-summary'),
  prompts: el('prompts'),
  resultsCard: el('results-card'),
  results: el('results'),
  downloadAll: el('download-all')
};

const state = {
  references: [],
  config: null,
  vary: new Set(),
  plan: null,
  items: [],
  results: new Map(),
  hasApiKey: true,
  status: null,
  busy: false
};

/* ---------- status ---------- */

/**
 * Statuses are kept as a key plus values rather than a finished string, so
 * switching language re-renders the current one instead of stranding it.
 */
function setStatus(key, vars = {}, tone = '') {
  state.status = { key, vars, tone };
  renderStatus();
}

/** For text quoted from the server or the image API: shown exactly as received. */
function setRawStatus(text, tone = '') {
  state.status = { raw: text, tone };
  renderStatus();
}

function renderStatus() {
  if (!state.status) {
    return;
  }
  const { key, vars, raw, tone } = state.status;
  ui.status.textContent = raw === undefined ? t(key, vars) : raw;
  ui.status.dataset.tone = tone || '';
}

function setBusy(busy) {
  state.busy = busy;
  ui.plan.disabled = busy;
  ui.generate.disabled = busy;
}

/* ---------- reference images ---------- */

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error(`could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function renderReferences() {
  ui.refs.replaceChildren(...state.references.map((reference, index) => {
    const item = document.createElement('li');

    const image = document.createElement('img');
    image.src = reference.dataUrl;
    image.alt = reference.name;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = t('removeReference', { name: reference.name });
    remove.addEventListener('click', () => {
      state.references.splice(index, 1);
      renderReferences();
      persistReferences();
    });

    item.append(image, remove);
    return item;
  }));

  ui.dropText.textContent = state.references.length > 0
    ? t('dropSome', { n: state.references.length })
    : t('dropEmpty');
}

function persistReferences() {
  db.set('references', state.references.map(({ name, dataUrl }) => ({ name, dataUrl })));
}

async function addFiles(fileList) {
  const files = [...fileList].filter(file => file.type.startsWith('image/'));
  if (files.length === 0) {
    return;
  }

  const room = MAX_REFERENCE_IMAGES - state.references.length;
  if (room <= 0) {
    setStatus('referenceTooMany', { n: MAX_REFERENCE_IMAGES }, 'bad');
    return;
  }

  for (const file of files.slice(0, room)) {
    try {
      state.references.push({ name: file.name, dataUrl: await readAsDataUrl(file) });
    } catch (error) {
      setRawStatus(error.message, 'bad');
    }
  }

  renderReferences();
  persistReferences();
  setStatus('referenceReady', {}, 'ok');
}

/* ---------- pattern set ---------- */

/** A preset may rename a category for display; the ASCII key is the fallback. */
function categoryLabel(name) {
  const labels = state.config && state.config.labels;
  return (labels && labels[name]) || name;
}

function renderCategories() {
  if (!state.config) {
    return;
  }

  ui.categories.replaceChildren(...Object.keys(state.config.categories).map(name => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('aria-pressed', String(state.vary.has(name)));

    const label = document.createElement('span');
    label.textContent = categoryLabel(name);
    const count = document.createElement('small');
    count.textContent = t('optionCount', { n: state.config.categories[name].length });
    chip.append(label, count);

    chip.addEventListener('click', () => {
      if (state.vary.has(name)) {
        state.vary.delete(name);
      } else {
        state.vary.add(name);
      }
      chip.setAttribute('aria-pressed', String(state.vary.has(name)));
      persistSettings();
    });

    return chip;
  }));
}

/**
 * The server takes either `lock` or `only`; sending `only` when some
 * categories are switched off keeps the request unambiguous.
 */
function varyPayload() {
  const names = Object.keys(state.config.categories);
  const vary = names.filter(name => state.vary.has(name));
  return vary.length === names.length ? {} : { only: vary };
}

function currentRequest() {
  return {
    preset: ui.preset.value,
    count: Number(ui.count.value),
    seed: ui.seed.value.trim(),
    ...varyPayload()
  };
}

function persistSettings() {
  db.set('settings', {
    preset: ui.preset.value,
    count: ui.count.value,
    seed: ui.seed.value,
    vary: [...state.vary]
  });
}

function renderRunHint() {
  ui.runHint.textContent = t(state.hasApiKey ? 'runHint' : 'runHintNoKey');
}

async function loadConfig(preset, restoredVary = null) {
  state.config = await net.getConfig(preset);
  state.vary = new Set(restoredVary && restoredVary.length > 0
    ? restoredVary.filter(name => name in state.config.categories)
    : Object.keys(state.config.categories));

  ui.template.textContent = state.config.template;
  renderCategories();

  const warning = state.config.warnings[0];
  if (warning) {
    setRawStatus(`${state.config.name}: ${warning}`, 'bad');
  } else {
    setStatus('configReady', { name: state.config.name, model: state.config.model });
  }
}

/* ---------- planning ---------- */

function renderPlan() {
  const plan = state.plan;
  if (!plan) {
    return;
  }

  ui.planSummary.textContent =
    t('planSummary', { seed: plan.seed, n: plan.items.length, space: plan.space }) +
    (plan.exhausted ? t('planExhausted') : '');

  ui.prompts.replaceChildren(...plan.items.map(item => {
    const entry = document.createElement('li');
    const picks = document.createElement('b');
    picks.textContent = Object.entries(item.picks)
      .map(([key, value]) => `${categoryLabel(key)}: ${value}`)
      .join(' / ');
    const prompt = document.createElement('span');
    prompt.textContent = item.prompt;
    entry.append(picks, prompt);
    return entry;
  }));

  ui.planCard.hidden = false;
}

async function runPlan() {
  setBusy(true);
  setStatus('planning');
  try {
    state.plan = await net.plan(currentRequest());
    state.items = state.plan.items;
    ui.seed.value = state.plan.seed;
    renderPlan();
    setStatus('planned', { n: state.plan.items.length }, 'ok');
  } catch (error) {
    setRawStatus(error.message, 'bad');
  } finally {
    setBusy(false);
  }
}

/* ---------- generating ---------- */

function imageSource(image) {
  return image.kind === 'base64' ? `data:image/png;base64,${image.value}` : image.value;
}

function tileFor(item) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.id = `tile-${item.index}`;

  const figure = document.createElement('figure');
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  figure.append(spinner);

  const caption = document.createElement('figcaption');
  for (const [key, value] of Object.entries(item.picks)) {
    const row = document.createElement('div');
    row.className = 'pick';
    const name = document.createElement('span');
    name.textContent = categoryLabel(key);
    const text = document.createElement('span');
    text.textContent = value;
    row.append(name, text);
    caption.append(row);
  }

  tile.append(figure, caption);
  return tile;
}

function fillTile(tile, item, result) {
  const figure = tile.querySelector('figure');

  if (!result.ok) {
    const message = document.createElement('p');
    message.className = 'state';
    message.dataset.tone = 'bad';
    message.textContent = result.error;
    figure.replaceChildren(message);
    return;
  }

  const image = document.createElement('img');
  image.src = imageSource(result.image);
  image.alt = item.prompt;
  image.loading = 'lazy';
  figure.replaceChildren(image);

  const tools = document.createElement('div');
  tools.className = 'tools';
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'ghost small';
  download.textContent = t('download');
  download.addEventListener('click', () => downloadOne(item, result));
  tools.append(download);
  tile.append(tools);
}

function renderResults() {
  if (state.items.length === 0) {
    return;
  }

  ui.results.replaceChildren(...state.items.map(item => {
    const tile = tileFor(item);
    const result = state.results.get(item.index);
    if (result) {
      fillTile(tile, item, result);
    }
    return tile;
  }));
  ui.resultsCard.hidden = false;
}

function downloadOne(item, result) {
  const link = document.createElement('a');
  link.href = imageSource(result.image);
  link.download = `${String(item.index).padStart(3, '0')}_${item.slug || 'variation'}.png`;
  link.rel = 'noopener';
  link.click();
}

/**
 * Bounded pool so a count of 24 does not open 24 sockets at once, while
 * results still land as soon as each one is done.
 */
async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

async function runGenerate() {
  setBusy(true);
  setStatus('planning');

  try {
    const request = currentRequest();
    const plan = await net.plan(request);
    state.plan = plan;
    state.items = plan.items;
    state.results = new Map();
    ui.seed.value = plan.seed;
    renderPlan();

    const referenceImages = state.references.map(reference => reference.dataUrl);
    ui.results.replaceChildren(...plan.items.map(tileFor));
    ui.resultsCard.hidden = false;

    let done = 0;
    setStatus('generating', { done, total: plan.items.length });

    await runPool(plan.items, CONCURRENCY, async item => {
      let result;
      try {
        const payload = await net.generateOne({
          preset: request.preset,
          prompt: item.prompt,
          referenceImages
        });
        result = { ok: true, image: payload.image };
      } catch (error) {
        result = { ok: false, error: error.message };
      }

      state.results.set(item.index, result);
      fillTile(document.getElementById(`tile-${item.index}`), item, result);
      done++;
      setStatus('generating', { done, total: plan.items.length });
    });

    const failures = [...state.results.values()].filter(result => !result.ok).length;
    if (failures === 0) {
      setStatus('doneAll', { n: plan.items.length, seed: plan.seed }, 'ok');
    } else {
      setStatus('doneSome', { n: plan.items.length, failures, seed: plan.seed }, 'bad');
    }

    db.set('lastRun', { plan, results: [...state.results] });
  } catch (error) {
    setRawStatus(error.message, 'bad');
  } finally {
    setBusy(false);
  }
}

function downloadAll() {
  for (const item of state.items) {
    const result = state.results.get(item.index);
    if (result && result.ok) {
      downloadOne(item, result);
    }
  }
}

/* ---------- language ---------- */

function renderLocalized() {
  applyStatic();
  renderStatus();
  renderReferences();
  renderCategories();
  renderRunHint();
  renderPlan();
  renderResults();
}

function wireLanguage() {
  const active = setLanguage(detectLanguage(), { persist: false });

  ui.lang.replaceChildren(...LANGUAGES.map(({ code, label }) => new Option(label, code)));
  ui.lang.value = active;

  ui.lang.addEventListener('change', () => {
    setLanguage(ui.lang.value);
    renderLocalized();
  });
}

/* ---------- restore + boot ---------- */

function restoreLastRun(lastRun) {
  if (!lastRun || !lastRun.plan || !Array.isArray(lastRun.plan.items) || lastRun.plan.items.length === 0) {
    return;
  }

  state.plan = lastRun.plan;
  state.items = lastRun.plan.items;
  state.results = new Map(lastRun.results || []);
  renderResults();
}

function wireEvents() {
  ui.file.addEventListener('change', event => {
    addFiles(event.target.files);
    event.target.value = '';
  });

  for (const type of ['dragenter', 'dragover']) {
    ui.drop.addEventListener(type, event => {
      event.preventDefault();
      ui.drop.classList.add('over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    ui.drop.addEventListener(type, event => {
      event.preventDefault();
      ui.drop.classList.remove('over');
      if (type === 'drop' && event.dataTransfer) {
        addFiles(event.dataTransfer.files);
      }
    });
  }

  ui.preset.addEventListener('change', async () => {
    try {
      await loadConfig(ui.preset.value);
      persistSettings();
    } catch (error) {
      setRawStatus(error.message, 'bad');
    }
  });

  for (const input of [ui.count, ui.seed]) {
    input.addEventListener('change', persistSettings);
  }

  ui.plan.addEventListener('click', runPlan);
  ui.generate.addEventListener('click', runGenerate);
  ui.downloadAll.addEventListener('click', downloadAll);
}

async function boot() {
  net.adoptTokenFromUrl();
  wireLanguage();
  applyStatic();
  setStatus('loading');
  wireEvents();

  try {
    const [{ presets, hasApiKey }, settings, references, lastRun] = await Promise.all([
      net.listPresets(),
      db.get('settings'),
      db.get('references', []),
      db.get('lastRun')
    ]);

    if (presets.length === 0) {
      setStatus('noPresets', {}, 'bad');
      return;
    }

    state.hasApiKey = hasApiKey;
    ui.preset.replaceChildren(...presets.map(({ id }) => new Option(id, id)));
    if (settings && presets.some(preset => preset.id === settings.preset)) {
      ui.preset.value = settings.preset;
      ui.count.value = settings.count;
      ui.seed.value = settings.seed;
    }

    state.references = Array.isArray(references) ? references : [];
    renderReferences();
    restoreLastRun(lastRun);

    await loadConfig(ui.preset.value, settings ? settings.vary : null);

    renderRunHint();
    if (!hasApiKey) {
      setStatus('noKey', {}, 'bad');
    }
  } catch (error) {
    setRawStatus(error.message, 'bad');
  }

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline shell is a bonus; the app works without it.
    });
  }
}

boot();
