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

  // Open VS Code on a real (temp) workspace folder. Without one, activation
  // runs in the empty-window state — workspace-dependent services see
  // `workspaceRoot: <none>` and the run diverges from how users actually
  // launch the extension.
  const workspaceDir = path.join(tmpRoot, 'workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, 'package.json'),
    JSON.stringify({ name: 'ptah-e2e-fixture', version: '0.0.1' }, null, 2),
  );
  fs.writeFileSync(
    path.join(workspaceDir, 'index.js'),
    'console.log("ptah e2e fixture");\n',
  );

  console.log('[e2e] extensionDevelopmentPath:', extensionDevelopmentPath);
  console.log('[e2e] extensionTestsPath:      ', extensionTestsPath);
  console.log('[e2e] userDataDir:             ', userDataDir);
  console.log('[e2e] workspaceDir:            ', workspaceDir);

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      // PTAH_E2E=1 does two things inside the extension host:
      //   1. bootstrap.ts seeds a previousUserContext into (in-memory)
      //      globalState so activation takes the community path instead of
      //      the license-blocked welcome page — extension-test instances run
      //      with in-memory storage, so this cannot be seeded from outside.
      //   2. verifyAndReportRpcRegistration asserts (throws) on RPC
      //      registration drift instead of just logging.
      extensionTestsEnv: { PTAH_E2E: '1' },
      launchArgs: [
        workspaceDir,
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
