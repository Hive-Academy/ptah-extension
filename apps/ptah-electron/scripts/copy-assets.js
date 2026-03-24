/**
 * Copy Assets Script
 *
 * Copies the Electron app's static assets (icons, images, etc.) to the
 * dist output directory. This ensures runtime references like
 * path.join(__dirname, 'assets', 'icons', 'icon.png') resolve correctly
 * when running from the dist/ directory during development or after packaging.
 *
 * Also copies shared plugin assets and agent-generation templates so that
 * PluginLoaderService and TemplateStorageService can resolve them at runtime.
 *
 * Performs a clean copy (removes old files first) to avoid stale assets.
 */

const fs = require('fs');
const path = require('path');

// --- 1. Electron src/assets (icons, images) ---

const SOURCE = path.resolve(__dirname, '../src/assets');
const DEST = path.resolve(__dirname, '../../../dist/apps/ptah-electron/assets');

// 1a. Clean destination
if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true, force: true });
  console.log('[copy-assets] Cleaned old assets directory');
}

// 1b. Verify source exists
if (!fs.existsSync(SOURCE)) {
  console.error(`[copy-assets] Source not found: ${SOURCE}`);
  console.error(
    '[copy-assets] Expected assets at apps/ptah-electron/src/assets/'
  );
  process.exit(1);
}

// 1c. Copy assets to dist
fs.cpSync(SOURCE, DEST, { recursive: true });
console.log(`[copy-assets] Copied ${SOURCE} -> ${DEST}`);

// --- 2. Plugin assets (shared with VS Code extension) ---

const PLUGIN_SOURCE = path.resolve(
  __dirname,
  '../../../apps/ptah-extension-vscode/assets/plugins'
);
const PLUGIN_DEST = path.resolve(
  __dirname,
  '../../../dist/apps/ptah-electron/assets/plugins'
);

// 2a. Clean old plugin directory
if (fs.existsSync(PLUGIN_DEST)) {
  fs.rmSync(PLUGIN_DEST, { recursive: true, force: true });
  console.log('[copy-assets] Cleaned old plugins directory');
}

// 2b. Copy plugins (warn if source missing — plugins may not exist during partial builds)
if (fs.existsSync(PLUGIN_SOURCE)) {
  fs.cpSync(PLUGIN_SOURCE, PLUGIN_DEST, { recursive: true });
  console.log(
    `[copy-assets] Copied plugins ${PLUGIN_SOURCE} -> ${PLUGIN_DEST}`
  );
} else {
  console.warn(
    `[copy-assets] WARNING: Plugin source not found: ${PLUGIN_SOURCE}`
  );
  console.warn(
    '[copy-assets] Plugins will not be available. Build ptah-extension-vscode first if plugins are needed.'
  );
}

// --- 3. Agent-generation templates ---

const TEMPLATE_SOURCE = path.resolve(
  __dirname,
  '../../../libs/backend/agent-generation/templates'
);
const TEMPLATE_DEST = path.resolve(
  __dirname,
  '../../../dist/apps/ptah-electron/templates'
);

// 3a. Clean old templates directory
if (fs.existsSync(TEMPLATE_DEST)) {
  fs.rmSync(TEMPLATE_DEST, { recursive: true, force: true });
  console.log('[copy-assets] Cleaned old templates directory');
}

// 3b. Copy templates (warn if source missing — templates may not exist during partial builds)
if (fs.existsSync(TEMPLATE_SOURCE)) {
  fs.cpSync(TEMPLATE_SOURCE, TEMPLATE_DEST, { recursive: true });
  console.log(
    `[copy-assets] Copied templates ${TEMPLATE_SOURCE} -> ${TEMPLATE_DEST}`
  );
} else {
  console.warn(
    `[copy-assets] WARNING: Template source not found: ${TEMPLATE_SOURCE}`
  );
  console.warn(
    '[copy-assets] Templates will not be available. Check libs/backend/agent-generation/templates/ exists.'
  );
}

console.log('[copy-assets] Done');
