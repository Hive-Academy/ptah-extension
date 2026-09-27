/** Copy the manifest's active WASM assets after esbuild's asset step. */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = 'scripts/tree-sitter-grammars.json';

function containedFile(root, relative) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw new Error('Asset path must be relative and contained');
  }
  const resolved = fs.realpathSync(path.resolve(root, relative));
  const within = path.relative(fs.realpathSync(root), resolved);
  if (within.startsWith('..') || path.isAbsolute(within)) {
    throw new Error('Asset path escapes its source root');
  }
  if (!fs.statSync(resolved).isFile()) throw new Error('Asset must be a file');
  return resolved;
}

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.assets)) {
    throw new Error('Invalid grammar manifest');
  }
  const names = new Set();
  const ids = new Set();
  for (const row of manifest.assets) {
    if (
      !row ||
      typeof row.id !== 'string' ||
      !row.id ||
      ids.has(row.id) ||
      !['runtime', 'grammar'].includes(row.kind) ||
      typeof row.active !== 'boolean' ||
      typeof row.filename !== 'string' ||
      !/^[a-z0-9-]+\.wasm$/.test(row.filename) ||
      names.has(row.filename) ||
      typeof row.licence !== 'string' ||
      !row.licence ||
      !row.source ||
      !['package', 'vendored'].includes(row.source.kind) ||
      typeof row.source.package !== 'string' ||
      !row.source.package ||
      typeof row.source.version !== 'string' ||
      !row.source.version ||
      typeof row.source.path !== 'string' ||
      !row.source.path ||
      typeof row.source.licenceFile !== 'string' ||
      !row.source.licenceFile
    ) {
      throw new Error('Invalid or duplicate grammar manifest row');
    }
    for (const relative of [row.source.path, row.source.licenceFile]) {
      if (
        path.isAbsolute(relative) ||
        relative.includes('\\') ||
        relative
          .split('/')
          .some((part) => !part || part === '..' || part === '.')
      ) {
        throw new Error('Source paths must be relative and contained');
      }
    }
    const pending =
      row.source.kind === 'vendored' && row.source.provenancePending === true;
    if (pending && row.active)
      throw new Error('Pending provenance cannot be active');
    if (!pending && (!Number.isSafeInteger(row.bytes) || row.bytes <= 0)) {
      throw new Error('Asset bytes must be a positive integer');
    }
    if (
      row.source.kind === 'vendored' &&
      !pending &&
      (typeof row.source.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(row.source.sha256))
    ) {
      throw new Error('Vendored asset requires a sha256');
    }
    names.add(row.filename);
    ids.add(row.id);
  }
  const runtimes = manifest.assets.filter((row) => row.kind === 'runtime');
  if (runtimes.length !== 1 || !runtimes[0].active) {
    throw new Error('Exactly one active runtime is required');
  }
  return manifest;
}

function readManifest() {
  const file = containedFile(ROOT, MANIFEST);
  if (fs.statSync(file).size > 128 * 1024)
    throw new Error('Grammar manifest is too large');
  return validateManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function activeWasmFiles() {
  return readManifest()
    .assets.filter((row) => row.active)
    .map((row) => `wasm/${row.filename}`);
}

function resolveWasmFile(row, root = ROOT) {
  const source = row.source;
  let file;
  if (source.kind === 'package') {
    // Node's directory walk-up also works in worktrees without node_modules.
    // Resolve the public WASM subpath: web-tree-sitter hides package.json.
    file = require.resolve(`${source.package}/${source.path}`, {
      paths: [__dirname],
    });
    const packageRoot = path.resolve(
      file,
      ...source.path.split('/').map(() => '..'),
    );
    const metadata = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    );
    if (
      metadata.name !== source.package ||
      metadata.version !== source.version ||
      metadata.license !== row.licence
    ) {
      throw new Error(`Package provenance mismatch: ${row.id}`);
    }
    containedFile(packageRoot, source.licenceFile);
  } else {
    file = containedFile(root, source.path);
    containedFile(root, source.licenceFile);
    const digest = crypto
      .createHash('sha256')
      .update(fs.readFileSync(file))
      .digest('hex');
    if (digest !== source.sha256)
      throw new Error(`Vendored sha256 mismatch: ${row.id}`);
  }
  if (fs.statSync(file).size !== row.bytes)
    throw new Error(`Asset byte size mismatch: ${row.id}`);
  return file;
}

function copyWasm(outputDir, manifest = readManifest(), root = ROOT) {
  validateManifest(manifest);
  // Resolve and verify everything before writing any output.
  const assets = manifest.assets
    .filter((row) => row.active)
    .map((row) => ({ row, file: resolveWasmFile(row, root) }));
  const wasmDest = path.resolve(outputDir, 'wasm');
  fs.mkdirSync(wasmDest, { recursive: true });
  for (const { row, file } of assets) {
    const dest = path.join(wasmDest, row.filename);
    fs.copyFileSync(file, dest);
    if (fs.statSync(dest).size !== row.bytes)
      throw new Error(`Copy verification failed: ${row.id}`);
    console.log(
      `  Copied ${row.filename} (${(row.bytes / 1024).toFixed(1)} KB)`,
    );
  }
  console.log(`WASM assets copied to ${wasmDest}`);
}

function selfTest() {
  const manifest = readManifest();
  const mutate = (change) => {
    const copy = structuredClone(manifest);
    change(copy);
    return copy;
  };
  assert.throws(
    () => validateManifest(mutate((m) => m.assets.push(m.assets[0]))),
    /duplicate/,
  );
  assert.throws(
    () =>
      validateManifest(
        mutate((m) => {
          m.assets[0].active = false;
        }),
      ),
    /runtime/,
  );
  assert.throws(
    () =>
      validateManifest(
        mutate((m) => {
          m.assets[0].filename = '../escape.wasm';
        }),
      ),
    /Invalid/,
  );
  assert.throws(
    () =>
      validateManifest(
        mutate((m) => {
          m.assets[0].bytes = 0;
        }),
      ),
    /bytes/,
  );
  assert.throws(
    () =>
      resolveWasmFile({
        ...manifest.assets[0],
        source: { ...manifest.assets[0].source, version: '0.0.0' },
      }),
    /provenance/,
  );
  assert.throws(
    () => resolveWasmFile({ ...manifest.assets[0], bytes: 1 }),
    /byte size mismatch/,
  );
  const dir = fs.mkdtempSync(path.join(ROOT, '.wasm-copy-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'fixture.wasm'), 'wasm');
    fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT fixture');
    const row = {
      id: 'fixture',
      kind: 'grammar',
      active: true,
      filename: 'tree-sitter-fixture.wasm',
      licence: 'MIT',
      bytes: 4,
      source: {
        kind: 'vendored',
        package: 'fixture',
        version: '1.0.0',
        path: 'fixture.wasm',
        licenceFile: 'LICENSE',
        sha256: crypto.createHash('sha256').update('wasm').digest('hex'),
      },
    };
    const fixtureManifest = { ...manifest, assets: [manifest.assets[0], row] };
    copyWasm(path.join(dir, 'good'), fixtureManifest, dir);
    assert.equal(
      fs.readFileSync(path.join(dir, 'good/wasm', row.filename), 'utf8'),
      'wasm',
    );
    fs.writeFileSync(path.join(dir, 'fixture.wasm'), 'evil');
    assert.throws(
      () => copyWasm(path.join(dir, 'bad'), fixtureManifest, dir),
      /sha256 mismatch/,
    );
    assert.equal(fs.existsSync(path.join(dir, 'bad')), false);
    fs.writeFileSync(path.join(dir, 'fixture.wasm'), 'wasm');
    assert.throws(
      () =>
        resolveWasmFile(
          { ...row, source: { ...row.source, path: '../escape.wasm' } },
          dir,
        ),
      /contained/,
    );
    assert.throws(
      () =>
        resolveWasmFile(
          { ...row, source: { ...row.source, licenceFile: 'missing' } },
          dir,
        ),
      /ENOENT/,
    );
    assert.throws(
      () =>
        validateManifest({
          ...manifest,
          assets: [
            manifest.assets[0],
            { ...row, source: { ...row.source, sha256: null } },
          ],
        }),
      /sha256/,
    );
    assert.throws(
      () =>
        validateManifest({
          ...manifest,
          assets: [
            manifest.assets[0],
            { ...row, source: { ...row.source, provenancePending: true } },
          ],
        }),
      /Pending/,
    );
    copyWasm(path.join(dir, 'active'), manifest);
    assert.deepEqual(
      fs.readdirSync(path.join(dir, 'active/wasm')).sort(),
      manifest.assets
        .filter((asset) => asset.active)
        .map((asset) => asset.filename)
        .sort(),
    );
    // Every package grammar row is active since Batch 31, so the toggle is
    // proved from the other side: an active row is copied, and the same row
    // deactivated is not.
    assert.ok(
      fs.statSync(path.join(dir, 'active/wasm/tree-sitter-php.wasm')).size > 0,
    );
    const deactivated = mutate((m) => {
      m.assets.find((asset) => asset.id === 'php').active = false;
    });
    copyWasm(path.join(dir, 'deactivated'), deactivated);
    assert.equal(
      fs.existsSync(path.join(dir, 'deactivated/wasm/tree-sitter-php.wasm')),
      false,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    'copy-wasm self-test PASS: active-only copying, metadata, size, duplicate/path/provenance negatives, vendored SHA-256 failure before writes',
  );
}

if (require.main === module) {
  if (process.argv[2] === '--self-test') selfTest();
  else if (process.argv[2] === '--list')
    console.log(activeWasmFiles().join('\n'));
  else if (process.argv[2]) copyWasm(process.argv[2]);
  else
    throw new Error(
      'Usage: node scripts/copy-wasm.js <output-dir> | --self-test | --list',
    );
}
