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
const { createHash } = require('node:crypto');

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

function secureRendererHtml(html) {
  if (typeof html !== 'string' || !/<head\s*>/i.test(html)) {
    throw new Error('Renderer must be an HTML document with a head');
  }
  // Only packaged, build-owned inline scripts (currently the pre-paint theme
  // bootstrap) get hashes. Runtime/user content never passes through here.
  // Normalize CRLF as the HTML parser does before computing CSP hashes.
  const normalized = html.replace(/\r\n?/g, '\n');
  const hashes = Array.from(
    normalized.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi),
  )
    .filter((match) => !/\bsrc\s*=/i.test(match[1]))
    .map(
      (match) =>
        `'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`,
    );
  // file: responses cannot deliver HTTP headers. Meta is parsed BEFORE any
  // resource or script. frame-ancestors is ignored in meta and intentionally
  // absent; frame-src blocks shell children, and the navigation guard stays.
  // Source inventory: local Angular/Monaco scripts, styles and fonts; Angular
  // component styles and UI style attributes need inline CSS. styles.css imports
  // fonts.googleapis.com, whose fonts come from fonts.gstatic.com. Attachments
  // use data/blob images; local-tts-panel uses blob audio; Monaco uses workers.
  // Renderer network calls go over preload RPC: connect-src needs only local
  // resources, never backend provider URLs. Arbitrary remote images are denied.
  // No embedding protection is claimed for this meta policy: frame-ancestors
  // would require a response header and a different document delivery scheme.
  const policy = [
    "default-src 'none'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' https://fonts.gstatic.com data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-src 'none'",
    "form-action 'none'",
  ].join('; ');
  // Replace <base href="/"> or <base href="/"/> with <base href="./"> for Electron file:// loading
  return normalized
    .replace(/<base href="\/"\s*\/?>/i, '<base href="./">')
    .replace(
      /<head\s*>/i,
      `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    );
}

function patchIndexHtml(logPrefix) {
  const indexPath = path.join(DEST, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  fs.writeFileSync(indexPath, secureRendererHtml(html), 'utf8');
  console.log(`${logPrefix} Patched index.html: relative base and shell CSP`);
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

module.exports = { syncRenderer, secureRendererHtml, SOURCE, DEST };

if (require.main === module) {
  try {
    syncRenderer({ clean: true });
  } catch (err) {
    console.error(`[copy-renderer] ${err.message}`);
    process.exit(1);
  }
  console.log('[copy-renderer] Done');
}
