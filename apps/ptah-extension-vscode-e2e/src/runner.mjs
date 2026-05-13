// VS Code extension e2e runner.
//
// Downloads (and caches) VS Code, then launches it with our built extension
// loaded and the test suite as `extensionTestsPath`. Mirrors the Playwright +
// _electron.launch pattern used by ptah-electron-e2e, but uses Microsoft's
// official @vscode/test-electron harness because the extension host is not
// an Electron app we control directly.

import { runTests } from '@vscode/test-electron';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const extensionDevelopmentPath = path.join(
    repoRoot,
    'dist',
    'apps',
    'ptah-extension-vscode',
  );
  const extensionTestsPath = path.join(__dirname, 'suite', 'index.cjs');

  // Verify the built extension exists. The dependsOn build step should
  // produce this, but spell it out so a stale state fails loudly.
  const mainEntry = path.join(extensionDevelopmentPath, 'main.mjs');
  if (!fs.existsSync(mainEntry)) {
    throw new Error(
      `Built extension not found at ${mainEntry}. ` +
        `Run "nx build ptah-extension-vscode" first.`,
    );
  }

  // Isolated user-data and extensions dirs so we don't touch the user's
  // real VS Code profile and so each run starts cold.
  const tmpRoot = path.join(
    os.tmpdir(),
    'ptah-vscode-e2e',
    `run-${Date.now()}`,
  );
  const userDataDir = path.join(tmpRoot, 'user-data');
  const extensionsDir = path.join(tmpRoot, 'extensions');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });

  console.log('[e2e] extensionDevelopmentPath:', extensionDevelopmentPath);
  console.log('[e2e] extensionTestsPath:      ', extensionTestsPath);
  console.log('[e2e] userDataDir:             ', userDataDir);

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        '--user-data-dir',
        userDataDir,
        '--extensions-dir',
        extensionsDir,
        '--disable-extensions', // disables all OTHER extensions; ours still loads
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--no-sandbox',
      ],
    });
  } catch (err) {
    console.error('[e2e] runTests failed:', err);
    process.exit(1);
  }
}

main();
