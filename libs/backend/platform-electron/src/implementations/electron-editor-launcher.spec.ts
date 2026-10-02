import { ElectronEditorLauncher } from './electron-editor-launcher';
import * as path from 'node:path';

describe('ElectronEditorLauncher', () => {
  // exitCode 0: a terminal launch that starts and settles cleanly (the
  // shape git-bash.exe and the cmd.exe trampoline produce) — the exit probe
  // reads this instead of waiting out its window.
  const spawnProcess = jest.fn(() => ({
    whenSpawned: Promise.resolve(7),
    exitCode: 0,
    once: () => undefined,
    off: () => undefined,
  }));

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

  it('uses the argv spawner for Kiro', async () => {
    const launcher = new ElectronEditorLauncher({ spawnProcess } as never);
    const executablePath = path.resolve('editors/kiro');
    const filePath = path.resolve('workspace/a.ts');
    await launcher.openFile(
      { id: 'kiro', displayName: 'Kiro', executablePath },
      filePath,
    );
    expect(spawnProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        command: executablePath,
        args: ['-g', filePath],
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

  it('opens an external terminal at the workspace root', async () => {
    const launcher = new ElectronEditorLauncher({ spawnProcess } as never, {
      platform: 'win32',
    });
    const executablePath = path.resolve('Git/git-bash.exe');
    const workspaceRoot = path.resolve('workspace');

    await launcher.openWorkspace(
      { id: 'terminal', displayName: 'Terminal', executablePath },
      workspaceRoot,
    );

    expect(spawnProcess).toHaveBeenCalledWith({
      command: executablePath,
      args: [`--cd=${workspaceRoot}`],
      cwd: workspaceRoot,
      env: process.env,
      detached: false,
      needsConsole: true,
    });
  });

  it('rejects opening a file in the terminal without spawning', async () => {
    const launcher = new ElectronEditorLauncher({ spawnProcess } as never);

    await expect(
      launcher.openFile(
        {
          id: 'terminal',
          displayName: 'Terminal',
          executablePath: path.resolve('xterm'),
        },
        path.resolve('workspace/a.ts'),
      ),
    ).rejects.toThrow('Terminal cannot open a file');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  describe('openMergeTool', () => {
    const request = {
      local: path.resolve('git/ptah-merge/h/local.ts'),
      remote: path.resolve('git/ptah-merge/h/remote.ts'),
      base: path.resolve('git/ptah-merge/h/base.ts'),
      result: path.resolve('workspace/src/a.ts'),
    };

    it('launches VS Code with --merge local remote base result', async () => {
      const launcher = new ElectronEditorLauncher({ spawnProcess } as never);
      const executablePath = path.resolve('editors/code');

      await expect(
        launcher.openMergeTool(
          { id: 'vscode', displayName: 'VS Code', executablePath },
          request,
        ),
      ).resolves.toEqual({ status: 'launched' });
      expect(spawnProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          command: executablePath,
          args: [
            '--merge',
            request.local,
            request.remote,
            request.base,
            request.result,
          ],
          cwd: path.dirname(request.result),
          needsConsole: false,
        }),
      );
    });

    it.each(['cursor', 'antigravity', 'zed', 'kiro', 'terminal'] as const)(
      'A11: refuses %s, which declares no mergeArgs, without spawning',
      async (id) => {
        const launcher = new ElectronEditorLauncher({ spawnProcess } as never);

        await expect(
          launcher.openMergeTool(
            {
              id,
              displayName: id,
              executablePath: path.resolve('editors', id),
            },
            request,
          ),
        ).resolves.toEqual({ status: 'unsupported' });
        expect(spawnProcess).not.toHaveBeenCalled();
      },
    );

    it('A11: reads mergeArgs from injected definitions', async () => {
      const launcher = new ElectronEditorLauncher({ spawnProcess } as never, {
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
            installCandidates: [],
            mergeArgs: ['--merge'],
          },
        ],
      });

      await expect(
        launcher.openMergeTool(
          {
            id: 'vscode',
            displayName: 'VS Code',
            executablePath: path.resolve('editors/code'),
          },
          request,
        ),
      ).resolves.toEqual({ status: 'unsupported' });
      await expect(
        launcher.openMergeTool(
          {
            id: 'cursor',
            displayName: 'Cursor',
            executablePath: path.resolve('editors/cursor'),
          },
          request,
        ),
      ).resolves.toEqual({ status: 'launched' });
      expect(spawnProcess).toHaveBeenCalledTimes(1);
    });

    it('returns failed instead of rejecting on a relative path', async () => {
      const launcher = new ElectronEditorLauncher({ spawnProcess } as never);

      const result = await launcher.openMergeTool(
        {
          id: 'vscode',
          displayName: 'VS Code',
          executablePath: path.resolve('editors/code'),
        },
        { ...request, base: 'base.ts' },
      );

      expect(result).toEqual({
        status: 'failed',
        error: new Error('Base path must be absolute'),
      });
      expect(spawnProcess).not.toHaveBeenCalled();
    });

    it('returns failed instead of rejecting when the spawn fails', async () => {
      const failedSpawn = jest.fn(() => ({
        whenSpawned: Promise.resolve(null),
      }));
      const launcher = new ElectronEditorLauncher({
        spawnProcess: failedSpawn,
      } as never);

      await expect(
        launcher.openMergeTool(
          {
            id: 'vscode',
            displayName: 'VS Code',
            executablePath: path.resolve('editors/code'),
          },
          request,
        ),
      ).resolves.toEqual({
        status: 'failed',
        error: new Error('Failed to launch VS Code'),
      });
    });

    it('wraps a non-Error throw from the spawner', async () => {
      const throwingSpawn = jest.fn(() => {
        throw 'boom';
      });
      const launcher = new ElectronEditorLauncher({
        spawnProcess: throwingSpawn,
      } as never);

      await expect(
        launcher.openMergeTool(
          {
            id: 'vscode',
            displayName: 'VS Code',
            executablePath: path.resolve('editors/code'),
          },
          request,
        ),
      ).resolves.toEqual({ status: 'failed', error: new Error('boom') });
    });
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
