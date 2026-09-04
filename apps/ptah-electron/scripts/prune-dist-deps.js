#!/usr/bin/env node
/**
 * prune-dist-deps.js
 *
 * Build-time gate. `build-main` runs with `generatePackageJson: true`, and Nx
 * builds that manifest from the PROJECT GRAPH -- which includes
 * `implicitDependencies: ["ptah-extension-webview"]`. That edge exists so the
 * electron build cache-busts when the renderer changes (pinned by
 * renderer-cache-key.spec.ts RI-1) and must stay, but it is a BUILD-TIME edge:
 * Nx cannot tell it apart from a runtime one, so every renderer npm package
 * lands in the packaged app's production dependencies.
 *
 * That is wrong twice over:
 *
 *   1. The renderer's packages are already bundled into
 *      dist/apps/ptah-electron/renderer/*.js by the Angular build. Shipping
 *      them again as node_modules is dead weight -- monaco-editor alone is
 *      tens of MB, and `@angular-eslint/eslint-plugin-template` (a LINT
 *      plugin) was being declared a production dependency.
 *
 *   2. It breaks packaging outright. electron-builder walks the dependency
 *      tree from this manifest and validates each package's declared deps
 *      against what is installed. monaco-editor pins `"dompurify": "3.2.7"`
 *      exactly, while the root package.json deliberately overrides it:
 *
 *          "overrides": { "monaco-editor": { "dompurify": "^3.3.2" } }
 *
 *      npm honours that and hoists one dompurify. electron-builder does NOT
 *      read `overrides` -- traversalNodeModulesCollector reads
 *      monaco-editor/package.json directly and calls locatePackageWithVersion
 *      for 3.2.7 -- so it fails with:
 *
 *          production dependency not found  parent=monaco-editor
 *            dependency=dompurify version=3.2.7
 *
 *      Keeping monaco-editor out of the manifest keeps it out of the traversal.
 *
 * The rule: the packaged app's production dependencies are exactly those in the
 * hand-maintained apps/ptah-electron/package.json. That is already the source
 * of truth -- validate-deps.js asserts it covers every external import in
 * main.mjs. This script makes the generated manifest agree with it.
 *
 * Safety gates, both fatal:
 *   - a declared dependency missing from the generated manifest means the
 *     generator changed semantics; pruning would then ship a broken app.
 *   - a candidate for removal that main.mjs actually imports would cause
 *     ERR_MODULE_NOT_FOUND at runtime, so it is never dropped silently.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { collectExternalImports } = require('./lib/bundle-imports');

const ROOT = path.resolve(__dirname, '../../..');
const DIST_DIR = path.join(ROOT, 'dist', 'apps', 'ptah-electron');
const DIST_MANIFEST = path.join(DIST_DIR, 'package.json');
const DIST_LOCKFILE = path.join(DIST_DIR, 'package-lock.json');
const DIST_MAIN = path.join(DIST_DIR, 'main.mjs');
const SOURCE_MANIFEST = path.join(
  ROOT,
  'apps',
  'ptah-electron',
  'package.json',
);

function fail(message) {
  console.error(`[prune-dist-deps] ${message}`);
  process.exit(1);
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(
      `could not read/parse ${label} at ${file}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function main() {
  if (!fs.existsSync(DIST_MANIFEST)) {
    fail(
      `generated manifest missing: ${DIST_MANIFEST}. ` +
        `build-main (generatePackageJson) must run before this script.`,
    );
  }

  const raw = fs.readFileSync(DIST_MANIFEST, 'utf8');
  const generated = readJson(DIST_MANIFEST, 'generated manifest');
  const source = readJson(SOURCE_MANIFEST, 'source manifest');

  const declared = Object.keys(source.dependencies || {});
  const generatedDeps = generated.dependencies || {};

  const missing = declared.filter((name) => !(name in generatedDeps));
  if (missing.length > 0) {
    fail(
      `the generated manifest is missing ${missing.length} dependency/ies ` +
        `declared in apps/ptah-electron/package.json: ${missing.join(', ')}. ` +
        `generatePackageJson changed semantics -- pruning now would ship a ` +
        `broken app. Reconcile the two manifests before building.`,
    );
  }

  const extra = Object.keys(generatedDeps).filter(
    (name) => !declared.includes(name),
  );
  if (extra.length === 0) {
    console.log(
      '[prune-dist-deps] generated manifest already matches ' +
        `apps/ptah-electron/package.json (${declared.length} dependencies).`,
    );
    return;
  }

  if (!fs.existsSync(DIST_MAIN)) {
    fail(`main bundle missing: ${DIST_MAIN}. Cannot verify what it imports.`);
  }
  const bundle = fs.readFileSync(DIST_MAIN, 'utf8');
  const imported = collectExternalImports(bundle);
  const used = extra.filter((name) => imported.has(name));
  if (used.length > 0) {
    fail(
      `refusing to prune ${used.length} package(s) that main.mjs imports: ` +
        `${used.join(', ')}. Removing them would cause ERR_MODULE_NOT_FOUND ` +
        `in the packaged app. Add them to apps/ptah-electron/package.json ` +
        `instead (validate-deps.js enforces the same invariant).`,
    );
  }

  for (const name of extra) delete generatedDeps[name];

  const trailingNewline = raw.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(
    DIST_MANIFEST,
    JSON.stringify(generated, null, 2) + trailingNewline,
  );

  // Keep the generated lockfile's root dependency list in step. electron-builder
  // prefers its npm collector when it can read a lockfile here and only falls
  // back to manual traversal otherwise; leaving the two disagreeing would mean
  // the packaged dependency set depends on which collector wins.
  if (fs.existsSync(DIST_LOCKFILE)) {
    const lockRaw = fs.readFileSync(DIST_LOCKFILE, 'utf8');
    const lock = readJson(DIST_LOCKFILE, 'generated lockfile');
    const rootEntry = (lock.packages || {})[''];
    if (rootEntry && rootEntry.dependencies) {
      for (const name of extra) delete rootEntry.dependencies[name];
      fs.writeFileSync(
        DIST_LOCKFILE,
        JSON.stringify(lock, null, 2) + (lockRaw.endsWith('\n') ? '\n' : ''),
      );
    }
  }

  console.log(
    `[prune-dist-deps] dropped ${extra.length} renderer-only package(s) from ` +
      `the packaged manifest, leaving ${Object.keys(generatedDeps).length}: ` +
      `${extra.sort().join(', ')}.`,
  );
}

main();
