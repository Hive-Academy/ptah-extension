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
};
