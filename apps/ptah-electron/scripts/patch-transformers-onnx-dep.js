#!/usr/bin/env node
/**
 * patch-transformers-onnx-dep.js
 *
 * Build-time gate (packaging fix, TASK_2026_VOICE_PROVIDERS Batch 7.5).
 *
 * `nx package ptah-electron` failed before electron-builder could even start
 * copying files:
 *
 *   ⨯ production dependency not found  parent=@huggingface/transformers
 *     dependency=onnxruntime-node version=1.21.0
 *
 * Root cause: the root/apps `overrides.onnxruntime-node = "1.20.1"` pin
 * (defense-in-depth for the onnxruntime-node@1.21.0 cross-thread HandleScope
 * native-abort crash) rewrites the *resolved* onnxruntime-node install to
 * 1.20.1 everywhere — npm's own resolver (and `npm ls`) understands this
 * fine. But npm `overrides` never rewrites a dependent package's own
 * package.json text: node_modules/@huggingface/transformers/package.json
 * still literally declares `"onnxruntime-node": "1.21.0"` in its
 * `dependencies`. electron-builder falls back to its
 * `TraversalNodeModulesCollector` here (the generated dist project dir has
 * no local node_modules for the npm collector to find anything in), which
 * walks each package's OWN declared version string and requires a literal
 * matching install on disk — it has no concept of npm `overrides`. Since
 * only 1.20.1 physically exists (nested under transformers/node_modules,
 * because the override made it the sole version in the whole tree), the
 * collector reports "production dependency not found" and aborts packaging
 * entirely, before verify-packed-onnx.js ever gets a chance to run.
 *
 * Fix: reconcile the DECLARED version in the installed manifest(s) to match
 * the pinned/physically-installed one, so the traversal collector's literal
 * version check succeeds. This does NOT change what's physically installed
 * — `npm ls onnxruntime-node` still resolves the pinned version before and
 * after this script runs; only the dependent's own manifest text changes.
 *
 * Must run before electron-builder (i.e. before the `electron-builder`
 * invocation in the `package` target), which reads the SOURCE node_modules
 * tree. This is complementary to patch-dist-overrides.js, which patches the
 * GENERATED dist/apps/ptah-electron/package.json's `overrides` block (that
 * manifest drives the packaged app's own runtime `overrides`, not
 * electron-builder's dependency-tree walk during packaging).
 *
 * Idempotent: safe to run repeatedly (e.g. also from postinstall) — it's a
 * no-op once the declared version already matches the pin.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const DEP_NAME = 'onnxruntime-node';

/** Hardcoded fallback, kept in sync with the `overrides.onnxruntime-node`
 * entries in root package.json and apps/ptah-electron/package.json. Used
 * only if the root manifest can't be read/parsed for some reason. */
const FALLBACK_PIN = '1.20.1';

/** Single source of truth for the pinned version: root package.json `overrides`. */
function readPinVersion() {
  const rootPkgPath = path.join(ROOT, 'package.json');
  try {
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
    const pinned = rootPkg.overrides && rootPkg.overrides[DEP_NAME];
    if (typeof pinned === 'string' && pinned.length > 0) {
      return pinned;
    }
  } catch {
    /* fall through to hardcoded fallback */
  }
  console.warn(
    `[patch-transformers-onnx-dep] could not read overrides.${DEP_NAME} from ` +
      `root package.json — falling back to hardcoded "${FALLBACK_PIN}".`,
  );
  return FALLBACK_PIN;
}

const PIN_VERSION = readPinVersion();

/**
 * Manifests whose declared `dependencies.onnxruntime-node` must be
 * reconciled to the pin. The first entry (the actual, hoisted install) is
 * required — packaging cannot proceed without it. Later entries are
 * optional: kokoro-js depends on @huggingface/transformers too, and if npm
 * ever nests a second physical copy under it (instead of hoisting to the
 * single root install, which is what happens today — verified: no
 * node_modules/kokoro-js/node_modules exists), that nested copy needs the
 * same reconciliation. No-op today; kept for resilience against future
 * install-tree changes.
 */
const TARGET_MANIFESTS = [
  {
    path: path.join(
      ROOT,
      'node_modules',
      '@huggingface',
      'transformers',
      'package.json',
    ),
    required: true,
  },
  {
    path: path.join(
      ROOT,
      'node_modules',
      'kokoro-js',
      'node_modules',
      '@huggingface',
      'transformers',
      'package.json',
    ),
    required: false,
  },
];

function patchManifest(manifestPath, required) {
  if (!fs.existsSync(manifestPath)) {
    if (required) {
      console.error(
        `[patch-transformers-onnx-dep] Required manifest missing: ${manifestPath}. ` +
          `Run npm install first (@huggingface/transformers must be installed ` +
          `before this script/before packaging).`,
      );
      process.exit(1);
    }
    // Optional nested copy not present in this install tree — nothing to do.
    return;
  }

  let raw;
  let pkg;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
    pkg = JSON.parse(raw);
  } catch (error) {
    console.error(
      `[patch-transformers-onnx-dep] Could not read/parse ${manifestPath}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  const rel = path.relative(ROOT, manifestPath);
  const current = pkg.dependencies && pkg.dependencies[DEP_NAME];
  if (current === PIN_VERSION) {
    console.log(
      `[patch-transformers-onnx-dep] already reconciled: ${rel} declares ` +
        `dependencies.${DEP_NAME} = "${PIN_VERSION}".`,
    );
    return;
  }

  if (!pkg.dependencies || typeof pkg.dependencies !== 'object') {
    pkg.dependencies = {};
  }
  pkg.dependencies[DEP_NAME] = PIN_VERSION;
  const trailingNewline = raw.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(pkg, null, 2) + trailingNewline,
  );
  console.log(
    `[patch-transformers-onnx-dep] reconciled ${rel}: ` +
      `dependencies.${DEP_NAME} "${current ?? '(missing)'}" -> "${PIN_VERSION}" ` +
      `(matches the physical install; this is what electron-builder's ` +
      `traversal node-modules collector requires to stop reporting ` +
      `"production dependency not found").`,
  );
}

function main() {
  console.log(
    `[patch-transformers-onnx-dep] reconciling declared ${DEP_NAME} version ` +
      `to the pin: ${PIN_VERSION}`,
  );
  for (const { path: manifestPath, required } of TARGET_MANIFESTS) {
    patchManifest(manifestPath, required);
  }
}

main();
