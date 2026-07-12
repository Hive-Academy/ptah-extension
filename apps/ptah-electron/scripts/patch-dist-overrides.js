#!/usr/bin/env node
/**
 * patch-dist-overrides.js
 *
 * Build-time gate. electron-builder installs the packaged app's production
 * dependencies from the GENERATED manifest at dist/apps/ptah-electron/package.json
 * (build-main runs with generatePackageJson: true). npm only applies an
 * `overrides` block from the install ROOT — so the onnxruntime-node@1.20.1 pin
 * must physically exist in that generated manifest, otherwise the packaged app
 * silently reinstalls @huggingface/transformers' bundled onnxruntime-node@1.21.0
 * (the version carrying the cross-thread native-abort crash — Sentry HandleScope).
 *
 * This asserts (and injects if absent) the pin into the generated manifest.
 * Exits non-zero if the manifest is missing (build-main must have run first),
 * converting a silent "ships 1.21.0, then crashes" into a red build.
 *
 * Belt-and-braces alongside the `overrides` field already declared in the
 * hand-maintained apps/ptah-electron/package.json; verified post-pack by
 * verify-packed-onnx.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const DIST_MANIFEST = path.join(
  ROOT,
  'dist',
  'apps',
  'ptah-electron',
  'package.json',
);

const PIN = { name: 'onnxruntime-node', version: '1.20.1' };

function main() {
  if (!fs.existsSync(DIST_MANIFEST)) {
    console.error(
      `[patch-dist-overrides] Generated manifest missing: ${DIST_MANIFEST}. ` +
        `build-main (generatePackageJson) must run before this script.`,
    );
    process.exit(1);
  }

  let raw;
  let pkg;
  try {
    raw = fs.readFileSync(DIST_MANIFEST, 'utf8');
    pkg = JSON.parse(raw);
  } catch (error) {
    console.error(
      `[patch-dist-overrides] Could not read/parse ${DIST_MANIFEST}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  if (!pkg.overrides || typeof pkg.overrides !== 'object') {
    pkg.overrides = {};
  }

  const current = pkg.overrides[PIN.name];
  if (current === PIN.version) {
    console.log(
      `[patch-dist-overrides] pin already present: ` +
        `overrides.${PIN.name} = "${PIN.version}".`,
    );
    return;
  }

  pkg.overrides[PIN.name] = PIN.version;
  const trailingNewline = raw.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(
    DIST_MANIFEST,
    JSON.stringify(pkg, null, 2) + trailingNewline,
  );
  console.log(
    `[patch-dist-overrides] injected overrides.${PIN.name} = "${PIN.version}" ` +
      `into ${path.relative(ROOT, DIST_MANIFEST)}` +
      (current ? ` (was "${current}").` : '.'),
  );
}

main();
