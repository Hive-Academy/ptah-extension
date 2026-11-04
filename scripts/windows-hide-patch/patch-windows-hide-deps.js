#!/usr/bin/env node
/**
 * patch-windows-hide-deps.js (postinstall, TASK_2026_625)
 *
 * Three dependencies start Windows console programs with no spawn-options
 * hook. From Electron's console-less main process each such spawn opens a new,
 * VISIBLE console window that flashes open and closed:
 *
 *   - `@openai/codex-sdk`  — `codex exec`, once per agent turn.
 *   - `@cursor/sdk`        — git, the shell tool, ffmpeg and the sandbox probe
 *                            of the local runtime.
 *   - `chrome-launcher`    — `taskkill` in `kill()` on browser close.
 *
 * The SDKs get their `child_process` import pointed at
 * `ptah-windows-hide-child-process.{cjs,mjs}` (copied next to the patched
 * file), which defaults `windowsHide: true` on every spawn. `chrome-launcher`
 * gets the key added to its one `taskkill` call: a blanket default there would
 * also pass SW_HIDE to the Chrome window it launches.
 *
 * Each patch edits exact text and applies to any installed version: the
 * anchor text, not a version pin, is the guard. Each `from` must occur exactly
 * once. Text that does not match is reported and the package is left
 * untouched: install never fails because of this script. The spec
 * `patch-windows-hide-deps.spec.ts` fails instead, so a dependency bump that
 * changes the patched code must update the anchors. Idempotent.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SHIM_SOURCE_DIR = __dirname;
const SHIM_BASENAME = 'ptah-windows-hide-child-process';
const SHIM_CJS = `./${SHIM_BASENAME}.cjs`;
const SHIM_MJS = `./${SHIM_BASENAME}.mjs`;

/**
 * @typedef {{ from: string, to: string }} Edit  `from` must occur exactly once.
 * @typedef {{ file: string, edits: Edit[] }} FilePatch  `file` is package-relative.
 * @typedef {{ name: string, files: FilePatch[], shimDirs: string[] }} PackagePatch
 */

/** @type {PackagePatch[]} */
const PATCHES = [
  {
    name: '@openai/codex-sdk',
    files: [
      {
        file: 'dist/index.js',
        edits: [
          {
            from: 'import { spawn } from "child_process";',
            to: `import { spawn } from "${SHIM_MJS}";`,
          },
        ],
      },
    ],
    shimDirs: ['dist'],
  },
  {
    // Webpack bundle: every chunk reaches `child_process` through the module
    // table in index.js, so the table entries are the only edits.
    name: '@cursor/sdk',
    files: [
      {
        file: 'dist/cjs/index.js',
        edits: [
          { from: 'require("child_process")', to: `require("${SHIM_CJS}")` },
          {
            from: 'require("node:child_process")',
            to: `require("${SHIM_CJS}")`,
          },
        ],
      },
      {
        file: 'dist/esm/index.js',
        edits: [
          {
            from: 'import*as d from"node:child_process"',
            to: `import*as d from"${SHIM_MJS}"`,
          },
          {
            // `x` is `createRequire(import.meta.url)`.
            from: 'child_process(e){e.exports=x("child_process")}',
            to: `child_process(e){e.exports=x("${SHIM_CJS}")}`,
          },
        ],
      },
    ],
    shimDirs: ['dist/cjs', 'dist/esm'],
  },
  {
    name: 'chrome-launcher',
    files: [
      {
        file: 'dist/chrome-launcher.js',
        edits: [
          {
            from: "{ shell: true, encoding: 'utf-8' }",
            to: "{ shell: true, encoding: 'utf-8', windowsHide: true }",
          },
        ],
      },
    ],
    shimDirs: [],
  },
];

function countOccurrences(text, needle) {
  let count = 0;
  let at = text.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = text.indexOf(needle, at + needle.length);
  }
  return count;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * State of one package under `nodeModulesDir`, without writing anything.
 *
 * @returns {{ state: 'missing' | 'anchor-mismatch' | 'unpatched' | 'patched', detail?: string, updates?: { file: string, text: string }[] }}
 */
function inspectPackage(nodeModulesDir, patch) {
  const pkgDir = path.join(nodeModulesDir, patch.name);
  const manifest = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(manifest)) {
    return { state: 'missing' };
  }
  const updates = [];
  let pending = 0;
  for (const filePatch of patch.files) {
    const file = path.join(pkgDir, filePatch.file);
    if (!fs.existsSync(file)) {
      return { state: 'anchor-mismatch', detail: `${filePatch.file} missing` };
    }
    const original = fs.readFileSync(file, 'utf8');
    let text = original;
    for (const edit of filePatch.edits) {
      const before = countOccurrences(text, edit.from);
      if (before === 1) {
        text = text.replace(edit.from, () => edit.to);
        pending += 1;
      } else if (before !== 0 || !original.includes(edit.to)) {
        // "Already applied" is judged on the file as read: edits can share a
        // `to`, so an earlier in-memory edit must not hide a missing anchor.
        return {
          state: 'anchor-mismatch',
          detail: `${filePatch.file}: expected one ${JSON.stringify(edit.from)}, found ${before}`,
        };
      }
    }
    updates.push({ file, text });
  }

  const shimsPresent = patch.shimDirs.every((dir) =>
    ['.cjs', '.mjs'].every((ext) =>
      fs.existsSync(path.join(pkgDir, dir, SHIM_BASENAME + ext)),
    ),
  );
  if (pending === 0 && shimsPresent) {
    return { state: 'patched' };
  }
  return { state: 'unpatched', updates };
}

/** Apply one package patch. Returns the state it found. */
function applyPackagePatch(nodeModulesDir, patch, shimSourceDir) {
  const result = inspectPackage(nodeModulesDir, patch);
  if (result.state !== 'unpatched') {
    return result;
  }
  const pkgDir = path.join(nodeModulesDir, patch.name);
  // Shims first: a patched import must never point at a file that is not there.
  for (const dir of patch.shimDirs) {
    for (const ext of ['.cjs', '.mjs']) {
      fs.copyFileSync(
        path.join(shimSourceDir, SHIM_BASENAME + ext),
        path.join(pkgDir, dir, SHIM_BASENAME + ext),
      );
    }
  }
  for (const update of result.updates) {
    fs.writeFileSync(update.file, update.text);
  }
  return result;
}

/** `name@version` of the installed package, or `name` when it has no manifest. */
function installedLabel(nodeModulesDir, name) {
  const manifest = path.join(nodeModulesDir, name, 'package.json');
  if (!fs.existsSync(manifest)) {
    return name;
  }
  return `${name}@${readJson(manifest).version}`;
}

function main() {
  const nodeModulesDir = path.join(ROOT, 'node_modules');
  for (const patch of PATCHES) {
    const { state, detail } = applyPackagePatch(
      nodeModulesDir,
      patch,
      SHIM_SOURCE_DIR,
    );
    const label = installedLabel(nodeModulesDir, patch.name);
    if (state === 'unpatched') {
      console.log(`[patch-windows-hide-deps] patched ${label}`);
    } else if (state === 'patched') {
      console.log(`[patch-windows-hide-deps] already patched: ${label}`);
    } else if (state === 'missing') {
      console.log(`[patch-windows-hide-deps] not installed: ${patch.name}`);
    } else {
      console.warn(
        `[patch-windows-hide-deps] SKIPPED ${label} (${state}: ${detail}). ` +
          'Its spawns will open visible console windows on Windows. ' +
          'Update its anchors in scripts/windows-hide-patch/patch-windows-hide-deps.js.',
      );
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { PATCHES, inspectPackage, applyPackagePatch };
