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
const {
  RUNTIME_PROVIDED,
  collectExternalImports,
} = require('./lib/bundle-imports');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST_MAIN = path.join(ROOT, 'dist', 'apps', 'ptah-electron', 'main.mjs');
const ELECTRON_PKG = path.join(ROOT, 'apps', 'ptah-electron', 'package.json');

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

const externalImports = collectExternalImports(bundle);

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
