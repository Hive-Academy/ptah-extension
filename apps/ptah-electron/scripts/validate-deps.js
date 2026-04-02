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

// Step 1: Build if needed
if (!fs.existsSync(DIST_MAIN)) {
  console.log('Building electron main process...');
  execSync('npx nx build-main ptah-electron', { cwd: ROOT, stdio: 'inherit' });
}

// Step 2: Read the bundle and find external imports
const bundle = fs.readFileSync(DIST_MAIN, 'utf8');

// Match all import patterns (handles minified code with no spaces):
//   - Static ESM: from"package" or from "package"
//   - Dynamic import: import("package")
//   - Dynamic require via wrapper: Fc("package")
const importPatterns = [
  /\bfrom\s*"([^"./][^"]*)"/g,
  /\bfrom\s*'([^'./][^']*)'/g,
  /\bimport\s*\(\s*"([^"./][^"]*)"\s*\)/g,
  /\bimport\s*\(\s*'([^'./][^']*)'\s*\)/g,
  /\bFc\(\s*"([^"./][^"]*)"\s*\)/g,
  /\bFc\(\s*'([^'./][^']*)'\s*\)/g,
];

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
