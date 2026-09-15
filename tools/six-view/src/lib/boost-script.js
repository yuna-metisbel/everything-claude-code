'use strict';

/**
 * Scripts for the boost button.
 *
 * Reading and pressing are separate passes, for the same reason the DM scripts
 * are: a boost button usually submits or navigates, which destroys the script
 * still running in the page. So the press script does nothing after the click,
 * and whether it worked is established by reading the page again afterwards.
 */

const { HELPERS } = require('./dm-script');

/**
 * Is this element off?
 *
 * Sites say "not yet" in several ways - a disabled attribute, an aria flag, a
 * greyed-out class, or a button that simply ignores clicks. Treating any of
 * them as off is the safe direction: the worst case is a boost pressed one
 * cycle late, rather than a button hammered while it is refusing.
 */
const OFF = `
  const looksOff = (el) => {
    if (!el) return true;
    if (el.disabled === true) return true;
    if (el.getAttribute('aria-disabled') === 'true') return true;
    if (el.closest('[disabled],[aria-disabled="true"]')) return true;

    const cls = (el.className && el.className.baseVal !== undefined
      ? el.className.baseVal
      : String(el.className || '')).toLowerCase();
    if (/disabled|inactive|is-off|is-done|not-allowed/.test(cls)) return true;

    const style = getComputedStyle(el);
    if (style.pointerEvents === 'none') return true;
    if (Number(style.opacity) <= 0.5) return true;
    return false;
  };
`;

/** Read the button's state without touching it. */
function buildBoostReadScript(selector) {
  return `(() => {
  ${HELPERS}
  ${OFF}
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { ok: true, found: false, pressable: false };

  const shown = visible(el);
  const off = looksOff(el);
  return {
    ok: true,
    found: true,
    visible: shown,
    disabled: off,
    // The label often carries the countdown ("あと 2:14"), which is worth
    // showing in the settings window even though nothing decides on it.
    text: textOf(el).slice(0, 80),
    pressable: shown && !off,
  };
})();`;
}

/**
 * Press the button.
 *
 * Ends on the click: anything after it may never run, because the click can
 * navigate. The caller confirms by reading the page again.
 */
function buildBoostPressScript(selector) {
  return `(() => {
  ${HELPERS}
  ${OFF}
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { ok: false, reason: 'not-found' };
  if (!visible(el)) return { ok: false, reason: 'not-visible' };
  if (looksOff(el)) return { ok: false, reason: 'not-ready' };

  // Nothing may be awaited past this point.
  el.click();
  return { ok: true, clicked: true };
})();`;
}

module.exports = { buildBoostReadScript, buildBoostPressScript };
