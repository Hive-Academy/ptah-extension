/**
 * Copy Renderer Script
 *
 * Copies the Angular webview build output to the Electron renderer directory.
 * Performs a clean copy (removes old files first) and patches index.html
 * for Electron's file:// protocol compatibility.
 *
 * Key fix: Changes <base href="/"> to <base href="./"> so that relative
 * script/style paths resolve correctly when loaded via file:// protocol.
 * In VS Code webviews, the base href is rewritten by the webview host,
 * but in Electron's loadFile() it must be relative.
 *
 * Run as a script (`node copy-renderer.js`) it does a clean copy — the
 * behaviour `nx copy-renderer` and `nx package` depend on. Required as a
 * module it exposes `syncRenderer({ clean })` so `watch-renderer.js` can do
 * additive syncs against a running dev window.
 */

const fs = require('fs');
const path = require('path');

const SOURCE = path.resolve(
  __dirname,
  '../../../dist/apps/ptah-extension-webview/browser',
);
const DEST = path.resolve(
  __dirname,
  '../../../dist/apps/ptah-electron/renderer',
);

// Walk SOURCE manually so broken symlinks (occasionally produced by npm's
// _cacache for monaco-editor's min/vs/basic-languages on Linux runners) are
// skipped rather than aborting the whole copy with a C++ filesystem_error.
function copyRecursive(src, dst) {
  let entries;
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      console.warn(
        `[copy-renderer] Skipping unreadable dir: ${src} (${err.code})`,
      );
      return;
    }
    throw err;
  }
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isSymbolicLink()) {
      // Follow the link; if target is missing, skip rather than abort.
      let stat;
      try {
        stat = fs.statSync(srcPath);
      } catch {
        console.warn(`[copy-renderer] Skipping broken symlink: ${srcPath}`);
        continue;
      }
      if (stat.isDirectory()) {
        copyRecursive(srcPath, dstPath);
      } else {
        fs.copyFileSync(srcPath, dstPath);
      }
    } else if (entry.isDirectory()) {
      copyRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function patchIndexHtml(logPrefix) {
  const indexPath = path.join(DEST, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');

  // Replace <base href="/"> or <base href="/"/> with <base href="./"> for Electron file:// loading
  // Angular CLI may output self-closing tags or standard tags depending on build config
  const patched = html.replace(/<base href="\/"\s*\/?>/i, '<base href="./">');

  if (patched !== html) {
    fs.writeFileSync(indexPath, patched, 'utf8');
    console.log(`${logPrefix} Patched index.html: base href="/" -> "./"`);
  } else {
    console.log(
      `${logPrefix} index.html base href already correct or not found`,
    );
  }
}

/**
 * @param {{ clean?: boolean, logPrefix?: string }} [options]
 *   clean — remove DEST first. Always true for packaging. The watcher passes
 *   false so a running window keeps finding the lazy chunks it already
 *   resolved; the next clean copy prunes them.
 */
function syncRenderer({ clean = true, logPrefix = '[copy-renderer]' } = {}) {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(
      `Source not found: ${SOURCE}\nRun "nx build ptah-extension-webview" first`,
    );
  }

  if (clean && fs.existsSync(DEST)) {
    fs.rmSync(DEST, { recursive: true, force: true });
    console.log(`${logPrefix} Cleaned old renderer directory`);
  }

  copyRecursive(SOURCE, DEST);
  console.log(`${logPrefix} Copied ${SOURCE} -> ${DEST}`);

  patchIndexHtml(logPrefix);
}

module.exports = { syncRenderer, SOURCE, DEST };

if (require.main === module) {
  try {
    syncRenderer({ clean: true });
  } catch (err) {
    console.error(`[copy-renderer] ${err.message}`);
    process.exit(1);
  }
  console.log('[copy-renderer] Done');
}
