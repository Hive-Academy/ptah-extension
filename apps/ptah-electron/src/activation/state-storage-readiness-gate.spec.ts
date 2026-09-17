import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mainSource = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
const bootstrapSource = readFileSync(join(__dirname, 'bootstrap.ts'), 'utf8');
const postWindowSource = readFileSync(
  join(__dirname, 'post-window.ts'),
  'utf8',
);
const shellSource = readFileSync(
  join(__dirname, '..', 'assets', 'preparing-workspace.html'),
  'utf8',
);

describe('Electron workspace state readiness gate', () => {
  it('loads only the static shell before bootstrap can await storage', () => {
    const shellLoad = mainSource.indexOf(
      'await preparingWindow.loadFile(preparingShellPath',
    );
    const bootstrap = mainSource.indexOf(
      'boot = await bootstrapElectron(() => mainWindow, coordinator)',
    );

    expect(shellLoad).toBeGreaterThanOrEqual(0);
    expect(bootstrap).toBeGreaterThan(shellLoad);
    expect(shellSource).toContain("default-src 'none'");
    expect(shellSource).not.toContain('<script>');
  });

  it('awaits the exact workspace storage delegate before IPC and session activation', () => {
    const readiness = bootstrapSource.indexOf(
      'PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE',
    );
    const wait = bootstrapSource.indexOf('.whenReady()', readiness);
    const ipc = bootstrapSource.indexOf('new IpcBridge', wait);
    const sessionActivation = bootstrapSource.indexOf(
      'activateSessionLifecycleNotifier',
      wait,
    );

    expect(readiness).toBeGreaterThanOrEqual(0);
    expect(wait).toBeGreaterThan(readiness);
    expect(ipc).toBeGreaterThan(wait);
    expect(sessionActivation).toBeGreaterThan(wait);
  });

  it('reuses the shell window and loads Angular only after the gate', () => {
    const reuse = postWindowSource.indexOf(
      'options.getMainWindow() ?? createMainWindow(resolvedStateStorage)',
    );
    const angularLoad = postWindowSource.indexOf(
      'mainWindow.loadFile(rendererPath)',
    );

    expect(reuse).toBeGreaterThanOrEqual(0);
    expect(angularLoad).toBeGreaterThan(reuse);
  });
});
