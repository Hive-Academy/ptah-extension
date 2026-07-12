#!/usr/bin/env node
/**
 * verify-packed-onnx.js
 *
 * Post-package gate. Inspects the onnxruntime-node that electron-builder
 * actually placed inside the packaged app (app.asar.unpacked/node_modules)
 * and fails the build unless it is the pinned 1.20.1.
 *
 * Why this exists: @huggingface/transformers 3.8.1 depends on
 * onnxruntime-node 1.21.0, whose native binding carries a cross-thread
 * HandleScope abort — a silent native crash (no JS error, the log just stops)
 * when the embedder and voice ONNX runtimes execute concurrently. The
 * onnxruntime-node@1.20.1 pin (root + generated dist overrides) is the
 * defense-in-depth fix; this verifier proves the pin survived the
 * electron-builder production install into the packaged app.
 *
 * Failing loudly here converts a silent "ships 1.21.0, then aborts on
 * concurrent inference" into a red build, exactly like verify-packed-native.js
 * does for the better-sqlite3 ABI.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const RELEASE_DIR = path.join(ROOT, 'dist', 'release');
const EXPECTED_VERSION = '1.20.1';
const MANIFEST_SUFFIX = path.join('onnxruntime-node', 'package.json');

/** Recursively collect every unpacked onnxruntime-node/package.json under dist/release. */
function findPackedManifests(dir, found) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findPackedManifests(full, found);
    } else if (
      full.includes(`app.asar.unpacked${path.sep}node_modules${path.sep}`) &&
      full.endsWith(MANIFEST_SUFFIX)
    ) {
      found.push(full);
    }
  }
}

(() => {
  if (!fs.existsSync(RELEASE_DIR)) {
    throw new Error(`No packaged output found at ${RELEASE_DIR}`);
  }

  const manifests = [];
  findPackedManifests(RELEASE_DIR, manifests);
  if (manifests.length === 0) {
    throw new Error(
      `No packed onnxruntime-node/package.json found under ${RELEASE_DIR} ` +
        `(app.asar.unpacked/node_modules). onnxruntime-node must be unpacked ` +
        `and present — the voice worker and embedder cannot load its native ` +
        `binding from inside the asar.`,
    );
  }

  const failures = [];
  for (const manifest of manifests) {
    const rel = path.relative(RELEASE_DIR, manifest);
    let version;
    try {
      version = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
    } catch (err) {
      failures.push(
        `${rel}: could not read version: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (version === EXPECTED_VERSION) {
      console.log(`[verify] OK  ${rel} → onnxruntime-node ${version}`);
    } else {
      failures.push(
        `${rel}: packed onnxruntime-node ${version} !== pinned ${EXPECTED_VERSION}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n❌ Packed onnxruntime-node is NOT the pinned ${EXPECTED_VERSION} — ` +
        `shipping this reintroduces the cross-thread native-abort crash when ` +
        `the embedder and voice ONNX runtimes run concurrently:`,
    );
    for (const f of failures) console.error(`   - ${f}`);
    console.error(
      `\n   Fix: ensure the "overrides": { "onnxruntime-node": "${EXPECTED_VERSION}" } ` +
        `entry exists in the generated dist/apps/ptah-electron/package.json ` +
        `(patch-dist-overrides.js) before electron-builder runs its production install.\n`,
    );
    process.exit(1);
  }

  console.log(
    `\n✅ All ${manifests.length} packed onnxruntime-node manifest(s) carry the ` +
      `pinned ${EXPECTED_VERSION}.`,
  );
})();
