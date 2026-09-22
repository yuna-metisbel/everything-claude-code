/**
 * image-variations PWA.
 *
 * The page holds no credentials: it asks the local server for the option
 * patterns, gets a plan of prompts, then walks that plan a few requests at a
 * time so progress shows up image by image instead of all at the end.
 */

import * as net from './net.js';
import * as db from './db.js';

const MAX_REFERENCE_IMAGES = 5;
const CONCURRENCY = 2;

const el = id => document.getElementById(id);
const ui = {
  status: el('status'),
  file: el('file'),
  drop: el('drop'),
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
  items: [],
  results: new Map(),
  busy: false
};

function setStatus(message, tone = '') {
  ui.status.textContent = message;
  ui.status.dataset.tone = tone;
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
    remove.title = `Remove ${reference.name}`;
    remove.addEventListener('click', () => {
      state.references.splice(index, 1);
      renderReferences();
      persistReferences();
    });

    item.append(image, remove);
    return item;
  }));

  el('drop-text').textContent = state.references.length > 0
    ? `${state.references.length} reference image(s) - tap to add more`
    : 'Tap to choose an image, or drop one here';
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
    setStatus(`At most ${MAX_REFERENCE_IMAGES} reference images`, 'bad');
    return;
  }

  for (const file of files.slice(0, room)) {
    try {
      state.references.push({ name: file.name, dataUrl: await readAsDataUrl(file) });
    } catch (error) {
      setStatus(error.message, 'bad');
    }
  }

  renderReferences();
  persistReferences();
  setStatus('Reference ready', 'ok');
}

/* ---------- pattern set ---------- */

function renderCategories() {
  const names = Object.keys(state.config.categories);

  ui.categories.replaceChildren(...names.map(name => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('aria-pressed', String(state.vary.has(name)));

    const label = document.createElement('span');
    label.textContent = name;
    const count = document.createElement('small');
    count.textContent = `${state.config.categories[name].length} options`;
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

async function loadConfig(preset, restoredVary = null) {
  state.config = await net.getConfig(preset);
  state.vary = new Set(restoredVary && restoredVary.length > 0
    ? restoredVary.filter(name => name in state.config.categories)
    : Object.keys(state.config.categories));

  ui.template.textContent = state.config.template;
  renderCategories();

  const warning = state.config.warnings[0];
  setStatus(warning ? `${state.config.name}: ${warning}` : `${state.config.name} - model ${state.config.model}`,
    warning ? 'bad' : '');
}

/* ---------- planning ---------- */

function renderPlan(plan) {
  ui.planSummary.textContent =
    `seed ${plan.seed} - ${plan.items.length} of ${plan.space} possible combination(s)` +
    (plan.exhausted ? ' - not enough distinct combinations, some prompts repeat' : '');

  ui.prompts.replaceChildren(...plan.items.map(item => {
    const entry = document.createElement('li');
    const picks = document.createElement('b');
    picks.textContent = Object.entries(item.picks).map(([key, value]) => `${key}: ${value}`).join(' / ');
    const prompt = document.createElement('span');
    prompt.textContent = item.prompt;
    entry.append(picks, prompt);
    return entry;
  }));

  ui.planCard.hidden = false;
  ui.seed.value = plan.seed;
}

async function runPlan() {
  setBusy(true);
  setStatus('Planning…');
  try {
    const plan = await net.plan(currentRequest());
    state.items = plan.items;
    renderPlan(plan);
    setStatus(`Planned ${plan.items.length} prompt(s)`, 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
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
    name.textContent = key;
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
    const state_ = document.createElement('p');
    state_.className = 'state';
    state_.dataset.tone = 'bad';
    state_.textContent = result.error;
    figure.replaceChildren(state_);
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
  download.textContent = 'Download';
  download.addEventListener('click', () => downloadOne(item, result));
  tools.append(download);
  tile.append(tools);
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
  setStatus('Planning…');

  try {
    const request = currentRequest();
    const plan = await net.plan(request);
    state.items = plan.items;
    state.results = new Map();
    renderPlan(plan);

    const referenceImages = state.references.map(reference => reference.dataUrl);
    ui.results.replaceChildren(...plan.items.map(tileFor));
    ui.resultsCard.hidden = false;

    let done = 0;
    setStatus(`Generating 0/${plan.items.length}…`);

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
      setStatus(`Generating ${done}/${plan.items.length}…`);
    });

    const failures = [...state.results.values()].filter(result => !result.ok).length;
    setStatus(
      failures === 0
        ? `Done - ${plan.items.length} image(s), seed ${plan.seed}`
        : `Done with ${failures} failure(s) of ${plan.items.length} - seed ${plan.seed}`,
      failures === 0 ? 'ok' : 'bad'
    );

    db.set('lastRun', { seed: plan.seed, items: plan.items, results: [...state.results] });
  } catch (error) {
    setStatus(error.message, 'bad');
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

/* ---------- restore + boot ---------- */

function restoreLastRun(lastRun) {
  if (!lastRun || !Array.isArray(lastRun.items) || lastRun.items.length === 0) {
    return;
  }

  state.items = lastRun.items;
  state.results = new Map(lastRun.results || []);

  ui.results.replaceChildren(...lastRun.items.map(item => {
    const tile = tileFor(item);
    const result = state.results.get(item.index);
    if (result) {
      fillTile(tile, item, result);
    }
    return tile;
  }));
  ui.resultsCard.hidden = false;
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
      setStatus(error.message, 'bad');
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
  wireEvents();

  try {
    const [{ presets, hasApiKey }, settings, references, lastRun] = await Promise.all([
      net.listPresets(),
      db.get('settings'),
      db.get('references', []),
      db.get('lastRun')
    ]);

    if (presets.length === 0) {
      setStatus('no presets found on the server', 'bad');
      return;
    }

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

    ui.runHint.textContent = hasApiKey
      ? 'Preview costs nothing; Generate calls the image API once per variation.'
      : 'XAI_API_KEY is not set on the server - preview works, generating will fail.';
    if (!hasApiKey) {
      setStatus('server has no XAI_API_KEY', 'bad');
    }
  } catch (error) {
    setStatus(error.message, 'bad');
  }

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline shell is a bonus; the app works without it.
    });
  }
}

boot();
