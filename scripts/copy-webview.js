/**
 * Copy webview build to extension dist.
 *
 * The VSIX skips the Electron-only chunks (CodeMirror, spot editor, commit
 * composer, task view): `scripts/electron-only-chunks.js` derives the list from
 * the production build's stats.json. The Electron renderer copy keeps them all.
 */
const fs = require('fs');
const path = require('path');
const { generate } = require('./electron-only-chunks');

const src = 'dist/apps/ptah-extension-webview/browser';
const dest = 'dist/apps/ptah-extension-vscode/webview/browser';
const extDist = 'dist/apps/ptah-extension-vscode';

// Copy webview
fs.mkdirSync(dest, { recursive: true });
// `generate` throws when stats.json is missing or does not describe `src`.
const { electronOnly } = generate('dist/apps/ptah-extension-webview');
// esbuild chunk names are mixed case: two may differ only in case where the
// file system is case-sensitive, so compare exactly except on Windows.
const pathKey = (p) =>
  process.platform === 'win32'
    ? path.resolve(p).toLowerCase()
    : path.resolve(p);
const skip = new Set(electronOnly.map((f) => pathKey(path.join(src, f))));
fs.cpSync(src, dest, {
  recursive: true,
  filter: (source) => !skip.has(pathKey(source)),
});
console.log(`Skipped ${skip.size} Electron-only chunks for the VSIX.`);

// Copy metadata files
fs.copyFileSync('README.md', path.join(extDist, 'README.md'));
if (fs.existsSync('LICENSE.md')) {
  fs.copyFileSync('LICENSE.md', path.join(extDist, 'LICENSE.md'));
}
if (fs.existsSync('CHANGELOG.md')) {
  fs.copyFileSync('CHANGELOG.md', path.join(extDist, 'CHANGELOG.md'));
}
fs.copyFileSync(
  'apps/ptah-extension-vscode/.vscodeignore',
  path.join(extDist, '.vscodeignore'),
);

console.log('Webview copied, metadata files copied.');
