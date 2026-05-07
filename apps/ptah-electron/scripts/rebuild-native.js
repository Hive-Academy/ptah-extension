#!/usr/bin/env node
/**
 * rebuild-native.js
 *
 * Downloads the Electron-ABI-specific prebuilt binary for better-sqlite3
 * using prebuild-install. Must be run once after `npm install` (or when
 * the Electron version changes) before `npm run electron:serve`.
 *
 * Other native deps do NOT need Electron-specific rebuilding:
 *  - sqlite-vec: SQLite loadable extension (.dll/.so/.dylib), not a Node addon.
 *    Ships via sqlite-vec-<platform> packages at npm install time.
 *  - node-pty: ships N-API prebuilts (ABI-stable across Node/Electron).
 *
 * Run via:  node apps/ptah-electron/scripts/rebuild-native.js
 * Or:       npm run electron:rebuild
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Absolute path to the workspace root (where node_modules lives). */
const ROOT = path.resolve(__dirname, '../../..');

/** Read the electron version from node_modules/electron/package.json */
function getElectronVersion() {
  const epkg = path.join(ROOT, 'node_modules', 'electron', 'package.json');
  if (!fs.existsSync(epkg))
    throw new Error('electron not installed in node_modules');
  return JSON.parse(fs.readFileSync(epkg, 'utf8')).version;
}

/**
 * Check if a native .node binary already exists in build/Release/.
 * Used to skip re-downloading prebuilts that are already present.
 */
function nativeBinaryExists(packageName, addonName) {
  const candidate = path.join(
    ROOT,
    'node_modules',
    packageName,
    'build',
    'Release',
    `${addonName}.node`,
  );
  return fs.existsSync(candidate);
}

/** Run prebuild-install to download a prebuilt Electron binary for a package.
 * @param {boolean} required - if false, failure is a warning (not fatal). */
function prebuildInstall(packageName, electronVersion, required = true) {
  const pkgDir = path.join(ROOT, 'node_modules', packageName);
  if (!fs.existsSync(pkgDir)) {
    console.log(`[skip] ${packageName} not found in node_modules`);
    return;
  }

  // prebuild-install lives in the root node_modules (hoisted by npm)
  const prebuildBin = path.join(
    ROOT,
    'node_modules',
    'prebuild-install',
    'bin.js',
  );
  if (!fs.existsSync(prebuildBin)) {
    console.warn(
      `[warn] prebuild-install not found at ${prebuildBin}, skipping ${packageName}`,
    );
    return;
  }

  console.log(
    `\n[rebuild] ${packageName} → prebuild-install (Electron ${electronVersion})`,
  );
  try {
    execFileSync(
      process.execPath,
      [
        prebuildBin,
        '--runtime',
        'electron',
        '--target',
        electronVersion,
        '--arch',
        process.arch,
        '--dist-url',
        'https://electronjs.org/headers',
      ],
      { cwd: pkgDir, stdio: 'inherit' },
    );
    console.log(`[ok] ${packageName} rebuilt successfully`);
    return true;
  } catch (err) {
    if (required) {
      console.error(
        `[error] Failed to rebuild ${packageName} via prebuild-install`,
      );
      console.error(err.message);
      process.exit(1);
    } else {
      console.warn(
        `[warn] ${packageName} prebuild failed (optional, skipping): ${err.message}`,
      );
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const electronVersion = getElectronVersion();
console.log(
  `Rebuilding native modules for Electron ${electronVersion} (${process.platform}/${process.arch})`,
);

// --- Strategy 1: prebuild-install (no compiler needed) ---
// better-sqlite3: REQUIRED for SQLite features (Memory, Cron, Gateway, Skills)
if (nativeBinaryExists('better-sqlite3', 'better_sqlite3')) {
  console.log('[skip] better-sqlite3 native binary already present');
} else {
  prebuildInstall('better-sqlite3', electronVersion, true);
}

// sqlite-vec is a SQLite loadable extension (.dll/.so/.dylib), NOT a Node addon.
// It ships via sqlite-vec-windows-x64 / platform packages and requires no rebuild.

// node-pty ships N-API prebuilts in prebuilds/<platform>-<arch>/pty.node
// and is ABI-stable across Node/Electron versions — no rebuild needed.

console.log('\n✅ Native module rebuild complete.');
