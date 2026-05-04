/**
 * Jest global setup — verifies the dist binary exists before any spec runs.
 *
 * Failing here gives a clean diagnostic ("run nx build ptah-cli first")
 * instead of every spec timing out on spawn.
 */

const fs = require('node:fs');
const path = require('node:path');

module.exports = async function globalSetup() {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
  const distBin = path.join(repoRoot, 'dist', 'apps', 'ptah-cli', 'main.mjs');
  if (!fs.existsSync(distBin)) {
    // eslint-disable-next-line no-console
    console.error(
      `[ptah-cli e2e] dist binary not found at ${distBin}. ` +
        `Run 'nx build ptah-cli' before 'nx e2e ptah-cli'.`,
    );
    process.exit(2);
  }
  // Warn (don't fail) if the bundle is older than 24h — local devs often
  // forget to rebuild after switching branches.
  const ageMs = Date.now() - fs.statSync(distBin).mtimeMs;
  const dayMs = 24 * 60 * 60 * 1000;
  if (ageMs > dayMs) {
    // eslint-disable-next-line no-console
    console.warn(
      `[ptah-cli e2e] dist binary is ${Math.floor(ageMs / dayMs)} day(s) old. ` +
        `Consider rerunning 'nx build ptah-cli'.`,
    );
  }
};
