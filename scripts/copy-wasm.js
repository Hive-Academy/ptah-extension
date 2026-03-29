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

const wasmSource = path.join(
  'node_modules',
  '@vscode',
  'tree-sitter-wasm',
  'wasm',
);
const wasmDest = path.join(outputDir, 'wasm');

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
  const size = (fs.statSync(dest).size / 1024).toFixed(1);
  console.log(`  Copied ${file} (${size} KB)`);
}

console.log(`WASM assets copied to ${wasmDest}`);
