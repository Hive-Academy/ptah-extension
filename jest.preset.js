const path = require('path');
const nxPreset = require('@nx/jest/preset').default;

module.exports = {
  ...nxPreset,
  // Jest defaults maxWorkers to (cores - 1), and Nx gives every project its own
  // jest invocation, so ONE `nx run-many -t test` took 15 workers on a 16-core
  // host and 11 GB of RSS (measured 2026-09-20: 15 `jest-worker/processChild.js`
  // processes at 730-790 MB each). That starves the Electron app the developer
  // is working in, which reads as UI lag rather than as a test run.
  //
  // Half the machine is still fast enough. The two `apps/ptah-cli` configs that
  // pin `maxWorkers: 1` (pty and e2e, which bind a real console) set it
  // explicitly and so are unaffected by this default.
  maxWorkers: '50%',
  // `marked` 18 publishes ESM-only ("exports": { ".": "./lib/marked.esm.js" },
  // "type": "module") but still ships a CommonJS UMD build at
  // lib/marked.umd.js. Jest's CJS module loader cannot `require()` the ESM
  // entry point, so any project whose graph reaches `marked` (directly, or
  // transitively through @ptah-extension/tool-output-reducers /
  // @ptah-extension/vscode-lm-tools) fails with "Must use import to load ES
  // Module". Redirecting the bare specifier to the UMD build sidesteps ESM
  // parsing entirely, so no project needs a `marked`-specific
  // transformIgnorePatterns/allowJs workaround. Jest merges a project's own
  // `moduleNameMapper` with the preset's (object union, project entries take
  // precedence on key collisions) rather than replacing it, so this applies
  // even to projects that already declare their own mapper — verified against
  // apps/ptah-extension-vscode, which has its own `vscode`/`wasm-bundle-dir`
  // mappers and no `marked` entry of its own.
  moduleNameMapper: {
    '^marked$': path.resolve(
      __dirname,
      'node_modules/marked/lib/marked.umd.js',
    ),
  },
};
