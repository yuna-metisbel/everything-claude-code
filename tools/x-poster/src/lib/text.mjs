/**
 * Post text rules, independent of Cloudflare so they can be unit tested.
 */

/** X counts most CJK characters as 2 and every link as 23. */
const LINK = /https?:\/\/\S+/g;
const LIMIT = 280;

function isLightChar(code) {
  return (
    (code >= 0x0000 && code <= 0x10ff) ||
    (code >= 0x2000 && code <= 0x200d) ||
    (code >= 0x2010 && code <= 0x201f) ||
    (code >= 0x2032 && code <= 0x2037)
  );
}

/** The length X will see, out of 280. */
export function weightedLength(text) {
  const source = String(text || '').normalize('NFC');
  let total = 0;
  const withoutLinks = source.replace(LINK, () => {
    total += 23;
    return '';
  });
  for (const ch of withoutLinks) total += isLightChar(ch.codePointAt(0)) ? 1 : 2;
  return total;
}

/** Why a text cannot be posted, or '' when it can. */
export function textProblem(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '本文が空です';
  const length = weightedLength(trimmed);
  if (length > LIMIT) return `長すぎます（${length} / ${LIMIT}。日本語は1文字2として数えます）`;
  return '';
}

/**
 * The same post in different clothes: spacing, width and case removed. Used to
 * stop one text going out from several accounts.
 */
export function normalizeForDuplicate(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(LINK, 'URL')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[!！?？。、.,，・…~〜ー-]+/g, '');
}

export async function textHash(text) {
  const data = new TextEncoder().encode(normalizeForDuplicate(text));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * "2026-10-08 09:00" (Japan time) -> epoch ms. Also takes "10/8 9:00",
 * "9:00" (today, or tomorrow if already past) and "明日 9:00".
 */
export function parseJst(input, now = Date.now()) {
  const s = String(input || '').trim().normalize('NFKC');
  const JST = 9 * 60 * 60 * 1000;
  const today = new Date(now + JST);
  let y = today.getUTCFullYear();
  let mo = today.getUTCMonth() + 1;
  let d = today.getUTCDate();
  let rest = s;
  let dayGiven = false;

  let m = rest.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?\s*/);
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    rest = rest.slice(m[0].length);
    dayGiven = true;
  } else if ((m = rest.match(/^(\d{1,2})[/月](\d{1,2})日?\s*/))) {
    [mo, d] = [Number(m[1]), Number(m[2])];
    rest = rest.slice(m[0].length);
    dayGiven = true;
  } else if ((m = rest.match(/^(明日|あした)\s*/))) {
    const t = new Date(now + JST + 24 * 60 * 60 * 1000);
    [y, mo, d] = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
    rest = rest.slice(m[0].length);
    dayGiven = true;
  }

  m = rest.match(/^(\d{1,2})[:時](\d{2})?分?$/);
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2] || 0);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return NaN;

  let at = Date.UTC(y, mo - 1, d, h, mi) - JST;
  if (!dayGiven && at <= now) at += 24 * 60 * 60 * 1000;
  // "10/8" in December means next year's October.
  if (dayGiven && at < now - 24 * 60 * 60 * 1000 && !/^\d{4}/.test(s)) {
    at = Date.UTC(y + 1, mo - 1, d, h, mi) - JST;
  }
  return at;
}

export function formatJst(ms) {
  if (!ms) return '';
  const t = new Date(Number(ms) + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}/${pad(t.getUTCMonth() + 1)}/${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}
