/**
 * Copy webview build to extension dist.
 */
const fs = require('fs');
const path = require('path');

const src = 'dist/apps/ptah-extension-webview/browser';
const dest = 'dist/apps/ptah-extension-vscode/webview/browser';
const extDist = 'dist/apps/ptah-extension-vscode';

// Copy webview
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });

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
