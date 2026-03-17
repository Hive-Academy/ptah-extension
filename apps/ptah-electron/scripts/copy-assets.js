/**
 * Copy Assets Script
 *
 * Copies the Electron app's static assets (icons, images, etc.) to the
 * dist output directory. This ensures runtime references like
 * path.join(__dirname, 'assets', 'icons', 'icon.png') resolve correctly
 * when running from the dist/ directory during development or after packaging.
 *
 * Performs a clean copy (removes old files first) to avoid stale assets.
 */

const fs = require('fs');
const path = require('path');

const SOURCE = path.resolve(__dirname, '../src/assets');
const DEST = path.resolve(__dirname, '../../../dist/apps/ptah-electron/assets');

// 1. Clean destination
if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true, force: true });
  console.log('[copy-assets] Cleaned old assets directory');
}

// 2. Verify source exists
if (!fs.existsSync(SOURCE)) {
  console.error(`[copy-assets] Source not found: ${SOURCE}`);
  console.error(
    '[copy-assets] Expected assets at apps/ptah-electron/src/assets/'
  );
  process.exit(1);
}

// 3. Copy assets to dist
fs.cpSync(SOURCE, DEST, { recursive: true });
console.log(`[copy-assets] Copied ${SOURCE} -> ${DEST}`);

console.log('[copy-assets] Done');
