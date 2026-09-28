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
const crypto = require('crypto');
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
/**
 * A vendored grammar is not re-checked against an installed package at pack
 * time, so its packed bytes must equal the reviewed artefact: the manifest's
 * SHA-256 and byte count (Batch 30k r1 R30K-01).
 */
const VENDORED_WASM = new Map(
  manifest.assets
    .filter((row) => row.active && row.source?.kind === 'vendored')
    .map((row) => {
      if (
        !/^[a-f0-9]{64}$/.test(row.source.sha256 ?? '') ||
        !Number.isSafeInteger(row.bytes) ||
        row.bytes <= 0
      ) {
        throw new Error('Invalid grammar manifest');
      }
      return [
        `wasm/${row.filename}`,
        { sha256: row.source.sha256, bytes: row.bytes, path: row.source.path },
      ];
    }),
);
/**
 * A vendored grammar ships its licence notice as `wasm/LICENSE.<id>`
 * (`scripts/copy-wasm.js`), byte-identical to the reviewed text.
 */
const REQUIRED_LICENCES = manifest.assets
  .filter((row) => row.active && row.source?.kind === 'vendored')
  .map((row) => {
    if (
      !/^[a-z0-9-]+$/.test(row.id) ||
      !/^[a-f0-9]{64}$/.test(row.source.licenceSha256 ?? '')
    ) {
      throw new Error('Invalid grammar manifest');
    }
    return {
      entry: `wasm/LICENSE.${row.id}`,
      sha256: row.source.licenceSha256,
    };
  });

function extractEntry(cwd, name, entry) {
  const options = { cwd, maxBuffer: 20 * 1024 * 1024, timeout: 60000 };
  return execFileSync('tar', ['-xzf', name, '-O', entry], options); // NOSONAR - local build script: PATH lookup is required (MSYS tar on Windows); name/entry are internal, never user input
}

function verifyTarball(tarballPath) {
  // A bare filename avoids MSYS tar treating a Windows drive as a remote host.
  const cwd = path.dirname(tarballPath);
  const name = path.basename(tarballPath);
  const options = { cwd, encoding: 'utf8', timeout: 60000 };
  const listing = execFileSync('tar', ['-tzf', name], options); // NOSONAR - local build script: PATH lookup is required (MSYS tar on Windows); name is the internal tarball filename
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
    let bytes;
    try {
      bytes = extractEntry(cwd, name, entry);
    } catch (error) {
      // degradation-audit: reported — unreadable entries fail the packaging gate.
      problems.push(
        `${wasm} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const size = bytes.length;
    const expected = VENDORED_WASM.get(wasm);
    if (size === 0)
      problems.push(`${wasm} is present in the tarball but empty (0 bytes)`);
    else if (
      expected !== undefined &&
      (size !== expected.bytes ||
        crypto.createHash('sha256').update(bytes).digest('hex') !==
          expected.sha256)
    )
      problems.push(`${wasm} does not match the reviewed vendored grammar`);
    else console.log(`[verify] OK  ${wasm} (${(size / 1024).toFixed(1)} KB)`);
  }
  for (const { entry: licence, sha256 } of REQUIRED_LICENCES) {
    const entry = `package/${licence}`;
    if (!entries.has(entry)) {
      problems.push(`${licence} is missing from the npm tarball`);
      continue;
    }
    let bytes;
    try {
      bytes = extractEntry(cwd, name, entry);
    } catch (error) {
      // degradation-audit: reported — unreadable entries fail the packaging gate.
      problems.push(
        `${licence} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (bytes.length === 0)
      problems.push(`${licence} is present in the tarball but empty (0 bytes)`);
    else if (crypto.createHash('sha256').update(bytes).digest('hex') !== sha256)
      problems.push(`${licence} does not match the reviewed licence text`);
    else console.log(`[verify] OK  ${licence} (licence)`);
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
  const packOptions = {
    cwd: DIST_DIR,
    encoding: 'utf8',
    shell: true,
    timeout: 120000,
  };
  const packOut = execFileSync('npm pack', packOptions); // NOSONAR - local build script: npm is a .cmd wrapper on Windows, so a fixed command via shell is the only portable form
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
    'Packed npm tarball contains the tree-sitter WASM runtime + active grammars + vendored grammar licences.',
  );
}

function selfTest() {
  const dir = fs.mkdtempSync(path.join(ROOT, '.wasm-tar-test-'));
  try {
    const fixture = path.join(dir, 'package');
    fs.mkdirSync(path.join(fixture, 'wasm'), { recursive: true });
    // A vendored grammar must be its reviewed bytes; any other asset is a stand-in.
    const fixtureBytes = (wasm) =>
      VENDORED_WASM.has(wasm)
        ? fs.readFileSync(path.join(ROOT, VENDORED_WASM.get(wasm).path))
        : Buffer.from('fixture');
    for (const wasm of REQUIRED_WASM)
      fs.writeFileSync(path.join(fixture, wasm), fixtureBytes(wasm));
    const vendoredLicence = (entry) =>
      fs.readFileSync(
        path.join(
          ROOT,
          manifest.assets.find((row) => `wasm/LICENSE.${row.id}` === entry)
            .source.licenceFile,
        ),
      );
    for (const { entry } of REQUIRED_LICENCES)
      fs.writeFileSync(path.join(fixture, entry), vendoredLicence(entry));
    const archive = path.join(dir, 'fixture.tgz');
    function pack() {
      const options = { cwd: dir, timeout: 60000 };
      execFileSync('tar', ['-czf', 'fixture.tgz', 'package'], options); // NOSONAR - local build script: PATH lookup is required (MSYS tar on Windows); arguments are fixed literals
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
      fs.writeFileSync(file, fixtureBytes(wasm));
    }
    // Same length, first byte flipped: a corrupted vendored grammar fails.
    for (const wasm of VENDORED_WASM.keys()) {
      const file = path.join(fixture, wasm);
      const changed = fixtureBytes(wasm);
      changed[0] ^= 0xff;
      fs.writeFileSync(file, changed);
      assert.deepEqual(pack(), [
        `${wasm} does not match the reviewed vendored grammar`,
      ]);
      fs.writeFileSync(file, fixtureBytes(wasm));
    }
    for (const { entry } of REQUIRED_LICENCES) {
      const file = path.join(fixture, entry);
      const original = fs.readFileSync(file);
      fs.unlinkSync(file);
      assert.deepEqual(pack(), [`${entry} is missing from the npm tarball`]);
      fs.writeFileSync(file, Buffer.concat([original, Buffer.from(' ')]));
      assert.deepEqual(pack(), [
        `${entry} does not match the reviewed licence text`,
      ]);
      fs.writeFileSync(file, original);
    }
    assert.deepEqual(pack(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    `CLI WASM self-test PASS: complete tarball; ${REQUIRED_WASM.length} missing and ${REQUIRED_WASM.length} empty asset negatives; ${VENDORED_WASM.size} changed vendored WASM negatives; ${REQUIRED_LICENCES.length} missing and ${REQUIRED_LICENCES.length} changed licence negatives`,
  );
}

if (require.main === module) {
  if (process.argv[2] === '--self-test') selfTest();
  else main();
}
