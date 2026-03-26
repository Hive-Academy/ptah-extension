/**
 * Electron App Launcher
 *
 * Launches the Electron app with NODE_ENV=development and proper error handling.
 * Used by `nx serve ptah-electron` and `npm run electron:serve`.
 *
 * Usage:
 *   node apps/ptah-electron/scripts/launch.js [-- workspace-path]
 */

const { execFileSync } = require('child_process');
const path = require('path');

const electronPath = require('electron');
const mainPath = path.resolve(
  __dirname,
  '../../../dist/apps/ptah-electron/main.mjs',
);

// Forward any extra args (e.g., workspace path) to the Electron app
const extraArgs = process.argv.slice(2);

console.log('[launch] Starting Electron app...');
console.log(`[launch] Main: ${mainPath}`);
if (extraArgs.length) {
  console.log(`[launch] Args: ${extraArgs.join(' ')}`);
}

try {
  execFileSync(electronPath, [mainPath, ...extraArgs], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
    },
  });
} catch (error) {
  // Electron exited with non-zero code (user closed window, etc.)
  if (error.status !== null && error.status !== 0) {
    process.exit(error.status);
  }
}
