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

/**
 * Compute SHA-256 content hash from all file paths and their contents.
 * The hash is deterministic: sorted file paths, each path + content fed into the hash.
 */
function computeContentHash(files, baseDir) {
  const hash = crypto.createHash('sha256');

  for (const file of files) {
    const fullPath = path.join(baseDir, file);
    // Include the relative path in the hash so renames are detected
    hash.update(file);
    // Include the file content
    const content = fs.readFileSync(fullPath);
    hash.update(content);
  }

  return hash.digest('hex');
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

  // Compute a single content hash across all files
  const combinedHash = crypto.createHash('sha256');

  // Feed plugin files into hash
  for (const file of pluginFiles) {
    const fullPath = path.join(pluginsDir, file);
    combinedHash.update(file);
    combinedHash.update(fs.readFileSync(fullPath));
  }

  // Feed template files into hash
  for (const file of templateFiles) {
    const fullPath = path.join(templatesDir, file);
    combinedHash.update(file);
    combinedHash.update(fs.readFileSync(fullPath));
  }

  const contentHash = `sha256:${combinedHash.digest('hex')}`;

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
