/**
 * bundle-imports.js
 *
 * One definition of "which npm packages does the electron main bundle actually
 * import". Extracted from validate-deps.js so prune-dist-deps.js can gate on
 * the same answer -- two scanners that disagree would let a package the bundle
 * needs be pruned from the packaged manifest, which is exactly the failure the
 * pruner exists to prevent.
 *
 * The bundle is minified ESM with esbuild's CommonJS require shims, so the
 * specifier forms are matched explicitly rather than by parsing. A bare quoted
 * string is NOT enough on its own: the bundle contains framework-detection
 * lookups like `deps["@angular/core"] ? "angular" : ...` that read a scanned
 * workspace's package.json and must not read as imports.
 */

'use strict';

// Packages provided by the Electron runtime (never declared as dependencies).
const RUNTIME_PROVIDED = new Set(['electron']);

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

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * esbuild emits CommonJS require shims with UNSTABLE minified names when it
 * targets ESM output. Their identifier changes every build (historically `Fc`,
 * now `ve` / `yD` / `require`), so hardcoding one name silently misses external
 * `require()` calls -- packages like chokidar, grammy, croner, better-sqlite3
 * are loaded this way and were being false-flagged as "unused". Discover the
 * shim identifiers from the bundle instead.
 */
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

/**
 * Every bare package name the bundle imports, as a Set. Node builtins are
 * excluded; `electron` is included (callers filter it via RUNTIME_PROVIDED).
 */
function collectExternalImports(bundle) {
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
  return externalImports;
}

module.exports = {
  RUNTIME_PROVIDED,
  NODE_BUILTINS,
  isBuiltin,
  isValidPackageName,
  getPackageName,
  discoverRequireShims,
  collectExternalImports,
};
