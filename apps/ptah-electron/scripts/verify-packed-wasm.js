#!/usr/bin/env node
/**
 * verify-packed-wasm.js
 *
 * Post-package gate. Inspects the app.asar that electron-builder actually
 * produced and fails the build unless the tree-sitter WASM assets are present
 * and non-empty inside it.
 *
 * Why this exists: the workspace symbol indexer (and every AST-backed feature)
 * loads `wasm/web-tree-sitter.wasm` + the language grammars from inside the
 * asar via TreeSitterParserService's `locateFile`. web-tree-sitter 0.26+
 * renamed its runtime to `web-tree-sitter.wasm`; if the copy step or an Nx
 * overlapping-output cache restore drops it, the asar ships WITHOUT it. The
 * runtime then aborts AST init on every file, so "Index now" completes with
 * 0 symbols and no visible error — a silent no-op that looks like a stub.
 *
 * Failing loudly here converts that silent ship-then-no-op into a red build,
 * exactly like verify-packed-native.js does for the better-sqlite3 ABI.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../../..');
const RELEASE_DIR = path.join(ROOT, 'dist', 'release');

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

/** Recursively collect every app.asar under dist/release (win/linux/mac layouts). */
function findAsars(dir, found) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findAsars(full, found);
    } else if (entry.name === 'app.asar') {
      found.push(full);
    }
  }
}

/** Normalize asar-internal paths to forward slashes without a leading slash. */
function normalize(p) {
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}

function verifyAsar(asarPath) {
  const rel = path.relative(RELEASE_DIR, asarPath);
  const listed = new Set(asar.listPackage(asarPath).map((p) => normalize(p)));
  const problems = [];
  for (const wasm of REQUIRED_WASM) {
    if (!listed.has(wasm)) {
      problems.push(`${wasm} is missing from the asar`);
      continue;
    }
    let bytes;
    try {
      bytes = asar.extractFile(asarPath, wasm);
    } catch (err) {
      problems.push(
        `${wasm} could not be read: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    const size = bytes.length;
    const expected = VENDORED_WASM.get(wasm);
    if (size === 0) {
      problems.push(`${wasm} is present but empty (0 bytes)`);
    } else if (
      expected !== undefined &&
      (size !== expected.bytes ||
        crypto.createHash('sha256').update(bytes).digest('hex') !==
          expected.sha256)
    ) {
      problems.push(`${wasm} does not match the reviewed vendored grammar`);
    } else {
      console.log(
        `[verify] OK  ${rel} → ${wasm} (${(size / 1024).toFixed(1)} KB)`,
      );
    }
  }
  for (const { entry, sha256 } of REQUIRED_LICENCES) {
    if (!listed.has(entry)) {
      problems.push(`${entry} is missing from the asar`);
      continue;
    }
    let bytes;
    try {
      bytes = asar.extractFile(asarPath, entry);
    } catch (err) {
      problems.push(
        `${entry} could not be read: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (bytes.length === 0) {
      problems.push(`${entry} is present but empty (0 bytes)`);
    } else if (
      crypto.createHash('sha256').update(bytes).digest('hex') !== sha256
    ) {
      problems.push(`${entry} does not match the reviewed licence text`);
    } else {
      console.log(`[verify] OK  ${rel} → ${entry} (licence)`);
    }
  }
  return problems;
}

function main() {
  if (!fs.existsSync(RELEASE_DIR)) {
    throw new Error(`No packaged output found at ${RELEASE_DIR}`);
  }

  const asars = [];
  findAsars(RELEASE_DIR, asars);
  if (asars.length === 0) {
    throw new Error(`No app.asar found under ${RELEASE_DIR}`);
  }

  const failures = [];
  for (const asarPath of asars) {
    const problems = verifyAsar(asarPath);
    for (const p of problems) {
      failures.push(`${path.relative(RELEASE_DIR, asarPath)}: ${p}`);
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n❌ Packed app.asar is missing tree-sitter WASM assets — shipping this ` +
        `makes workspace indexing and every AST feature a silent no-op ` +
        `(AST init aborts on every file, 0 symbols indexed, no error shown):`,
    );
    for (const f of failures) console.error(`   - ${f}`);
    console.error(
      `\n   Fix: ensure \`node scripts/copy-wasm.js dist/apps/ptah-electron\` ` +
        `runs and its output is not clobbered by an Nx cache restore before ` +
        `electron-builder packs dist/apps/ptah-electron.\n`,
    );
    process.exit(1);
  }

  console.log(
    `\n✅ All ${asars.length} packed app.asar archive(s) contain the ` +
      `tree-sitter WASM runtime + grammars.`,
  );
}

async function selfTest() {
  const dir = fs.mkdtempSync(path.join(ROOT, '.wasm-asar-test-'));
  try {
    const fixture = path.join(dir, 'fixture');
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
    let index = 0;
    async function pack() {
      const archive = path.join(dir, `${index++}.asar`);
      await asar.createPackage(fixture, archive);
      return verifyAsar(archive);
    }
    assert.deepEqual(await pack(), []);
    for (const wasm of REQUIRED_WASM) {
      const file = path.join(fixture, wasm);
      fs.unlinkSync(file);
      assert.deepEqual(await pack(), [`${wasm} is missing from the asar`]);
      fs.writeFileSync(file, '');
      assert.deepEqual(await pack(), [
        `${wasm} is present but empty (0 bytes)`,
      ]);
      fs.writeFileSync(file, fixtureBytes(wasm));
    }
    // Same length, first byte flipped: a corrupted vendored grammar fails.
    for (const wasm of VENDORED_WASM.keys()) {
      const file = path.join(fixture, wasm);
      const changed = fixtureBytes(wasm);
      changed[0] ^= 0xff;
      fs.writeFileSync(file, changed);
      assert.deepEqual(await pack(), [
        `${wasm} does not match the reviewed vendored grammar`,
      ]);
      fs.writeFileSync(file, fixtureBytes(wasm));
    }
    for (const { entry } of REQUIRED_LICENCES) {
      const file = path.join(fixture, entry);
      const original = fs.readFileSync(file);
      fs.unlinkSync(file);
      assert.deepEqual(await pack(), [`${entry} is missing from the asar`]);
      fs.writeFileSync(file, Buffer.concat([original, Buffer.from(' ')]));
      assert.deepEqual(await pack(), [
        `${entry} does not match the reviewed licence text`,
      ]);
      fs.writeFileSync(file, original);
    }
    assert.deepEqual(await pack(), []);
  } finally {
    asar.uncacheAll();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    `Electron WASM self-test PASS: complete archive; ${REQUIRED_WASM.length} missing and ${REQUIRED_WASM.length} empty asset negatives; ${VENDORED_WASM.size} changed vendored WASM negatives; ${REQUIRED_LICENCES.length} missing and ${REQUIRED_LICENCES.length} changed licence negatives`,
  );
}

if (require.main === module) {
  if (process.argv[2] === '--self-test') {
    selfTest().catch((error) => {
      // degradation-audit: reported — a failed self-test fails the packaging gate.
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  } else main();
}
