#!/usr/bin/env node
/**
 * Generate content-manifest.json
 *
 * Walks plugin and template directories, lists all files,
 * computes a SHA-256 content hash, and writes the manifest to the repo root.
 *
 * Usage: node scripts/generate-content-manifest.js
 * Run before each release to update the manifest.
 *
 * TASK_2025_248
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const PLUGINS_BASE_PATH = 'apps/ptah-extension-vscode/assets/plugins';
const TEMPLATES_BASE_PATH = 'libs/backend/agent-generation/templates/agents';
const MANIFEST_PATH = path.join(REPO_ROOT, 'content-manifest.json');

/**
 * Recursively collect all file paths relative to baseDir.
 * Returns sorted array of forward-slash relative paths.
 */
function walkDir(dir, baseDir) {
  const results = [];

  if (!fs.existsSync(dir)) {
    console.warn(`Warning: Directory does not exist: ${dir}`);
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, baseDir));
    } else if (entry.isFile()) {
      // Use forward slashes for cross-platform consistency in the manifest
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      results.push(relativePath);
    }
  }

  return results.sort();
}

function main() {
  const pluginsDir = path.join(REPO_ROOT, PLUGINS_BASE_PATH);
  const templatesDir = path.join(REPO_ROOT, TEMPLATES_BASE_PATH);

  console.log('Scanning plugin directory:', pluginsDir);
  const pluginFiles = walkDir(pluginsDir, pluginsDir);
  console.log(`  Found ${pluginFiles.length} plugin files`);

  console.log('Scanning template directory:', templatesDir);
  const templateFiles = walkDir(templatesDir, templatesDir);
  console.log(`  Found ${templateFiles.length} template files`);

  // Compute a single content hash across all files (both plugins and templates)
  const allFiles = [
    ...pluginFiles.map((f) => ({ rel: f, base: pluginsDir })),
    ...templateFiles.map((f) => ({ rel: f, base: templatesDir })),
  ];
  const hash = crypto.createHash('sha256');
  for (const { rel, base } of allFiles) {
    hash.update(rel);
    hash.update(fs.readFileSync(path.join(base, rel)));
  }
  const contentHash = `sha256:${hash.digest('hex')}`;

  const manifest = {
    $schema: 'https://ptah.live/schemas/content-manifest.json',
    version: '1.0.0',
    contentHash,
    generatedAt: new Date().toISOString(),
    baseUrl:
      'https://raw.githubusercontent.com/Hive-Academy/ptah-extension/main',
    plugins: {
      basePath: PLUGINS_BASE_PATH,
      files: pluginFiles,
    },
    templates: {
      basePath: TEMPLATES_BASE_PATH,
      files: templateFiles,
    },
  };

  fs.writeFileSync(
    MANIFEST_PATH,
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8',
  );
  console.log(`\nManifest written to: ${MANIFEST_PATH}`);
  console.log(`  Content hash: ${contentHash}`);
  console.log(`  Total files: ${pluginFiles.length + templateFiles.length}`);
}

main();
