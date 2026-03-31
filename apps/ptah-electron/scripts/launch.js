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

// Support --production flag to test against live API (api.ptah.live)
const useProd = process.argv.includes('--production');
const nodeEnv = useProd ? 'production' : 'development';

// Forward any extra args (e.g., workspace path) to the Electron app
const extraArgs = process.argv.slice(2).filter((a) => a !== '--production');

console.log('[launch] Starting Electron app...');
console.log(`[launch] Main: ${mainPath}`);
console.log(`[launch] NODE_ENV: ${nodeEnv}`);
if (extraArgs.length) {
  console.log(`[launch] Args: ${extraArgs.join(' ')}`);
}

try {
  execFileSync(electronPath, [mainPath, ...extraArgs], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: nodeEnv,
    },
  });
} catch (error) {
  // Electron exited with non-zero code (user closed window, etc.)
  if (error.status !== null && error.status !== 0) {
    process.exit(error.status);
  }
}
