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
    if (row.source.kind === 'vendored' && !pending) {
      if (
        typeof row.source.licenceSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(row.source.licenceSha256)
      ) {
        throw new Error('Vendored asset requires a licenceSha256');
      }
      const provenance = row.source.provenanceFile;
      if (
        typeof provenance !== 'string' ||
        !provenance ||
        path.isAbsolute(provenance) ||
        provenance.includes('\\') ||
        provenance
          .split('/')
          .some((part) => !part || part === '..' || part === '.')
      ) {
        throw new Error(
          'Vendored asset requires a relative, contained provenanceFile',
        );
      }
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

/** Where an active vendored row's licence ships, next to its WASM. */
function licenceDestination(row) {
  return `wasm/LICENSE.${row.id}`;
}

/**
 * Every shipped file of an active vendored row with its reviewed SHA-256: the
 * grammar and its licence. A packed archive must hold exactly these bytes
 * (Batch 30k r1 R30K-01).
 */
function activeVendoredFiles() {
  return readManifest()
    .assets.filter((row) => row.active && row.source.kind === 'vendored')
    .flatMap((row) => [
      { file: `wasm/${row.filename}`, sha256: row.source.sha256 },
      { file: licenceDestination(row), sha256: row.source.licenceSha256 },
    ]);
}

const MAX_RECORD_BYTES = 64 * 1024;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** A small repository record, read with a size bound before its bytes. */
function readBoundedFile(file, what, id) {
  if (fs.statSync(file).size > MAX_RECORD_BYTES) {
    throw new Error(`${what} is too large: ${id}`);
  }
  return fs.readFileSync(file);
}

/**
 * The vendored licence must be the exact reviewed text, and the provenance
 * record (data only, never evaluated) must describe the same artefact as the
 * manifest row.
 */
function verifyVendoredRecords(row, root) {
  const source = row.source;
  const licenceFile = containedFile(root, source.licenceFile);
  const licence = readBoundedFile(licenceFile, 'Vendored licence', row.id);
  if (licence.length === 0) {
    throw new Error(`Vendored licence is empty: ${row.id}`);
  }
  if (sha256(licence) !== source.licenceSha256) {
    throw new Error(`Vendored licence sha256 mismatch: ${row.id}`);
  }
  const provenanceFile = containedFile(root, source.provenanceFile);
  const provenance = JSON.parse(
    readBoundedFile(provenanceFile, 'Provenance record', row.id).toString(
      'utf8',
    ),
  );
  if (
    provenance?.package !== source.package ||
    provenance.version !== source.version ||
    provenance.wasm?.sha256 !== source.sha256 ||
    provenance.wasm?.bytes !== row.bytes ||
    provenance.license?.sha256 !== source.licenceSha256
  ) {
    throw new Error(`Provenance record mismatch: ${row.id}`);
  }
  return licenceFile;
}

function resolveWasmFile(row, root = ROOT) {
  return resolveAsset(row, root).file;
}

/** The verified WASM file of a row and, for a vendored row, its licence. */
function resolveAsset(row, root = ROOT) {
  const source = row.source;
  let file;
  let licence;
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
    if (sha256(fs.readFileSync(file)) !== source.sha256)
      throw new Error(`Vendored sha256 mismatch: ${row.id}`);
    licence = verifyVendoredRecords(row, root);
  }
  if (fs.statSync(file).size !== row.bytes)
    throw new Error(`Asset byte size mismatch: ${row.id}`);
  return { file, licence };
}

function copyWasm(outputDir, manifest = readManifest(), root = ROOT) {
  validateManifest(manifest);
  // Resolve and verify everything before writing any output.
  const assets = manifest.assets
    .filter((row) => row.active)
    .map((row) => ({ row, ...resolveAsset(row, root) }));
  const wasmDest = path.resolve(outputDir, 'wasm');
  fs.mkdirSync(wasmDest, { recursive: true });
  for (const { row, file, licence } of assets) {
    const dest = path.join(wasmDest, row.filename);
    fs.copyFileSync(file, dest);
    if (fs.statSync(dest).size !== row.bytes)
      throw new Error(`Copy verification failed: ${row.id}`);
    console.log(
      `  Copied ${row.filename} (${(row.bytes / 1024).toFixed(1)} KB)`,
    );
    if (licence !== undefined) {
      // A vendored grammar ships its licence notice (MIT's condition).
      const licenceDest = path.resolve(outputDir, licenceDestination(row));
      fs.copyFileSync(licence, licenceDest);
      if (sha256(fs.readFileSync(licenceDest)) !== row.source.licenceSha256)
        throw new Error(`Licence copy verification failed: ${row.id}`);
      console.log(`  Copied ${licenceDestination(row)}`);
    }
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
    const LICENCE_TEXT = 'MIT fixture';
    fs.writeFileSync(path.join(dir, 'fixture.wasm'), 'wasm');
    fs.writeFileSync(path.join(dir, 'LICENSE'), LICENCE_TEXT);
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
        sha256: sha256('wasm'),
        licenceSha256: sha256(LICENCE_TEXT),
        provenanceFile: 'PROVENANCE.json',
      },
    };
    const provenance = {
      package: 'fixture',
      version: '1.0.0',
      wasm: { bytes: 4, sha256: sha256('wasm') },
      license: { sha256: sha256(LICENCE_TEXT) },
    };
    const writeProvenance = (value) =>
      fs.writeFileSync(
        path.join(dir, 'PROVENANCE.json'),
        JSON.stringify(value),
      );
    writeProvenance(provenance);
    const fixtureManifest = { ...manifest, assets: [manifest.assets[0], row] };
    copyWasm(path.join(dir, 'good'), fixtureManifest, dir);
    assert.equal(
      fs.readFileSync(path.join(dir, 'good/wasm', row.filename), 'utf8'),
      'wasm',
    );
    assert.equal(
      fs.readFileSync(path.join(dir, 'good/wasm/LICENSE.fixture'), 'utf8'),
      LICENCE_TEXT,
    );
    /** A failing copy writes nothing, whatever the reason. */
    let badRun = 0;
    const assertCopyFails = (pattern, assets = fixtureManifest) => {
      const out = path.join(dir, `bad-${badRun++}`);
      assert.throws(() => copyWasm(out, assets, dir), pattern);
      assert.equal(fs.existsSync(out), false);
    };
    fs.writeFileSync(path.join(dir, 'fixture.wasm'), 'evil');
    assertCopyFails(/sha256 mismatch/);
    fs.writeFileSync(path.join(dir, 'fixture.wasm'), 'wasm');
    // The licence: missing, empty, and changed by one byte.
    fs.unlinkSync(path.join(dir, 'LICENSE'));
    assertCopyFails(/ENOENT/);
    fs.writeFileSync(path.join(dir, 'LICENSE'), '');
    assertCopyFails(/licence is empty/);
    fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT fixturE');
    assertCopyFails(/licence sha256 mismatch/);
    fs.writeFileSync(path.join(dir, 'LICENSE'), LICENCE_TEXT);
    // The provenance record: missing, and describing another artefact.
    fs.unlinkSync(path.join(dir, 'PROVENANCE.json'));
    assertCopyFails(/ENOENT/);
    writeProvenance({
      ...provenance,
      wasm: { ...provenance.wasm, sha256: sha256('evil') },
    });
    assertCopyFails(/Provenance record mismatch/);
    writeProvenance({
      ...provenance,
      license: { sha256: sha256('another licence') },
    });
    assertCopyFails(/Provenance record mismatch/);
    writeProvenance(provenance);
    const withSource = (change) => ({
      ...fixtureManifest,
      assets: [
        manifest.assets[0],
        { ...row, source: { ...row.source, ...change } },
      ],
    });
    assertCopyFails(/licenceSha256/, withSource({ licenceSha256: undefined }));
    assertCopyFails(
      /provenanceFile/,
      withSource({ provenanceFile: '../PROVENANCE.json' }),
    );
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
      fs
        .readdirSync(path.join(dir, 'active/wasm'))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      [
        ...manifest.assets
          .filter((asset) => asset.active)
          .map((asset) => asset.filename),
        ...activeVendoredFiles()
          .map(({ file }) => path.posix.basename(file))
          .filter((file) => file.startsWith('LICENSE.')),
      ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    // The vendored Kotlin grammar ships with its reviewed licence notice.
    const kotlin = manifest.assets.find((asset) => asset.id === 'kotlin');
    assert.deepEqual(
      activeVendoredFiles().filter(({ file }) => file.includes('kotlin')),
      [
        { file: 'wasm/tree-sitter-kotlin.wasm', sha256: kotlin.source.sha256 },
        { file: 'wasm/LICENSE.kotlin', sha256: kotlin.source.licenceSha256 },
      ],
    );
    assert.equal(
      sha256(fs.readFileSync(path.join(dir, 'active/wasm/LICENSE.kotlin'))),
      manifest.assets.find((asset) => asset.id === 'kotlin').source
        .licenceSha256,
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
    'copy-wasm self-test PASS: active-only copying, metadata, size, duplicate/path/provenance negatives; vendored WASM, licence (missing/empty/changed/unhashed) and provenance-record (missing/mismatched) failures before writes; licence copied as wasm/LICENSE.<id>',
  );
}

if (require.main === module) {
  if (process.argv[2] === '--self-test') selfTest();
  else if (process.argv[2] === '--list')
    console.log(activeWasmFiles().join('\n'));
  else if (process.argv[2] === '--list-vendored')
    // One `<path> <sha256>` line per shipped vendored file (VSIX gate).
    console.log(
      activeVendoredFiles()
        .map(({ file, sha256: digest }) => `${file} ${digest}`)
        .join('\n'),
    );
  else if (process.argv[2]) copyWasm(process.argv[2]);
  else
    throw new Error(
      'Usage: node scripts/copy-wasm.js <output-dir> | --self-test | --list | --list-vendored',
    );
}
