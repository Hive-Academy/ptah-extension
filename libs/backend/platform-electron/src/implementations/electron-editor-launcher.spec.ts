import { ElectronEditorLauncher } from './electron-editor-launcher';
import * as path from 'node:path';

describe('ElectronEditorLauncher', () => {
  const spawnProcess = jest.fn(() => ({ whenSpawned: Promise.resolve(7) }));

  beforeEach(() => {
    spawnProcess.mockClear();
  });

  it('detects only verified executable routes', async () => {
    const launcher = new ElectronEditorLauncher({ spawnProcess } as never, {
      platform: 'linux',
      env: { PATH: '/bin' },
      definitions: [
        {
          id: 'vscode',
          displayName: 'VS Code',
          command: 'code',
          installCandidates: [],
        },
        {
          id: 'cursor',
          displayName: 'Cursor',
          command: 'cursor',
          installCandidates: [
            {
              kind: 'executable',
              path: '/apps/cursor',
            },
          ],
        },
      ],
      stat: jest.fn(async (candidate: string) => {
        if (candidate !== '/bin/code' && candidate !== '/apps/cursor')
          throw new Error('ENOENT');
        return { isFile: () => true, mode: 0o755 };
      }) as never,
    });
    await expect(launcher.detect()).resolves.toEqual([
      { id: 'vscode', displayName: 'VS Code', executablePath: '/bin/code' },
      { id: 'cursor', displayName: 'Cursor', executablePath: '/apps/cursor' },
    ]);
  });

  it('uses the argv spawner for a detected binary', async () => {
    const launcher = new ElectronEditorLauncher({ spawnProcess } as never);
    const executablePath = path.resolve('editors/zed');
    const filePath = path.resolve('workspace/a.ts');
    await launcher.openFile(
      { id: 'zed', displayName: 'Zed', executablePath },
      filePath,
      4,
    );
    expect(spawnProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        command: executablePath,
        args: [`${filePath}:4`],
      }),
    );
  });

  it('opens a workspace with the normalized root as argv and cwd', async () => {
    const launcher = new ElectronEditorLauncher({ spawnProcess } as never);
    const executablePath = path.resolve('editors/cursor');
    const workspaceRoot = path.resolve('workspace');

    await launcher.openWorkspace(
      { id: 'cursor', displayName: 'Cursor', executablePath },
      workspaceRoot,
    );

    expect(spawnProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        command: executablePath,
        args: [workspaceRoot],
        cwd: workspaceRoot,
      }),
    );
  });

  it('propagates a launch failure', async () => {
    const failedSpawn = jest.fn(() => ({ whenSpawned: Promise.resolve(null) }));
    const launcher = new ElectronEditorLauncher({
      spawnProcess: failedSpawn,
    } as never);
    const executablePath = path.resolve('editors/code');

    await expect(
      launcher.openWorkspace(
        { id: 'vscode', displayName: 'VS Code', executablePath },
        path.resolve('workspace'),
      ),
    ).rejects.toThrow('Failed to launch VS Code');
  });
});
