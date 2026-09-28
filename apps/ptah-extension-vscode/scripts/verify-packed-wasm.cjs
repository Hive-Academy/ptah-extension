#!/usr/bin/env node
/** Verify active WASM assets in the VSIX produced by the package target. */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const AdmZip = require('adm-zip');

const ROOT = path.resolve(__dirname, '../../..');
const DIST_DIR = path.join(ROOT, 'dist/apps/ptah-extension-vscode');

function requiredWasmFiles() {
  // Use the existing CLI boundary: --list runs readManifest/validateManifest.
  // A relative source import across Nx projects is intentionally not needed.
  const output = execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts/copy-wasm.js'), '--list'],
    { cwd: ROOT, encoding: 'utf8', timeout: 30000, maxBuffer: 128 * 1024 },
  );
  const files = output.trim().split(/\r?\n/);
  if (
    !files.every((file) => /^wasm\/[a-z0-9-]+\.wasm$/.test(file)) ||
    new Set(files).size !== files.length
  ) {
    throw new Error('Invalid WASM manifest listing');
  }
  return files;
}

/**
 * Every shipped file of a vendored grammar (the WASM and `wasm/LICENSE.<id>`)
 * with its reviewed SHA-256, read through the same CLI boundary as
 * `requiredWasmFiles`. The packed bytes must equal these (Batch 30k r1
 * R30K-01); equal SHA-256 means equal length too.
 */
function requiredVendored() {
  const output = execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts/copy-wasm.js'), '--list-vendored'],
    { cwd: ROOT, encoding: 'utf8', timeout: 30000, maxBuffer: 128 * 1024 },
  ).trim();
  const lines = output === '' ? [] : output.split(/\r?\n/);
  const vendored = lines.map((line) => {
    const match =
      /^(wasm\/(?:[a-z0-9-]+\.wasm|LICENSE\.[a-z0-9-]+)) ([a-f0-9]{64})$/.exec(
        line,
      );
    if (!match) throw new Error('Invalid vendored manifest listing');
    return { file: match[1], sha256: match[2] };
  });
  if (new Set(vendored.map(({ file }) => file)).size !== vendored.length) {
    throw new Error('Invalid vendored manifest listing');
  }
  return vendored;
}

function packagedVsixPath() {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(DIST_DIR, 'package.json'), 'utf8'),
  );
  if (
    typeof metadata.name !== 'string' ||
    typeof metadata.version !== 'string'
  ) {
    throw new Error('Packaged extension manifest needs a name and version');
  }
  // VSCE's default filename uses the packaged manifest, not a stale wildcard hit.
  const filename = `${metadata.name}-${metadata.version}.vsix`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*\.vsix$/.test(filename)) {
    throw new Error('Invalid packaged extension filename');
  }
  return path.join(DIST_DIR, filename);
}

function isLicence(file) {
  return file.startsWith('wasm/LICENSE.');
}

function verifyVsix(vsixPath, required, vendored = []) {
  if (!fs.statSync(vsixPath).isFile()) throw new Error('VSIX must be a file');
  const archive = new AdmZip(vsixPath);
  const entries = archive.getEntries();
  const reviewed = new Map(vendored.map(({ file, sha256 }) => [file, sha256]));
  const problems = [];
  const files = [
    ...required,
    ...vendored
      .map(({ file }) => file)
      .filter((file) => !required.includes(file)),
  ];
  for (const file of files) {
    const name = `extension/${file}`;
    const matches = entries.filter((entry) => entry.entryName === name);
    if (matches.length === 0) {
      problems.push(`${file} is missing from the VSIX`);
      continue;
    }
    if (matches.length !== 1 || matches[0].isDirectory) {
      problems.push(`${file} must be one file in the VSIX`);
      continue;
    }
    const data = matches[0].getData();
    const sha256 = reviewed.get(file);
    if (data.length === 0 && !isLicence(file)) {
      problems.push(`${file} is present in the VSIX but empty (0 bytes)`);
    } else if (
      sha256 !== undefined &&
      crypto.createHash('sha256').update(data).digest('hex') !== sha256
    ) {
      problems.push(
        isLicence(file)
          ? `${file} does not match the reviewed licence text`
          : `${file} does not match the reviewed vendored grammar`,
      );
    }
  }
  return problems;
}

function selfTest(required, vendored) {
  const dir = fs.mkdtempSync(path.join(ROOT, '.wasm-vsix-test-'));
  try {
    const archivePath = path.join(dir, 'fixture.vsix');
    const reviewed = new Set(vendored.map(({ file }) => file));
    // A vendored file must be its committed bytes (the manifest's vendored
    // location); any other asset is a stand-in.
    const bytesOf = (file) =>
      reviewed.has(file)
        ? fs.readFileSync(
            path.join(ROOT, 'assets/tree-sitter', path.posix.basename(file)),
          )
        : Buffer.from('fixture');
    function fixture(omitted, empty, prefix = 'extension/', changed) {
      const archive = new AdmZip();
      const files = [
        ...required,
        ...[...reviewed].filter((file) => !required.includes(file)),
      ];
      for (const file of files) {
        if (file === omitted) continue;
        let data = file === empty ? Buffer.from('') : bytesOf(file);
        if (file === changed) {
          // Same length, first byte flipped.
          data = Buffer.from(data);
          data[0] ^= 0xff;
        }
        archive.addFile(`${prefix}${file}`, data);
      }
      archive.writeZip(archivePath);
    }
    fixture();
    assert.deepEqual(verifyVsix(archivePath, required, vendored), []);
    for (const file of reviewed) {
      fixture(file);
      assert.deepEqual(verifyVsix(archivePath, required, vendored), [
        `${file} is missing from the VSIX`,
      ]);
      fixture(undefined, undefined, 'extension/', file);
      assert.deepEqual(verifyVsix(archivePath, required, vendored), [
        isLicence(file)
          ? `${file} does not match the reviewed licence text`
          : `${file} does not match the reviewed vendored grammar`,
      ]);
    }
    for (const wasm of required) {
      fixture(wasm);
      assert.deepEqual(verifyVsix(archivePath, required), [
        `${wasm} is missing from the VSIX`,
      ]);
      fixture(undefined, wasm);
      assert.deepEqual(verifyVsix(archivePath, required), [
        `${wasm} is present in the VSIX but empty (0 bytes)`,
      ]);
    }
    fixture(undefined, undefined, '');
    assert.equal(verifyVsix(archivePath, required).length, required.length);
    fs.writeFileSync(archivePath, 'not a ZIP archive');
    assert.throws(() => verifyVsix(archivePath, required));
    assert.throws(
      () => verifyVsix(path.join(dir, 'missing.vsix'), required),
      /ENOENT/,
    );

    // Exercise the process exit code used by Nx, not only the internal result.
    fixture(required[0]);
    const failed = spawnSync(process.execPath, [__filename, archivePath], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(failed.status, 1);
    assert.ok(
      failed.stderr.includes(`${required[0]} is missing from the VSIX`),
    );
    fixture();
    const passed = spawnSync(process.execPath, [__filename, archivePath], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(passed.status, 0, passed.stderr);

    const project = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, 'apps/ptah-extension-vscode/project.json'),
        'utf8',
      ),
    );
    const options = project.targets.package.options;
    const commands = options.commands
      ? options.commands.map((entry) => entry.command)
      : [options.command];
    const packIndex = commands.findIndex((command) =>
      command.includes('vsce package'),
    );
    const checkIndex = commands.indexOf(
      'node apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs',
    );
    assert.ok(
      packIndex >= 0 && checkIndex > packIndex,
      'The WASM gate must run after VSCE packaging',
    );
    assert.equal(options.parallel, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    `VSIX WASM self-test PASS: complete ZIP; ${required.length} missing and ${required.length} empty asset negatives; ${vendored.length} missing and ${vendored.length} changed vendored-file negatives; wrong prefix, corrupt/missing archive, CLI exits and package ordering`,
  );
}

if (require.main === module) {
  const required = requiredWasmFiles();
  const vendored = requiredVendored();
  if (process.argv[2] === '--self-test') selfTest(required, vendored);
  else {
    const vsixPath = process.argv[2]
      ? path.resolve(process.argv[2])
      : packagedVsixPath();
    const problems = verifyVsix(vsixPath, required, vendored);
    if (problems.length)
      throw new Error(
        `Packed VSIX WASM verification failed:\n${problems.join('\n')}`,
      );
    console.log(
      `[verify-packed-wasm] PASS ${path.basename(vsixPath)}: ${required.length} active WASM assets present and non-empty; ${vendored.length} vendored files match their reviewed SHA-256; ${fs.statSync(vsixPath).size} archive bytes`,
    );
  }
}
