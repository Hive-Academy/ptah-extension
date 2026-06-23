#!/usr/bin/env node
/**
 * verify-packed-native.js
 *
 * Post-package gate. Inspects the better-sqlite3 binary that electron-builder
 * actually placed inside the packaged app (dist/release/<platform>-unpacked or
 * <ProductName>.app) and fails the build unless it is the Electron-ABI binary.
 *
 * Two independent checks (passing EITHER is sufficient):
 *   1. sha256 of the packed binary == sha256 of the root node_modules binary
 *      (which the pre-pack rebuild-native step compiled for the Electron ABI).
 *      This is reader-independent and also proves electron-builder packed from
 *      the rebuilt root node_modules rather than a stale fresh install.
 *   2. The NODE_MODULE_VERSION marker in the packed binary == the Electron ABI.
 *
 * Failing loudly here is the safety net behind Sentry 124004638 — it converts
 * a silent "ships, then crashes every DB feature on first run" into a red CI.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '../../..');
const RELEASE_DIR = path.join(ROOT, 'dist', 'release');
const ADDON_SUFFIX = path.join(
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node',
);

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

function getElectronVersion() {
  const epkg = path.join(ROOT, 'node_modules', 'electron', 'package.json');
  return JSON.parse(fs.readFileSync(epkg, 'utf8')).version;
}

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

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function readNativeAbi(file) {
  try {
    const text = fs.readFileSync(file).toString('binary');
    const m = text.match(/node_register_module_v(\d+)/);
    if (m) return Number(m[1]);
  } catch {
    /* fall through */
  }
  return null;
}

/** Recursively collect packed better_sqlite3.node files under dist/release. */
function findPackedAddons(dir, found) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findPackedAddons(full, found);
    } else if (
      full.includes(`app.asar.unpacked${path.sep}node_modules${path.sep}`) &&
      full.endsWith(ADDON_SUFFIX)
    ) {
      found.push(full);
    }
  }
}

(async () => {
  const electronVersion = getElectronVersion();
  const expectedAbi = await getElectronAbi(electronVersion);

  const rootAddon = path.join(ROOT, 'node_modules', ADDON_SUFFIX);
  if (!fs.existsSync(rootAddon)) {
    throw new Error(
      `Reference binary missing: ${rootAddon}. Run rebuild-native before packaging.`,
    );
  }
  const rootHash = sha256(rootAddon);
  const rootAbi = readNativeAbi(rootAddon);
  console.log(
    `[verify] Electron ${electronVersion} (ABI ${expectedAbi ?? '?'}); ` +
      `root better-sqlite3 ABI ${rootAbi ?? 'unknown'} sha256 ${rootHash.slice(0, 12)}`,
  );

  if (!fs.existsSync(RELEASE_DIR)) {
    throw new Error(`No packaged output found at ${RELEASE_DIR}`);
  }

  const packed = [];
  findPackedAddons(RELEASE_DIR, packed);
  if (packed.length === 0) {
    throw new Error(
      `No packed better_sqlite3.node found under ${RELEASE_DIR}. ` +
        `The binary may be trapped inside app.asar (asarUnpack not applied) — ` +
        `it would crash on first DB access.`,
    );
  }

  const failures = [];
  for (const file of packed) {
    const rel = path.relative(RELEASE_DIR, file);
    const hash = sha256(file);
    const abi = readNativeAbi(file);
    const hashMatch = hash === rootHash;
    const abiMatch = expectedAbi != null && abi === expectedAbi;

    if (hashMatch || abiMatch) {
      console.log(
        `[verify] OK  ${rel} (ABI ${abi ?? '?'}, ` +
          `${hashMatch ? 'matches rebuilt binary' : 'ABI matches Electron'})`,
      );
    } else {
      failures.push(
        `${rel}: packed ABI ${abi ?? 'unknown'} / sha256 ${hash.slice(0, 12)} ` +
          `does NOT match Electron ABI ${expectedAbi ?? '?'} nor the rebuilt ` +
          `binary (${rootHash.slice(0, 12)}).`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n❌ Packed better-sqlite3 has the WRONG ABI — shipping this crashes ` +
        `all DB features (Memory/Skills/Cron/Gateway/Corpus) on first run:`,
    );
    for (const f of failures) console.error(`   - ${f}`);
    console.error(
      `\n   Fix: ensure \`node apps/ptah-electron/scripts/rebuild-native.js\` ` +
        `runs (electron-rebuild --build-from-source) immediately before electron-builder.\n`,
    );
    process.exit(1);
  }

  console.log(
    `\n✅ All ${packed.length} packed better-sqlite3 binar${packed.length === 1 ? 'y' : 'ies'} carry the Electron ${expectedAbi ?? ''} ABI.`,
  );
})().catch((err) => {
  console.error(
    `[error] verify-packed-native failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
