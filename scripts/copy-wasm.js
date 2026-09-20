/**
 * Copy tree-sitter WASM files from @vscode/tree-sitter-wasm to the build output.
 *
 * The Nx esbuild executor's asset copy is filtered by .gitignore (via the `ignore` library),
 * which blocks files under node_modules/. This script bypasses that limitation by copying
 * the WASM files directly after the esbuild step.
 *
 * Usage: node scripts/copy-wasm.js <output-dir>
 * Example: node scripts/copy-wasm.js dist/apps/ptah-extension-vscode
 */
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2];
if (!outputDir) {
  console.error('Usage: node scripts/copy-wasm.js <output-dir>');
  process.exit(1);
}

// Resolve each WASM file via Node's own module resolution (require.resolve)
// rather than joining a literal `<script-dir>/../node_modules/...` path. A git
// worktree checkout intentionally has no node_modules of its own — Node's
// directory walk-up finds the primary checkout's node_modules instead, and
// every other module load in this build relies on exactly that walk-up. A
// hard-coded path bypassed it and looked for node_modules colocated with this
// script, which does not exist per worktree (TASK_2026_488).
//
// web-tree-sitter's package.json declares an `exports` map, so the wasm file
// must be resolved through its declared subpath (`./web-tree-sitter.wasm`) —
// resolving the package.json itself and joining a directory would fail with
// ERR_PACKAGE_PATH_NOT_EXPORTED. @vscode/tree-sitter-wasm has no `exports`
// map, so its grammar files resolve the same way without restriction.
function resolveWasmFile(specifier) {
  return require.resolve(specifier, { paths: [__dirname] });
}

const wasmDest = path.resolve(outputDir, 'wasm');

const wasmFiles = [
  // web-tree-sitter 0.26+ ships its own runtime wasm; copy it alongside the
  // grammars so Parser.init({ locateFile }) can resolve both the runtime and
  // language modules.
  {
    specifier: 'web-tree-sitter/web-tree-sitter.wasm',
    name: 'web-tree-sitter.wasm',
  },
  {
    specifier: '@vscode/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm',
    name: 'tree-sitter-javascript.wasm',
  },
  {
    specifier: '@vscode/tree-sitter-wasm/wasm/tree-sitter-typescript.wasm',
    name: 'tree-sitter-typescript.wasm',
  },
  {
    specifier: '@vscode/tree-sitter-wasm/wasm/tree-sitter-python.wasm',
    name: 'tree-sitter-python.wasm',
  },
  {
    specifier: '@vscode/tree-sitter-wasm/wasm/tree-sitter-go.wasm',
    name: 'tree-sitter-go.wasm',
  },
  // C# is the largest grammar by a wide margin (~4.9 MB raw, ~0.3 MB once the
  // VSIX/asar zip compresses it). Keep it last so the size delta is obvious.
  {
    specifier: '@vscode/tree-sitter-wasm/wasm/tree-sitter-c-sharp.wasm',
    name: 'tree-sitter-c-sharp.wasm',
  },
];

fs.mkdirSync(wasmDest, { recursive: true });

for (const { specifier, name } of wasmFiles) {
  let src;
  try {
    src = resolveWasmFile(specifier);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`WASM file not found: ${specifier} (${message})`);
    process.exit(1);
  }
  const dest = path.join(wasmDest, name);

  fs.copyFileSync(src, dest);

  // Verify the copy succeeded by checking the destination exists and has content
  if (!fs.existsSync(dest)) {
    console.error(`Copy verification failed: destination not found: ${dest}`);
    process.exit(1);
  }
  const destSize = fs.statSync(dest).size;
  if (destSize === 0) {
    console.error(`Copy verification failed: destination is empty: ${dest}`);
    process.exit(1);
  }
  const size = (destSize / 1024).toFixed(1);
  console.log(`  Copied ${name} (${size} KB)`);
}

console.log(`WASM assets copied to ${wasmDest}`);
