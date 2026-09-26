#!/usr/bin/env node
/**
 * Post-restore-manifest gate: inspect a real npm tarball, including npm's
 * files allowlist, rather than trusting assets in the dist directory.
 * Usage: node apps/ptah-cli/scripts/verify-packed-wasm.cjs [--self-test]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const DIST_DIR = path.join(ROOT, 'dist/apps/ptah-cli');
// Packaging metadata is a JSON file, not a cross-project source import.
const manifestPath = fs.realpathSync(
  path.join(ROOT, 'scripts/tree-sitter-grammars.json'),
);
const manifestRelative = path.relative(fs.realpathSync(ROOT), manifestPath);
if (
  manifestRelative.startsWith('..') ||
  path.isAbsolute(manifestRelative) ||
  fs.statSync(manifestPath).size > 128 * 1024
) {
  throw new Error(
    'Grammar manifest must be bounded and contained in the repository',
  );
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (
  manifest.schemaVersion !== 1 ||
  !Array.isArray(manifest.assets) ||
  !manifest.assets.every(
    (row) =>
      row &&
      typeof row.active === 'boolean' &&
      typeof row.filename === 'string' &&
      /^[a-z0-9-]+\.wasm$/.test(row.filename),
  ) ||
  manifest.assets.filter((row) => row.kind === 'runtime' && row.active)
    .length !== 1 ||
  new Set(manifest.assets.map((row) => row.filename)).size !==
    manifest.assets.length
) {
  throw new Error('Invalid grammar manifest');
}
const REQUIRED_WASM = manifest.assets
  .filter((row) => row.active)
  .map((row) => `wasm/${row.filename}`);

function verifyTarball(tarballPath) {
  // A bare filename avoids MSYS tar treating a Windows drive as a remote host.
  const cwd = path.dirname(tarballPath);
  const name = path.basename(tarballPath);
  const listing = execFileSync('tar', ['-tzf', name], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
  });
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
      problems.push(`${wasm} is missing from the npm tarball`);
      continue;
    }
    let size;
    try {
      size = execFileSync('tar', ['-xzf', name, '-O', entry], {
        cwd,
        maxBuffer: 20 * 1024 * 1024,
        timeout: 60000,
      }).length;
    } catch (error) {
      // degradation-audit: reported — unreadable entries fail the packaging gate.
      problems.push(
        `${wasm} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (size === 0)
      problems.push(`${wasm} is present in the tarball but empty (0 bytes)`);
    else console.log(`[verify] OK  ${wasm} (${(size / 1024).toFixed(1)} KB)`);
  }
  return problems;
}

function main() {
  for (const file of ['main.mjs', 'package.json']) {
    if (!fs.existsSync(path.join(DIST_DIR, file))) {
      throw new Error(
        `Missing CLI build file: ${file}; run nx run ptah-cli:restore-cli-manifest first`,
      );
    }
  }
  // npm is a .cmd wrapper on Windows; only this fixed command uses a shell.
  const packOut = execFileSync('npm pack', {
    cwd: DIST_DIR,
    encoding: 'utf8',
    shell: true,
    timeout: 120000,
  });
  const name = packOut.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!name || path.basename(name) !== name || !name.endsWith('.tgz')) {
    throw new Error('npm pack did not return a tarball filename');
  }
  const tarballPath = path.join(DIST_DIR, name);
  let problems;
  try {
    problems = verifyTarball(tarballPath);
  } finally {
    fs.rmSync(tarballPath, { force: true });
  }
  if (problems.length) {
    throw new Error(
      `Packed CLI WASM verification failed:\n${problems.join('\n')}\nEnsure copy-wasm ran and package.json includes wasm in files.`,
    );
  }
  console.log(
    'Packed npm tarball contains the tree-sitter WASM runtime + active grammars.',
  );
}

function selfTest() {
  const dir = fs.mkdtempSync(path.join(ROOT, '.wasm-tar-test-'));
  try {
    const fixture = path.join(dir, 'package');
    fs.mkdirSync(path.join(fixture, 'wasm'), { recursive: true });
    for (const wasm of REQUIRED_WASM)
      fs.writeFileSync(path.join(fixture, wasm), 'fixture');
    const archive = path.join(dir, 'fixture.tgz');
    function pack() {
      execFileSync('tar', ['-czf', 'fixture.tgz', 'package'], {
        cwd: dir,
        timeout: 60000,
      });
      return verifyTarball(archive);
    }
    assert.deepEqual(pack(), []);
    for (const wasm of REQUIRED_WASM) {
      const file = path.join(fixture, wasm);
      fs.unlinkSync(file);
      assert.deepEqual(pack(), [`${wasm} is missing from the npm tarball`]);
      fs.writeFileSync(file, '');
      assert.deepEqual(pack(), [
        `${wasm} is present in the tarball but empty (0 bytes)`,
      ]);
      fs.writeFileSync(file, 'fixture');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    `CLI WASM self-test PASS: complete tarball; ${REQUIRED_WASM.length} missing and ${REQUIRED_WASM.length} empty asset negatives`,
  );
}

if (require.main === module) {
  if (process.argv[2] === '--self-test') selfTest();
  else main();
}
