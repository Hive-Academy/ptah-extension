'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

/** Absolute path to the workspace root (where node_modules lives). */
const ROOT = path.resolve(__dirname, '../../../..');

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
  44: 149,
};

/** Read the electron version from node_modules/electron/package.json */
function getElectronVersion() {
  const epkg = path.join(ROOT, 'node_modules', 'electron', 'package.json');
  if (!fs.existsSync(epkg))
    throw new Error('electron not installed in node_modules');
  return JSON.parse(fs.readFileSync(epkg, 'utf8')).version;
}

/** Detect musl when running on Linux. */
function isLinuxMusl() {
  if (process.platform !== 'linux') return false;
  try {
    return !process.report.getReport().header.glibcVersionRuntime;
  } catch {
    return false;
  }
}

/** Return the platform and architecture used by the prebuild loader. */
function getPrebuildTarget(platform = process.platform, arch = process.arch) {
  const targetPlatform =
    platform === 'linux' && isLinuxMusl() ? 'linuxmusl' : platform;
  return `${targetPlatform}-${arch}`;
}

/**
 * Resolve the binary selected by better-sqlite3's default loader. Version 13+
 * prefers `prebuilds/<platform>-<arch>.node`; older releases fall back to the
 * node-gyp output under build/Release.
 */
function resolveBetterSqliteRuntimeAddon(
  root = ROOT,
  platform = process.platform,
  arch = process.arch,
) {
  const packageRoot = path.join(root, 'node_modules', 'better-sqlite3');
  const prebuild = path.join(
    packageRoot,
    'prebuilds',
    `${getPrebuildTarget(platform, arch)}.node`,
  );
  if (fs.existsSync(prebuild)) return prebuild;
  return path.join(packageRoot, 'build', 'Release', 'better_sqlite3.node');
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

const NATIVE_PROBE_PREFIX = '__PTAH_BETTER_SQLITE3_PROBE__';

/** Load a package/addon pair in Electron and execute a real SQLite query. */
function probeAddonWithElectron(
  packageRoot,
  addonPath,
  electronVersion,
  expectedAbi,
  { requireAbi = true } = {},
) {
  const electronExecutable = require(
    path.join(ROOT, 'node_modules', 'electron'),
  );
  if (!path.isAbsolute(electronExecutable)) {
    throw new Error(
      `Electron executable must be an absolute node_modules path, got ${electronExecutable}`,
    );
  }
  const probe = `
const Database = require(process.argv[1]);
const db = new Database(':memory:', { nativeBinding: process.argv[2] });
try {
  const row = db.prepare('SELECT 42 AS value, sqlite_version() AS sqlite').get();
  process.stdout.write(${JSON.stringify(NATIVE_PROBE_PREFIX)} + JSON.stringify({
    modules: process.versions.modules,
    napi: process.versions.napi,
    value: row.value,
    sqlite: row.sqlite,
  }));
} finally {
  db.close();
}
`;
  const probeArgs = ['-e', probe, packageRoot, addonPath];
  const probeOptions = {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  };
  // S4036: not a PATH lookup. electronExecutable is the absolute path the
  // `electron` package exports, asserted above, so no directory is searched.
  const output = execFileSync(electronExecutable, probeArgs, probeOptions); // NOSONAR
  const marker = output.lastIndexOf(NATIVE_PROBE_PREFIX);
  if (marker < 0) throw new Error('Electron native probe returned no result');
  const result = JSON.parse(output.slice(marker + NATIVE_PROBE_PREFIX.length));
  if (result.value !== 42) {
    throw new Error(
      'Electron native probe returned an unexpected query result',
    );
  }
  if (
    (requireAbi && expectedAbi == null) ||
    (expectedAbi != null && Number(result.modules) !== expectedAbi)
  ) {
    throw new Error(
      `Electron ${electronVersion} reported ABI ${result.modules}, expected ${expectedAbi ?? 'a known ABI'}`,
    );
  }
  return result;
}

module.exports = {
  ROOT,
  ELECTRON_ABI_FALLBACK,
  getElectronVersion,
  getElectronAbi,
  isLinuxMusl,
  getPrebuildTarget,
  resolveBetterSqliteRuntimeAddon,
  NATIVE_PROBE_PREFIX,
  probeAddonWithElectron,
};
