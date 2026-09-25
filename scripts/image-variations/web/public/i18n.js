/**
 * UI strings for the image-variations PWA.
 *
 * The language follows the browser unless the viewer picks one, so a Japanese
 * browser opens in Japanese without any setup. Only the UI is translated:
 * text quoted from the image API is left verbatim, because a diagnostic is
 * more useful unmangled than translated.
 */

const STORAGE_KEY = 'image-variations.lang';
const FALLBACK = 'en';

export const LANGUAGES = [
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'English' }
];

export const DICTIONARIES = {
  en: {
    title: 'Image Variations',
    loading: 'Loading…',
    langLabel: 'Interface language',

    stepReference: '1. Reference image',
    dropEmpty: 'Tap to choose an image, or drop one here',
    dropSome: '{n} reference image(s) - tap to add more',
    referenceHint: 'Up to 5 reference images. They are read in the browser and sent to the local server only when you generate.',
    referenceReady: 'Reference ready',
    referenceTooMany: 'At most {n} reference images',
    removeReference: 'Remove {name}',

    stepPattern: '2. Pattern set',
    preset: 'Preset',
    variations: 'Variations',
    seed: 'Seed',
    seedNote: '(blank = random)',
    seedPlaceholder: 'auto',
    whatMayVary: 'What may vary',
    varyHint: 'Turn a category off to keep one value fixed across every image.',
    optionCount: '{n} options',
    promptTemplate: 'Prompt template',

    stepRun: '3. Run',
    preview: 'Preview prompts',
    generate: 'Generate',
    runHint: 'Preview costs nothing; Generate calls the image API once per variation.',
    runHintNoKey: 'XAI_API_KEY is not set on the server - preview works, generating will fail.',

    plannedPrompts: 'Planned prompts',
    planning: 'Planning…',
    planned: 'Planned {n} prompt(s)',
    planSummary: 'seed {seed} - {n} of {space} possible combination(s)',
    planExhausted: ' - not enough distinct combinations, some prompts repeat',

    results: 'Results',
    downloadAll: 'Download all',
    download: 'Download',
    generating: 'Generating {done}/{total}…',
    doneAll: 'Done - {n} image(s), seed {seed}',
    doneSome: 'Done with {failures} failure(s) of {n} - seed {seed}',

    configReady: '{name} - model {model}',
    noPresets: 'no presets found on the server',
    noKey: 'server has no XAI_API_KEY',
    unreachable: 'cannot reach the local server - is it still running? ({detail})',

    footer: 'The xAI key stays on the machine running the server and never reaches this page.'
  },

  ja: {
    title: '画像バリエーション',
    loading: '読み込み中…',
    langLabel: '表示言語',

    stepReference: '1. 参照画像',
    dropEmpty: 'タップして画像を選ぶか、ここにドロップ',
    dropSome: '参照画像 {n} 枚 - タップで追加',
    referenceHint: '参照画像は最大 5 枚。ブラウザ内で読み込み、生成するときにのみローカルサーバへ送られます。',
    referenceReady: '参照画像を読み込みました',
    referenceTooMany: '参照画像は最大 {n} 枚までです',
    removeReference: '{name} を削除',

    stepPattern: '2. パターンセット',
    preset: 'プリセット',
    variations: '生成枚数',
    seed: 'シード',
    seedNote: '（空欄でランダム）',
    seedPlaceholder: '自動',
    whatMayVary: '変化させる項目',
    varyHint: 'オフにした項目は、全枚で同じ内容に固定されます。',
    optionCount: '{n} 個の選択肢',
    promptTemplate: 'プロンプトの雛形',

    stepRun: '3. 実行',
    preview: 'プロンプトを確認',
    generate: '生成',
    runHint: '確認だけなら費用はかかりません。生成は 1 枚につき 1 回画像 API を呼びます。',
    runHintNoKey: 'サーバに XAI_API_KEY が設定されていません。確認はできますが、生成は失敗します。',

    plannedPrompts: '生成予定のプロンプト',
    planning: '組み立て中…',
    planned: 'プロンプト {n} 件を組み立てました',
    planSummary: 'シード {seed} - 全 {space} 通りの組み合わせから {n} 件',
    planExhausted: ' - 組み合わせが足りず、一部のプロンプトが重複します',

    results: '生成結果',
    downloadAll: 'すべて保存',
    download: '保存',
    generating: '生成中 {done}/{total}…',
    doneAll: '完了 - {n} 枚、シード {seed}',
    doneSome: '完了 - {n} 枚中 {failures} 枚失敗、シード {seed}',

    configReady: '{name} - モデル {model}',
    noPresets: 'サーバにプリセットが見つかりません',
    noKey: 'サーバに XAI_API_KEY がありません',
    unreachable: 'ローカルサーバに接続できません。起動したままになっていますか？（{detail}）',

    footer: 'xAI のキーはサーバを動かしている端末に留まり、このページには届きません。'
  }
};

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * A stored choice wins; otherwise the first browser language we speak.
 */
export function detectLanguage(navigatorLanguages = navigator.languages || [navigator.language]) {
  const stored = readStored();
  if (DICTIONARIES[stored]) {
    return stored;
  }

  for (const tag of navigatorLanguages) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (DICTIONARIES[base]) {
      return base;
    }
  }
  return FALLBACK;
}

let current = FALLBACK;

export function getLanguage() {
  return current;
}

export function setLanguage(code, { persist = true } = {}) {
  current = DICTIONARIES[code] ? code : FALLBACK;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, current);
    } catch {
      // Blocked storage just means the choice lasts for this page view.
    }
  }
  return current;
}

export function t(key, vars = {}) {
  const dictionary = DICTIONARIES[current] || DICTIONARIES[FALLBACK];
  const template = dictionary[key] ?? DICTIONARIES[FALLBACK][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    (name in vars ? String(vars[name]) : match)
  );
}

/**
 * Translate everything marked up in the HTML. Text only - never innerHTML,
 * so a dictionary entry can never inject markup.
 */
export function applyStatic(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const node of root.querySelectorAll('[data-i18n-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nLabel));
  }

  document.title = t('title');
  document.documentElement.lang = current;
}
