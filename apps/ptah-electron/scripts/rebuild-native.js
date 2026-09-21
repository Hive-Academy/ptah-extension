#!/usr/bin/env node
/**
 * rebuild-native.js
 *
 * Builds the better-sqlite3 native binary from source against the installed
 * Electron version's headers, then puts that binary at the path the installed
 * better-sqlite3 loader actually uses. Must run once after `npm install` (or
 * when the Electron version changes) and again immediately before
 * electron-builder packs.
 *
 * Why source compile (not prebuild-install):
 *   better-sqlite3 13 switched to N-API 10 platform prebuilds under
 *   `prebuilds/<platform>-<arch>.node`; its loader prefers that path over the
 *   traditional `build/Release` output. `@electron/rebuild` also needs
 *   `npm_config_force_build=1`, otherwise binding.gyp deliberately emits a
 *   no-op target while a platform prebuild exists. We force the source build,
 *   copy its output over the loader-selected prebuild, then load it and run a
 *   real query under Electron 44 (ABI 149). Shipping an untested native binary
 *   crashes every DB feature on first run (Sentry 124004638).
 *
 * Other native deps do NOT need an Electron-specific rebuild:
 *   - sqlite-vec: SQLite loadable extension (.dll/.so/.dylib), not a Node addon.
 *
 * Run via:  node apps/ptah-electron/scripts/rebuild-native.js
 * Or:       npm run electron:rebuild
 */

'use strict';

const { execFileSync } = require('node:child_process');
const path = require('path');
const fs = require('fs');
const {
  ROOT,
  getElectronVersion,
  getElectronAbi,
  getPrebuildTarget,
  resolveBetterSqliteRuntimeAddon,
  probeAddonWithElectron: probeNativeAddonWithElectron,
} = require('./lib/native-addon');

/** True when invoked by npm's postinstall lifecycle (best-effort, non-fatal). */
const IS_POSTINSTALL = process.env.npm_lifecycle_event === 'postinstall';

function getElectronRebuildEnv(environment = process.env) {
  return { ...environment, npm_config_force_build: '1' };
}

/**
 * Compile a native module from source against the target Electron's headers
 * via @electron/rebuild. `--build-from-source` skips the (nonexistent for
 * Electron 40+) prebuilt download and goes straight to node-gyp.
 */
function electronRebuildFromSource(packageName, electronVersion) {
  const cli = path.join(
    ROOT,
    'node_modules',
    '@electron',
    'rebuild',
    'lib',
    'cli.js',
  );
  if (!fs.existsSync(cli)) {
    throw new Error(
      `@electron/rebuild not found at ${cli} — run npm install first`,
    );
  }
  console.log(
    `\n[rebuild] ${packageName} → electron-rebuild from source ` +
      `(Electron ${electronVersion}, ${process.platform}/${process.arch})`,
  );
  execFileSync(
    process.execPath,
    [
      cli,
      '--version',
      electronVersion,
      '--arch',
      process.arch,
      '--only',
      packageName,
      '--force',
      '--build-from-source',
      '--module-dir',
      ROOT,
    ],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: getElectronRebuildEnv(),
    },
  );
}

/**
 * better-sqlite3 13's loader checks prebuilds before build/Release. Promote the
 * forced node-gyp output into that runtime location so packaging cannot retain
 * the original npm prebuild while claiming to ship the source rebuild.
 */
function promoteRebuiltAddon(
  root = ROOT,
  platform = process.platform,
  arch = process.arch,
) {
  const packageRoot = path.join(root, 'node_modules', 'better-sqlite3');
  const builtAddon = path.join(
    packageRoot,
    'build',
    'Release',
    'better_sqlite3.node',
  );
  if (!fs.existsSync(builtAddon)) {
    throw new Error(
      `electron-rebuild completed without producing ${builtAddon}; ` +
        'better-sqlite3 binding.gyp may have skipped its source target',
    );
  }

  const runtimeAddon = resolveBetterSqliteRuntimeAddon(root, platform, arch);
  if (runtimeAddon !== builtAddon) {
    fs.copyFileSync(builtAddon, runtimeAddon);
    console.log(
      `[rebuild] promoted source build to loader path ${path.relative(ROOT, runtimeAddon)}`,
    );
  }
  return runtimeAddon;
}

/** Load the root addon under Electron and log the SQLite probe result. */
function probeAddonWithElectron(addonPath, electronVersion, expectedAbi) {
  const result = probeNativeAddonWithElectron(
    path.join(ROOT, 'node_modules', 'better-sqlite3'),
    addonPath,
    electronVersion,
    expectedAbi,
    { requireAbi: false },
  );
  console.log(
    `[verify] better-sqlite3 loaded under Electron ${electronVersion} ` +
      `(ABI ${result.modules}, N-API ${result.napi}) and queried SQLite ${result.sqlite}`,
  );
  return result;
}

async function main() {
  const electronVersion = getElectronVersion();
  console.log(
    `Rebuilding native modules for Electron ${electronVersion} ` +
      `(${process.platform}/${process.arch})`,
  );

  const expectedAbi = await getElectronAbi(electronVersion);
  electronRebuildFromSource('better-sqlite3', electronVersion);
  const runtimeAddon = promoteRebuiltAddon();
  probeAddonWithElectron(runtimeAddon, electronVersion, expectedAbi);
  console.log(
    `[ok] better-sqlite3 source build is active at ${path.relative(ROOT, runtimeAddon)}`,
  );

  // sqlite-vec is a SQLite loadable extension (.dll/.so/.dylib), NOT a Node
  // addon, so it needs no rebuild.

  console.log('\n✅ Native module rebuild complete.');
}

function handleFailure(err) {
  const message = err instanceof Error ? err.message : String(err);
  if (IS_POSTINSTALL) {
    // Never break `npm install` for contributors without a build toolchain;
    // the explicit pre-pack invocation (npm_lifecycle_event !== postinstall)
    // is the gate that enforces a correct binary before shipping.
    console.warn(
      `[warn] better-sqlite3 Electron rebuild skipped during postinstall: ${message}\n` +
        `       Run \`npm run electron:rebuild\` before \`nx serve ptah-electron\`.`,
    );
    process.exit(0);
  }
  console.error(`[error] rebuild-native failed: ${message}`);
  process.exit(1);
}

if (require.main === module) main().catch(handleFailure);

module.exports = {
  getPrebuildTarget,
  getElectronRebuildEnv,
  resolveBetterSqliteRuntimeAddon,
  promoteRebuiltAddon,
  probeAddonWithElectron,
  main,
};
