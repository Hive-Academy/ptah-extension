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
const { electronOnly } = generate('dist/apps/ptah-extension-webview');
const skip = new Set(
  electronOnly.map((f) => path.resolve(src, f).toLowerCase()),
);
fs.cpSync(src, dest, {
  recursive: true,
  filter: (source) => !skip.has(path.resolve(source).toLowerCase()),
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
