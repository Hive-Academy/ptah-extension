/**
 * Validate Electron Dependencies
 *
 * Builds the electron main process bundle, then scans the output for
 * external imports that aren't listed in the electron app's package.json.
 *
 * Usage:
 *   node apps/ptah-electron/scripts/validate-deps.js
 *   npx nx validate-deps ptah-electron
 *
 * Run BEFORE publishing to catch missing dependencies that would cause
 * "ERR_MODULE_NOT_FOUND" in the packaged app.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST_MAIN = path.join(ROOT, 'dist', 'apps', 'ptah-electron', 'main.mjs');
const ELECTRON_PKG = path.join(ROOT, 'apps', 'ptah-electron', 'package.json');

// Packages provided by Electron runtime (not needed in package.json)
const RUNTIME_PROVIDED = new Set(['electron']);

// Node.js built-in modules
const NODE_BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
]);

function isBuiltin(specifier) {
  if (specifier.startsWith('node:')) return true;
  const base = specifier.split('/')[0];
  return NODE_BUILTINS.has(base);
}

function isValidPackageName(name) {
  // npm package names: lowercase, may start with @scope/
  return /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(name);
}

function getPackageName(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split('/')[0];
}

function validateNativeDeps() {
  const platform = process.platform; // 'win32' | 'darwin' | 'linux'
  const arch = process.arch; // 'x64' | 'arm64'
  const vecPlatformName =
    platform === 'win32'
      ? `sqlite-vec-windows-${arch === 'x64' ? 'x64' : arch}`
      : `sqlite-vec-${platform}-${arch}`;

  let loadablePath;
  try {
    loadablePath = require('sqlite-vec').getLoadablePath();
  } catch (err) {
    console.error(`\n❌ sqlite-vec.getLoadablePath() failed: ${err.message}`);
    console.error(`   Expected platform package: ${vecPlatformName}`);
    console.error(`   Fix: \`npm install ${vecPlatformName}\` and re-run.\n`);
    process.exit(1);
  }
  if (!fs.existsSync(loadablePath)) {
    console.error(
      `\n❌ sqlite-vec native binary missing on disk: ${loadablePath}`,
    );
    console.error(`   Expected platform package: ${vecPlatformName}`);
    console.error(
      `   electron-builder asarUnpack \`node_modules/sqlite-vec-*/**\` cannot unpack a file that does not exist;`,
    );
    console.error(
      `   the packaged app would crash with "no such table: memories" on first run.\n`,
    );
    process.exit(1);
  }
  console.log(
    `✅ sqlite-vec binary present (${platform}-${arch}): ${path.relative(ROOT, loadablePath)}`,
  );
}

// Step 0: Native runtime preconditions. Must run before any pack/publish.
// Catches the Sentry NODE-NESTJS-46/47 class of bug (missing platform binary
// stays trapped inside app.asar → memory/skills tables never created).
validateNativeDeps();

// Step 1: Ensure the bundle on disk is the PRODUCTION (minified) artifact.
//
// `build-main --configuration=development` (what the e2e harness runs) is NOT
// minified and keeps JSDoc comments; the production build that actually ships IS
// minified. Both write to the same main.mjs, so after an e2e run the dev bundle
// sits on disk. Scanning it makes comment prose like
// `'typescript' from 'typescript-explicit-any'` look like a phantom dependency.
// Only the minified production artifact reflects what ships, so rebuild it when the
// on-disk bundle is missing or unminified. Normal commits already hold the minified
// bundle and skip the rebuild (fast); the rebuild happens once after an e2e run.
function looksUnminified(src) {
  const newlines = (src.match(/\n/g) || []).length;
  const avgLineLength = src.length / (newlines + 1);
  return avgLineLength < 200;
}

if (
  !fs.existsSync(DIST_MAIN) ||
  looksUnminified(fs.readFileSync(DIST_MAIN, 'utf8'))
) {
  console.log(
    'Building production electron main bundle for an accurate dependency scan...',
  );
  execSync('npx nx run ptah-electron:build-main:production --skip-nx-cache', {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

// Step 2: Read the bundle and find external imports
const bundle = fs.readFileSync(DIST_MAIN, 'utf8');

// esbuild emits CommonJS require shims with UNSTABLE minified names when it
// targets ESM output. Their identifier changes every build (historically `Fc`,
// now `ve` / `yD` / `require`), so hardcoding one name silently misses external
// `require()` calls — packages like chokidar, grammy, croner, better-sqlite3
// are loaded this way and were being false-flagged as "unused". Discover the
// shim identifiers from the bundle instead.
function discoverRequireShims(src) {
  const shims = new Set(['require', '__require']);
  const patterns = [
    // Banner / aliased createRequire result: `const X = <alias>(import.meta.url)`
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\(import\.meta\.url\)/g,
    // esbuild __require helper: `var X=(i=>typeof require<"u"?require:...`
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\(\s*[A-Za-z_$][\w$]*\s*=>\s*typeof require/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) shims.add(m[1]);
  }
  return shims;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const requireShims = discoverRequireShims(bundle);

// Match all import/require forms (handles minified code with no spaces):
//   - Static ESM:       from"pkg" / from 'pkg'
//   - Dynamic import:   import("pkg")   (how the in-process SDKs + jsonrepair load)
//   - Bare side-effect: import"pkg"     (e.g. reflect-metadata)
//   - Require shims:    require("pkg") / ve("pkg") / yD("pkg") — names discovered above
const importPatterns = [
  /\bfrom\s*"([^"./][^"]*)"/g,
  /\bfrom\s*'([^'./][^']*)'/g,
  /\bimport\s*\(\s*"([^"./][^"]*)"\s*\)/g,
  /\bimport\s*\(\s*'([^'./][^']*)'\s*\)/g,
  // Bare side-effect import — must NOT be preceded by an identifier char (avoids
  // matching the tail of tokens like `SETTINGS_IMPORT"`) and excludes `import(`.
  /(?<![\w$.])import\s*"([^"(./][^"]*)"/g,
  /(?<![\w$.])import\s*'([^'(./][^']*)'/g,
];
for (const shim of requireShims) {
  const s = escapeRegExp(shim);
  importPatterns.push(
    new RegExp(`(?<![\\w$])${s}\\(\\s*"([^"./][^"]*)"\\s*\\)`, 'g'),
    new RegExp(`(?<![\\w$])${s}\\(\\s*'([^'./][^']*)'\\s*\\)`, 'g'),
  );
}

const externalImports = new Set();
for (const pattern of importPatterns) {
  let match;
  while ((match = pattern.exec(bundle)) !== null) {
    const specifier = match[1];
    if (!isBuiltin(specifier)) {
      const pkgName = getPackageName(specifier);
      if (isValidPackageName(pkgName)) {
        externalImports.add(pkgName);
      }
    }
  }
}

// Step 3: Read electron package.json dependencies
const electronPkg = JSON.parse(fs.readFileSync(ELECTRON_PKG, 'utf8'));
const declaredDeps = new Set(Object.keys(electronPkg.dependencies || {}));

// Step 4: Compare
const missing = [];
const unused = [];

for (const pkg of externalImports) {
  if (RUNTIME_PROVIDED.has(pkg)) continue;
  if (!declaredDeps.has(pkg)) {
    missing.push(pkg);
  }
}

for (const pkg of declaredDeps) {
  if (!externalImports.has(pkg)) {
    unused.push(pkg);
  }
}

// Step 5: Report
console.log('\n=== Electron Dependency Validation ===\n');
console.log(`External imports found in bundle: ${externalImports.size}`);
console.log(`Dependencies in package.json:     ${declaredDeps.size}`);

if (externalImports.size > 0) {
  console.log(`\nDetected external imports:`);
  for (const pkg of [...externalImports].sort()) {
    const status =
      declaredDeps.has(pkg) || RUNTIME_PROVIDED.has(pkg) ? '  ✅' : '  ❌';
    console.log(`${status} ${pkg}`);
  }
}

if (missing.length > 0) {
  console.log(`\n❌ MISSING (will cause ERR_MODULE_NOT_FOUND in production):`);
  for (const pkg of missing.sort()) {
    console.log(`   - ${pkg}`);
  }
}

if (unused.length > 0) {
  console.log(
    `\n⚠️  IN PACKAGE.JSON BUT NOT DETECTED IN BUNDLE (may be loaded via side effects or optional):`,
  );
  for (const pkg of unused.sort()) {
    console.log(`   - ${pkg}`);
  }
}

if (missing.length === 0) {
  console.log(
    '\n✅ All external imports are covered by package.json dependencies.',
  );
}

console.log('');
process.exit(missing.length > 0 ? 1 : 0);
