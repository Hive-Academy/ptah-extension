/**
 * Watch Renderer Script (development only)
 *
 * `nx serve:watch ptah-electron` rebuilds the Angular webview into
 * dist/apps/ptah-extension-webview/browser, but nothing re-ran copy-renderer —
 * so dist/apps/ptah-electron/renderer kept whatever build was copied last.
 * Every rebuild changes the content-hashed chunk names, so a live window would
 * resolve a lazy import (editor, canvas, wizard…) against a renderer directory
 * that no longer contained that chunk: ERR_FILE_NOT_FOUND, then Angular's
 * "Failed to fetch dynamically imported module", then a permanent spinner.
 *
 * This watcher mirrors the webview output into the renderer directory after
 * every build. The sync is ADDITIVE — stale chunks are left on disk so a window
 * that has not reloaded yet still finds the chunks it already resolved. The
 * clean copy in copy-renderer.js (run by `nx serve` and `nx package`) prunes
 * them.
 *
 * Not part of any production target.
 */

const fs = require('fs');
const path = require('path');
const { syncRenderer, SOURCE } = require('./copy-renderer');

const PREFIX = '[watch-renderer]';
const DEBOUNCE_MS = 400;
const SETTLE_POLL_MS = 250;
const SETTLE_MAX_POLLS = 40; // 10s ceiling before we sync anyway

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every chunk name referenced by index.html or a root-level bundle. */
function referencedChunks() {
  const refs = new Set();
  for (const name of fs.readdirSync(SOURCE)) {
    if (!name.endsWith('.js') && name !== 'index.html') continue;
    const text = fs.readFileSync(path.join(SOURCE, name), 'utf8');
    for (const match of text.matchAll(/chunk-[A-Z0-9]{8}\.js/g)) {
      refs.add(match[0]);
    }
  }
  return refs;
}

/**
 * A half-written build is the one thing worse than a stale one: copying it
 * leaves the renderer referencing chunks that exist nowhere. Only sync once
 * every chunk the entry points name is present in SOURCE.
 */
function isBuildSettled() {
  try {
    if (!fs.existsSync(path.join(SOURCE, 'index.html'))) return false;
    for (const chunk of referencedChunks()) {
      if (!fs.existsSync(path.join(SOURCE, chunk))) return false;
    }
    return true;
  } catch {
    return false; // mid-write read error — poll again
  }
}

let syncing = false;
let resyncQueued = false;

async function sync() {
  if (syncing) {
    resyncQueued = true;
    return;
  }
  syncing = true;
  try {
    for (let poll = 0; poll < SETTLE_MAX_POLLS; poll++) {
      if (isBuildSettled()) break;
      await wait(SETTLE_POLL_MS);
    }
    syncRenderer({ clean: false, logPrefix: PREFIX });
    console.log(`${PREFIX} Renderer in sync — reload the Electron window`);
  } catch (err) {
    console.error(`${PREFIX} Sync failed: ${err.message}`);
  } finally {
    syncing = false;
    if (resyncQueued) {
      resyncQueued = false;
      void sync();
    }
  }
}

let debounce;
function scheduleSync() {
  clearTimeout(debounce);
  debounce = setTimeout(() => void sync(), DEBOUNCE_MS);
}

function arm() {
  if (!fs.existsSync(SOURCE)) {
    console.log(`${PREFIX} Waiting for ${SOURCE}`);
    setTimeout(arm, 2000);
    return;
  }

  let watcher;
  try {
    watcher = fs.watch(SOURCE, { recursive: true }, scheduleSync);
  } catch (err) {
    console.error(
      `${PREFIX} Could not watch source (${err.message}); retrying`,
    );
    setTimeout(arm, 2000);
    return;
  }

  // The Angular builder can replace the output directory wholesale, which
  // kills the handle — re-arm instead of dying silently.
  watcher.on('error', (err) => {
    console.warn(`${PREFIX} Watch error (${err.message}); re-arming`);
    watcher.close();
    setTimeout(arm, 2000);
  });

  console.log(`${PREFIX} Watching ${SOURCE}`);
  void sync();
}

arm();
