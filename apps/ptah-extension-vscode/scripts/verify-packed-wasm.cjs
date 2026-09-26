#!/usr/bin/env node
/** Verify active WASM assets in the VSIX produced by the package target. */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
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

function verifyVsix(vsixPath, required) {
  if (!fs.statSync(vsixPath).isFile()) throw new Error('VSIX must be a file');
  const archive = new AdmZip(vsixPath);
  const entries = archive.getEntries();
  const problems = [];
  for (const wasm of required) {
    const name = `extension/${wasm}`;
    const matches = entries.filter((entry) => entry.entryName === name);
    if (matches.length === 0) {
      problems.push(`${wasm} is missing from the VSIX`);
    } else if (matches.length !== 1 || matches[0].isDirectory) {
      problems.push(`${wasm} must be one file in the VSIX`);
    } else if (matches[0].getData().length === 0) {
      problems.push(`${wasm} is present in the VSIX but empty (0 bytes)`);
    }
  }
  return problems;
}

function selfTest(required) {
  const dir = fs.mkdtempSync(path.join(ROOT, '.wasm-vsix-test-'));
  try {
    const archivePath = path.join(dir, 'fixture.vsix');
    function fixture(omitted, empty, prefix = 'extension/') {
      const archive = new AdmZip();
      for (const wasm of required) {
        if (wasm !== omitted) {
          archive.addFile(
            `${prefix}${wasm}`,
            Buffer.from(wasm === empty ? '' : 'fixture'),
          );
        }
      }
      archive.writeZip(archivePath);
    }
    fixture();
    assert.deepEqual(verifyVsix(archivePath, required), []);
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
    `VSIX WASM self-test PASS: complete ZIP; ${required.length} missing and ${required.length} empty asset negatives; wrong prefix, corrupt/missing archive, CLI exits and package ordering`,
  );
}

if (require.main === module) {
  const required = requiredWasmFiles();
  if (process.argv[2] === '--self-test') selfTest(required);
  else {
    const vsixPath = process.argv[2]
      ? path.resolve(process.argv[2])
      : packagedVsixPath();
    const problems = verifyVsix(vsixPath, required);
    if (problems.length)
      throw new Error(
        `Packed VSIX WASM verification failed:\n${problems.join('\n')}`,
      );
    console.log(
      `[verify-packed-wasm] PASS ${path.basename(vsixPath)}: ${required.length} active WASM assets present and non-empty; ${fs.statSync(vsixPath).size} archive bytes`,
    );
  }
}
