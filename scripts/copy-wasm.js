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

// Resolve paths relative to the workspace root (parent of this script's directory)
// so the script works correctly regardless of process.cwd().
const workspaceRoot = path.resolve(__dirname, '..');
const wasmSource = path.join(
  workspaceRoot,
  'node_modules',
  '@vscode',
  'tree-sitter-wasm',
  'wasm',
);
const wasmDest = path.resolve(outputDir, 'wasm');

const wasmFiles = [
  'tree-sitter.wasm',
  'tree-sitter-javascript.wasm',
  'tree-sitter-typescript.wasm',
];

fs.mkdirSync(wasmDest, { recursive: true });

for (const file of wasmFiles) {
  const src = path.join(wasmSource, file);
  const dest = path.join(wasmDest, file);

  if (!fs.existsSync(src)) {
    console.error(`WASM file not found: ${src}`);
    process.exit(1);
  }

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
  console.log(`  Copied ${file} (${size} KB)`);
}

console.log(`WASM assets copied to ${wasmDest}`);
