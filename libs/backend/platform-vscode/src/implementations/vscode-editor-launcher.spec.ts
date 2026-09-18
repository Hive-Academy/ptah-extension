import { VscodeEditorLauncher } from './vscode-editor-launcher';
import * as path from 'node:path';

describe('VscodeEditorLauncher', () => {
  const spawnProcess = jest.fn(() => ({ whenSpawned: Promise.resolve(9) }));
  const vscodeApi = {
    openFile: jest.fn(async () => undefined),
    openWorkspace: jest.fn(async () => undefined),
    openTerminal: jest.fn(async () => undefined),
  };

  beforeEach(() => {
    spawnProcess.mockClear();
    vscodeApi.openFile.mockClear();
    vscodeApi.openWorkspace.mockClear();
    vscodeApi.openTerminal.mockClear();
  });

  it('always offers the integrated terminal and never probes for one', async () => {
    const stat = jest.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    const launcher = new VscodeEditorLauncher(
      { spawnProcess } as never,
      vscodeApi,
      { platform: 'linux', env: { PATH: '/bin' }, homeDir: '/home/me', stat },
    );

    await expect(launcher.detect()).resolves.toEqual([
      { id: 'terminal', displayName: 'Terminal' },
    ]);
    expect(stat).not.toHaveBeenCalledWith('/usr/bin/x-terminal-emulator');
  });

  it('opens the integrated terminal at the workspace root', async () => {
    const launcher = new VscodeEditorLauncher(
      { spawnProcess } as never,
      vscodeApi,
    );
    const workspaceRoot = path.resolve('workspace');

    await launcher.openWorkspace(
      { id: 'terminal', displayName: 'Terminal' },
      workspaceRoot,
    );

    expect(vscodeApi.openTerminal).toHaveBeenCalledWith(workspaceRoot);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('does not include VS Code in the external target list', async () => {
    const launcher = new VscodeEditorLauncher(
      { spawnProcess } as never,
      vscodeApi,
      {
        platform: 'linux',
        env: { PATH: '/bin' },
        definitions: [
          {
            id: 'cursor',
            displayName: 'Cursor',
            command: 'cursor',
            installCandidates: [],
          },
        ],
        stat: jest.fn(async (candidate: string) => {
          if (candidate !== '/bin/cursor') throw new Error('ENOENT');
          return { isFile: () => true, mode: 0o755 };
        }) as never,
      },
    );
    await expect(launcher.detect()).resolves.toEqual([
      { id: 'cursor', displayName: 'Cursor', executablePath: '/bin/cursor' },
      { id: 'terminal', displayName: 'Terminal' },
    ]);
  });

  it('uses showTextDocument through the VS Code API for the host editor', async () => {
    const launcher = new VscodeEditorLauncher(
      { spawnProcess } as never,
      vscodeApi,
    );
    const filePath = path.resolve('workspace/a.ts');
    await launcher.openFile(
      { id: 'vscode', displayName: 'VS Code' },
      filePath,
      6,
    );
    expect(vscodeApi.openFile).toHaveBeenCalledWith(filePath, 6);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('uses the argv spawner for another editor', async () => {
    const launcher = new VscodeEditorLauncher(
      { spawnProcess } as never,
      vscodeApi,
    );
    const executablePath = path.resolve('editors/cursor');
    const filePath = path.resolve('workspace/a.ts');
    await launcher.openFile(
      { id: 'cursor', displayName: 'Cursor', executablePath },
      filePath,
    );
    expect(spawnProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        command: executablePath,
        args: ['-g', filePath],
      }),
    );
  });

  it('uses the argv spawner for Kiro', async () => {
    const launcher = new VscodeEditorLauncher(
      { spawnProcess } as never,
      vscodeApi,
    );
    const filePath = path.resolve('workspace/a.ts');
    await launcher.openFile(
      {
        id: 'kiro',
        displayName: 'Kiro',
        executablePath: path.resolve('editors/kiro'),
      },
      filePath,
    );
    expect(spawnProcess).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['-g', filePath] }),
    );
  });
});
