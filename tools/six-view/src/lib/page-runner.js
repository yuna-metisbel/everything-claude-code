'use strict';

/**
 * Running scripts inside a pane, safely.
 *
 * Shared by every feature that drives a page, because they all meet the same
 * hazard: a click that navigates tears down the JS context the script is
 * running in. That rejects the pending call even though the click worked, so
 * it has to be read as an outcome rather than an error.
 */

/** How long to let a page settle after a click that navigates. */
const NAVIGATION_SETTLE_MS = 2000;

/**
 * Run a script in a pane.
 *
 * A torn-down context is reported as `context-lost`, so the caller can confirm
 * what happened by looking at the page instead of guessing.
 */
async function run(contents, script) {
  try {
    const result = await contents.executeJavaScript(script, true);
    return result && typeof result === 'object' ? result : { ok: false, reason: 'no-result' };
  } catch (err) {
    const message = String((err && err.message) || err);
    if (/destroyed|Script failed to execute|context/i.test(message)) {
      return { ok: false, reason: 'context-lost' };
    }
    return { ok: false, reason: 'script-error', message };
  }
}

/** Wait for a navigation to finish, or for the settle window to lapse. */
function settle(contents, ms = NAVIGATION_SETTLE_MS) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      contents.removeListener('did-stop-loading', finish);
      resolve();
    };
    contents.once('did-stop-loading', finish);
    setTimeout(finish, ms);
  });
}

module.exports = { run, settle, NAVIGATION_SETTLE_MS };
