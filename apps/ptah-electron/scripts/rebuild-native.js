#!/usr/bin/env node
/**
 * rebuild-native.js
 *
 * Builds the Electron-ABI-specific better-sqlite3 native binary by compiling
 * it FROM SOURCE against the installed Electron version's headers, using
 * @electron/rebuild. Must run once after `npm install` (or when the Electron
 * version changes) and again immediately before electron-builder packs.
 *
 * Why source compile (not prebuild-install):
 *   better-sqlite3 only publishes prebuilt binaries up to electron-v136
 *   (Electron 37). This app targets Electron 40 (ABI 143), for which NO
 *   prebuilt exists — `prebuild-install --runtime electron --target 40.x`
 *   404s. The only way to obtain a NODE_MODULE_VERSION 143 binary is to
 *   compile it. Shipping the wrong ABI crashes every DB feature on first run
 *   (Sentry 124004638: Memory/Skills/Cron/Gateway/Corpus PERSISTENCE_UNAVAILABLE).
 *
 * Other native deps do NOT need an Electron-specific rebuild:
 *   - sqlite-vec: SQLite loadable extension (.dll/.so/.dylib), not a Node addon.
 *   - node-pty: ships N-API prebuilds (ABI-stable across Node/Electron).
 *
 * Run via:  node apps/ptah-electron/scripts/rebuild-native.js
 * Or:       npm run electron:rebuild
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

/** Absolute path to the workspace root (where node_modules lives). */
const ROOT = path.resolve(__dirname, '../../..');

/** True when invoked by npm's postinstall lifecycle (best-effort, non-fatal). */
const IS_POSTINSTALL = process.env.npm_lifecycle_event === 'postinstall';

// Electron major -> NODE_MODULE_VERSION, from nodejs/node abi_version_registry.json.
// Fallback only — used when node-abi (ESM-only) cannot be dynamically imported.
const ELECTRON_ABI_FALLBACK = {
  30: 123,
  31: 125,
  32: 128,
  33: 130,
  34: 132,
  35: 133,
  36: 135,
  37: 136,
  38: 139,
  39: 140,
  40: 143,
  41: 145,
  42: 146,
  43: 148,
};

/** Read the electron version from node_modules/electron/package.json */
function getElectronVersion() {
  const epkg = path.join(ROOT, 'node_modules', 'electron', 'package.json');
  if (!fs.existsSync(epkg))
    throw new Error('electron not installed in node_modules');
  return JSON.parse(fs.readFileSync(epkg, 'utf8')).version;
}

/**
 * Read the NODE_MODULE_VERSION (ABI) baked into a compiled .node file.
 * Heuristic byte-scan for the `node_register_module_v<NMV>` marker. Returns
 * null when the file/marker is absent — callers must treat null as "unknown",
 * never as "wrong", so a successful compile is never falsely rejected.
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
    const text = fs.readFileSync(candidate).toString('binary');
    const m = text.match(/node_register_module_v(\d+)/);
    if (m) return Number(m[1]);
  } catch {
    /* fall through */
  }
  return null;
}

/** Map an Electron version to its Node ABI (NODE_MODULE_VERSION). */
async function getElectronAbi(electronVersion) {
  try {
    const nodeAbi = await import(
      pathToFileURL(path.join(ROOT, 'node_modules', 'node-abi', 'index.js'))
        .href
    );
    return Number(nodeAbi.getAbi(electronVersion, 'electron'));
  } catch {
    const major = Number(String(electronVersion).split('.')[0]);
    return ELECTRON_ABI_FALLBACK[major] ?? null;
  }
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
    { cwd: ROOT, stdio: 'inherit' },
  );
}

(async () => {
  const electronVersion = getElectronVersion();
  console.log(
    `Rebuilding native modules for Electron ${electronVersion} ` +
      `(${process.platform}/${process.arch})`,
  );

  const expectedAbi = await getElectronAbi(electronVersion);
  const presentAbi = readNativeAbi('better-sqlite3', 'better_sqlite3');

  if (expectedAbi && presentAbi === expectedAbi) {
    console.log(
      `[skip] better-sqlite3 already built for Electron ABI ${expectedAbi}`,
    );
  } else {
    if (presentAbi !== null) {
      console.log(
        `[rebuild] better-sqlite3 has ABI ${presentAbi}, ` +
          `need ${expectedAbi || '?'} — rebuilding from source`,
      );
    }
    electronRebuildFromSource('better-sqlite3', electronVersion);

    // Verify only when we positively read an ABI. A null read means the marker
    // scan could not determine the ABI (not that it is wrong) — trust that
    // electron-rebuild threw on a genuine compile failure.
    const afterAbi = readNativeAbi('better-sqlite3', 'better_sqlite3');
    if (expectedAbi && afterAbi !== null && afterAbi !== expectedAbi) {
      throw new Error(
        `better-sqlite3 ABI is ${afterAbi} after rebuild, expected ${expectedAbi}`,
      );
    }
    console.log(
      `[ok] better-sqlite3 rebuilt for Electron ABI ${afterAbi ?? expectedAbi ?? '(unverified)'}`,
    );
  }

  // sqlite-vec is a SQLite loadable extension (.dll/.so/.dylib), NOT a Node addon.
  // node-pty ships N-API prebuilts and is ABI-stable. Neither needs a rebuild.

  console.log('\n✅ Native module rebuild complete.');
})().catch((err) => {
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
});
