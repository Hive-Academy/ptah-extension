/**
 * Copy webview build to extension dist, excluding Monaco Editor.
 * Monaco is only needed for Electron, not the VS Code extension.
 * Its AMD loader contains eval()/new Function() which triggers
 * marketplace "suspicious content" scanner.
 */
const fs = require('fs');
const path = require('path');

const src = 'dist/apps/ptah-extension-webview/browser';
const dest = 'dist/apps/ptah-extension-vscode/webview/browser';
const extDist = 'dist/apps/ptah-extension-vscode';

// Copy webview, excluding Monaco
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, {
  recursive: true,
  filter: (source) => {
    const normalized = source.replace(/\\/g, '/');
    if (
      normalized.includes('/assets/monaco/') ||
      normalized.endsWith('/assets/monaco')
    ) {
      return false;
    }
    return true;
  },
});

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

console.log('Webview copied (Monaco excluded), metadata files copied.');
