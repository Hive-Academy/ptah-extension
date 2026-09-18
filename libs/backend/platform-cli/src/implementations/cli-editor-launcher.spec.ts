import { CliEditorLauncher } from './cli-editor-launcher';
import * as path from 'node:path';

describe('CliEditorLauncher', () => {
  const executable = path.resolve('editors/code');
  const target = {
    id: 'vscode' as const,
    displayName: 'VS Code',
    executablePath: executable,
  };
  // exitCode 0: a terminal launch that starts and settles cleanly (the
  // shape git-bash.exe and the cmd.exe trampoline produce) — the exit probe
  // reads this instead of waiting out its window.
  const spawnProcess = jest.fn(() => ({
    whenSpawned: Promise.resolve(42),
    exitCode: 0,
    once: () => undefined,
    off: () => undefined,
  }));

  beforeEach(() => spawnProcess.mockClear());

  it('detects only verified targets', async () => {
    const launcher = new CliEditorLauncher({ spawnProcess } as never, {
      env: { PATH: '' },
      platform: 'linux',
      definitions: [
        {
          id: 'vscode',
          displayName: 'VS Code',
          command: 'code',
          installCandidates: [{ kind: 'executable', path: '/editors/code' }],
        },
      ],
      stat: jest.fn(async () => ({
        isFile: () => true,
        mode: 0o755,
      })) as never,
    });
    await expect(launcher.detect()).resolves.toEqual([
      { ...target, executablePath: '/editors/code' },
    ]);
  });

  it('spawns argv without a shell and includes the requested line', async () => {
    const launcher = new CliEditorLauncher({ spawnProcess } as never);
    const filePath = path.resolve('workspace/file.ts');
    await launcher.openFile(target, filePath, 8);
    expect(spawnProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        command: executable,
        args: ['-g', `${filePath}:8`],
      }),
    );
  });

  it('launches a verified Kiro target with argv', async () => {
    const launcher = new CliEditorLauncher({ spawnProcess } as never);
    const filePath = path.resolve('workspace/file.ts');
    await launcher.openFile(
      { id: 'kiro', displayName: 'Kiro', executablePath: executable },
      filePath,
    );
    expect(spawnProcess).toHaveBeenCalledWith(
      expect.objectContaining({ command: executable, args: ['-g', filePath] }),
    );
  });

  it('opens an external terminal with the root as cwd', async () => {
    const launcher = new CliEditorLauncher({ spawnProcess } as never, {
      platform: 'darwin',
    });
    const terminal = path.resolve('bin/open');
    const workspaceRoot = path.resolve('workspace');

    await launcher.openWorkspace(
      { id: 'terminal', displayName: 'Terminal', executablePath: terminal },
      workspaceRoot,
    );

    expect(spawnProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        command: terminal,
        args: ['-a', 'Terminal', workspaceRoot],
        cwd: workspaceRoot,
        detached: true,
      }),
    );
  });

  it('rejects relative paths before spawning', async () => {
    const launcher = new CliEditorLauncher({ spawnProcess } as never);
    await expect(launcher.openFile(target, 'relative.ts')).rejects.toThrow(
      'absolute',
    );
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
