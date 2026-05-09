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
 * Read the NODE_MODULE_VERSION (ABI) baked into a compiled .node file.
 * Returns null if the file doesn't exist, can't be read, or the marker
 * isn't found. The .node file is a regular shared library; the embedded
 * `NODE_MODULE_VERSION` field of `node::node_module` is searchable as the
 * ASCII string `NODE_MODULE_VERSION` followed by the version number.
 *
 * This is heuristic but reliable for better-sqlite3's prebuilt binaries —
 * it lets us distinguish a Node-ABI build (e.g. NMV 137) from an
 * Electron-ABI build (e.g. NMV 143) without loading the binary.
 */
function readNativeAbi(packageName, addonName) {
  const candidate = path.join(
    ROOT,
    'node_modules',
    packageName,
    'build',
    'Release',
    `${addonName}.node`,
  );
  if (!fs.existsSync(candidate)) return null;
  try {
    const buf = fs.readFileSync(candidate);
    // Search for the version registration callsite. Different toolchains
    // emit the NMV either as an immediate in code or via an exported symbol
    // matching `node_register_module_v<NMV>`. The export form is the most
    // reliable cross-platform marker.
    const text = buf.toString('binary');
    const m = text.match(/node_register_module_v(\d+)/);
    if (m) return Number(m[1]);
  } catch {
    /* fall through */
  }
  return null;
}

/** Map an Electron version to its Node ABI (NODE_MODULE_VERSION). */
function getElectronAbi(electronVersion) {
  try {
    const abi = require(path.join(ROOT, 'node_modules', 'node-abi')).getAbi(
      electronVersion,
      'electron',
    );
    return Number(abi);
  } catch {
    return null;
  }
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
//
// We MUST verify the existing .node was built for Electron's ABI, not just
// that some .node file exists — npm install's lifecycle script builds
// better-sqlite3 against the system Node ABI, which is almost always wrong
// for Electron. Skipping by file-existence alone leaves the wrong binary
// in place forever and produces NODE_MODULE_VERSION mismatch errors at
// runtime.
const expectedAbi = getElectronAbi(electronVersion);
const presentAbi = readNativeAbi('better-sqlite3', 'better_sqlite3');
if (expectedAbi && presentAbi === expectedAbi) {
  console.log(
    `[skip] better-sqlite3 already built for Electron ABI ${expectedAbi}`,
  );
} else {
  if (presentAbi !== null) {
    console.log(
      `[rebuild] better-sqlite3 has ABI ${presentAbi}, need ${expectedAbi || '?'} — replacing`,
    );
  }
  prebuildInstall('better-sqlite3', electronVersion, true);
}

// sqlite-vec is a SQLite loadable extension (.dll/.so/.dylib), NOT a Node addon.
// It ships via sqlite-vec-windows-x64 / platform packages and requires no rebuild.

// node-pty ships N-API prebuilts in prebuilds/<platform>-<arch>/pty.node
// and is ABI-stable across Node/Electron versions — no rebuild needed.

console.log('\n✅ Native module rebuild complete.');
