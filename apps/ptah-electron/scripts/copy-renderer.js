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
 */

const fs = require('fs');
const path = require('path');

const SOURCE = path.resolve(
  __dirname,
  '../../../dist/apps/ptah-extension-webview/browser'
);
const DEST = path.resolve(
  __dirname,
  '../../../dist/apps/ptah-electron/renderer'
);

// 1. Clean destination
if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true, force: true });
  console.log('[copy-renderer] Cleaned old renderer directory');
}

// 2. Copy webview build output
if (!fs.existsSync(SOURCE)) {
  console.error(`[copy-renderer] Source not found: ${SOURCE}`);
  console.error('[copy-renderer] Run "nx build ptah-extension-webview" first');
  process.exit(1);
}

fs.cpSync(SOURCE, DEST, { recursive: true });
console.log(`[copy-renderer] Copied ${SOURCE} -> ${DEST}`);

// 3. Patch index.html for file:// protocol
const indexPath = path.join(DEST, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');

// Replace <base href="/"> or <base href="/"/> with <base href="./"> for Electron file:// loading
// Angular CLI may output self-closing tags or standard tags depending on build config
const patched = html.replace(/<base href="\/"\s*\/?>/i, '<base href="./">');

if (patched !== html) {
  fs.writeFileSync(indexPath, patched, 'utf8');
  console.log('[copy-renderer] Patched index.html: base href="/" -> "./"');
} else {
  console.log(
    '[copy-renderer] index.html base href already correct or not found'
  );
}

console.log('[copy-renderer] Done');
