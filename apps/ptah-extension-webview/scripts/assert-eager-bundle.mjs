#!/usr/bin/env node
/**
 * Eager-bundle guard for the webview app.
 *
 * Reads the built index.html, follows static `import` / `export ... from`
 * statements from its module scripts (the eager closure; dynamic `import()`
 * is deliberately ignored), then:
 *   - prints the gzip size of main.js and of the whole eager closure;
 *   - fails (exit 1) when any eager file contains a git-ui selector/marker.
 *
 * Usage:
 *   node apps/ptah-extension-webview/scripts/assert-eager-bundle.mjs [--report-only] [--dist <dir>]
 *
 * --report-only prints sizes and offenders but always exits 0.
 */
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';

const FORBIDDEN_MARKERS = [
  'ptah-git-',
  'ptah-diff-view',
  'ptah-change-set-card',
  'ptah-review-',
  'ptah-spot-editor',
  'ptah-commit-composer',
  'ptah-task-worktree',
  'ptah-history-timeline',
  'ptah-conflict-banner',
];

const args = process.argv.slice(2);
const reportOnly = args.includes('--report-only');
const distIdx = args.indexOf('--dist');
const distDir = resolve(
  distIdx >= 0 && args[distIdx + 1]
    ? args[distIdx + 1]
    : 'dist/apps/ptah-extension-webview',
);
// Angular's application builder writes to <outputPath>/browser by default.
const root = existsSync(join(distDir, 'browser', 'index.html'))
  ? join(distDir, 'browser')
  : distDir;
const indexPath = join(root, 'index.html');

if (!existsSync(indexPath)) {
  console.error(`[eager-bundle] index.html not found at ${indexPath}. Run the build first.`);
  process.exit(2);
}

const html = readFileSync(indexPath, 'utf8');
const entries = [];
for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
  const tag = m[0];
  if (!/type\s*=\s*["']module["']/i.test(tag)) continue;
  const src = /src\s*=\s*["']([^"']+)["']/i.exec(tag);
  if (src) entries.push(src[1]);
}
if (entries.length === 0) {
  console.error('[eager-bundle] no module scripts found in index.html');
  process.exit(2);
}

// Static imports only: `from"./x.js"` and bare `import"./x.js"`; `import("...")` is dynamic and skipped.
// A `?query` or `#hash` suffix (`./x.js?v=1`) is matched but not captured: the file on disk is `./x.js`.
const STATIC_IMPORT = /(?:\bfrom\s*|\bimport\s*)["']([^"'?#]+\.js)(?:[?#][^"']*)?["']/g;
const stripSuffix = (specifier) => {
  const cut = specifier.search(/[?#]/);
  return cut === -1 ? specifier : specifier.slice(0, cut);
};

const closure = new Map(); // abs path -> source
const queue = entries.map((e) => resolve(root, stripSuffix(e).replace(/^\//, '')));
while (queue.length) {
  const file = queue.pop();
  if (closure.has(file)) continue;
  if (!existsSync(file)) {
    console.error(`[eager-bundle] missing file in closure: ${file}`);
    process.exit(2);
  }
  const src = readFileSync(file, 'utf8');
  closure.set(file, src);
  for (const m of src.matchAll(STATIC_IMPORT)) {
    if (/^[a-z]+:|^\/\//i.test(m[1])) continue; // external URL
    queue.push(resolve(dirname(file), m[1]));
  }
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const gz = (s) => gzipSync(s).length;

let closureRaw = 0;
let closureGz = 0;
let mainGz = null;
let mainRaw = null;
const offenders = [];
for (const [file, src] of closure) {
  const rel = file.slice(root.length + 1).replaceAll('\\', '/');
  const size = gz(src);
  closureRaw += Buffer.byteLength(src);
  closureGz += size;
  if (rel === 'main.js') {
    mainGz = size;
    mainRaw = Buffer.byteLength(src);
  }
  for (const marker of FORBIDDEN_MARKERS) {
    if (src.includes(marker)) offenders.push({ file: rel, marker });
  }
}

console.log(`[eager-bundle] root: ${root}`);
console.log(`[eager-bundle] entries: ${entries.join(', ')}`);
console.log(`[eager-bundle] eager files: ${closure.size}`);
if (mainGz !== null) {
  console.log(`[eager-bundle] main.js: ${mainRaw} B raw, ${mainGz} B gzip (${kb(mainGz)})`);
} else {
  console.log('[eager-bundle] main.js: not in the eager closure');
}
console.log(`[eager-bundle] closure: ${closureRaw} B raw, ${closureGz} B gzip (${kb(closureGz)})`);

if (offenders.length) {
  console.log(`[eager-bundle] ${offenders.length} forbidden marker hit(s) in the eager closure:`);
  for (const o of offenders) console.log(`  - ${o.file}: "${o.marker}"`);
} else {
  console.log('[eager-bundle] no forbidden markers in the eager closure');
}

if (offenders.length && !reportOnly) {
  console.error('[eager-bundle] FAIL: git-ui code is in the eager bundle');
  process.exit(1);
}
if (reportOnly) console.log('[eager-bundle] report-only: exit 0');
