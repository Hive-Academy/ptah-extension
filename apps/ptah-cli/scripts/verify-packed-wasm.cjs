#!/usr/bin/env node
/**
 * verify-packed-wasm.js (ptah-cli)
 *
 * Post-restore-manifest gate. Runs a REAL `npm pack` against
 * `dist/apps/ptah-cli` and inspects the resulting `.tgz` to fail the build
 * unless the tree-sitter WASM runtime + grammars are present and non-empty
 * inside it.
 *
 * Why this exists: `TASK_2026_273`. `ptah-cli`/`ptah-tui` register the same
 * AST services as the VS Code extension and Electron, but `copy-wasm.js`
 * used to run only for those two targets, and `apps/ptah-cli/package.json`
 * `files` used to list only the `.mjs` bundles. The dist build could look
 * complete while the published npm tarball still shipped without `wasm/`,
 * silently aborting AST init for every CLI/TUI user. A dist-only check (like
 * "the file exists in dist/") cannot catch that class of bug — the `files`
 * allowlist is applied at `npm pack` time, not at build time. This is the
 * CLI-package sibling of `apps/ptah-electron/scripts/verify-packed-wasm.js`,
 * which guards the Electron asar the same way.
 *
 * Usage: node apps/ptah-cli/scripts/verify-packed-wasm.js
 * Preconditions: `dist/apps/ptah-cli` must already contain a built
 * `main.mjs` and the restored `package.json` (i.e. run after
 * `nx run ptah-cli:restore-cli-manifest`).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST_DIR = path.join(ROOT, 'dist', 'apps', 'ptah-cli');

const REQUIRED_WASM = [
  'wasm/web-tree-sitter.wasm',
  'wasm/tree-sitter-javascript.wasm',
  'wasm/tree-sitter-typescript.wasm',
  'wasm/tree-sitter-python.wasm',
  'wasm/tree-sitter-go.wasm',
  // C# (TASK_2026_270 Batch 1b) — largest grammar by far (~4.9 MB raw); see
  // `scripts/copy-wasm.js` and `workspace-intelligence/src/ast/tree-sitter.config.ts`.
  'wasm/tree-sitter-c-sharp.wasm',
];

function fail(message) {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(DIST_DIR, 'main.mjs'))) {
  fail(
    `No build output at ${path.join(DIST_DIR, 'main.mjs')} — run ` +
      '`nx build ptah-cli` (or `nx run ptah-cli:restore-cli-manifest`) first.',
  );
}
if (!fs.existsSync(path.join(DIST_DIR, 'package.json'))) {
  fail(
    `No package.json at ${DIST_DIR} — run ` +
      '`nx run ptah-cli:restore-cli-manifest` first so `npm pack` reads the ' +
      'real published manifest, not a stale/absent one.',
  );
}

console.log(`[verify-packed-wasm] Packing ${DIST_DIR} with a real \`npm pack\`...`);

// `shell: true` on both calls below: `npm` resolves to `npm.cmd` on Windows,
// which `execFileSync` cannot exec directly without a shell in between.
let tarballName;
try {
  const packOut = execFileSync('npm pack', { cwd: DIST_DIR, encoding: 'utf8', shell: true });
  const lines = packOut.trim().split(/\r?\n/).filter(Boolean);
  tarballName = lines[lines.length - 1].trim();
} catch (err) {
  fail(`\`npm pack\` failed: ${err instanceof Error ? err.message : String(err)}`);
}

const tarballPath = path.join(DIST_DIR, tarballName);
if (!tarballName || !fs.existsSync(tarballPath)) {
  fail(`\`npm pack\` did not produce a tarball at ${tarballPath} (got: "${tarballName}")`);
}
console.log(`[verify-packed-wasm] Tarball: ${tarballPath}`);

function cleanup() {
  try {
    fs.unlinkSync(tarballPath);
  } catch {
    // best-effort cleanup only
  }
}

// Run with `cwd: DIST_DIR` and a bare filename, never the absolute path:
// GNU/MSYS `tar` parses a leading `D:\...` as `host:path` remote-shell
// syntax (the drive-letter colon looks like a host separator), which fails
// with "Cannot connect to D: resolve failed" even though the tarball is
// perfectly valid.
let listing;
try {
  listing = execFileSync('tar', ['-tzf', tarballName], {
    cwd: DIST_DIR,
    encoding: 'utf8',
  });
} catch (err) {
  cleanup();
  fail(`Could not list tarball contents: ${err instanceof Error ? err.message : String(err)}`);
}

console.log('[verify-packed-wasm] Full tarball listing:');
console.log(listing);

const entries = new Set(
  listing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean),
);

const problems = [];
for (const wasm of REQUIRED_WASM) {
  const entry = `package/${wasm}`;
  if (!entries.has(entry)) {
    problems.push(`${wasm} is missing from the npm tarball (looked for "${entry}")`);
    continue;
  }
  let size = 0;
  try {
    // The C# grammar alone is ~5 MB raw; the default 1 MB maxBuffer truncates
    // the stdout capture with ENOBUFS before size can even be checked.
    const buf = execFileSync('tar', ['-xzf', tarballName, '-O', entry], {
      cwd: DIST_DIR,
      maxBuffer: 20 * 1024 * 1024,
    });
    size = buf.length;
  } catch (err) {
    problems.push(
      `${wasm} could not be read from the tarball: ${err instanceof Error ? err.message : String(err)}`,
    );
    continue;
  }
  if (size === 0) {
    problems.push(`${wasm} is present in the tarball but empty (0 bytes)`);
  } else {
    console.log(`[verify] OK  ${wasm} (${(size / 1024).toFixed(1)} KB)`);
  }
}

cleanup();

if (problems.length > 0) {
  console.error(
    '\n❌ Packed npm tarball (@hive-academy/ptah-cli) is missing tree-sitter WASM ' +
      'assets — shipping this makes AST init abort on every file for every CLI/TUI ' +
      'user, silently:',
  );
  for (const problem of problems) console.error(`   - ${problem}`);
  console.error(
    '\n   Fix: ensure `node scripts/copy-wasm.js dist/apps/ptah-cli` ran (the ' +
      '`copy-wasm` nx target, a dependency of `build`) and that `wasm` is listed in ' +
      'apps/ptah-cli/package.json `files`.\n',
  );
  process.exit(1);
}

console.log(
  '\n✅ Packed npm tarball (@hive-academy/ptah-cli) contains the tree-sitter WASM ' +
    'runtime + grammars.',
);
