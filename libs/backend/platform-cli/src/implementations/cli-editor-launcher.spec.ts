import { CliEditorLauncher } from './cli-editor-launcher';
import * as path from 'node:path';

describe('CliEditorLauncher', () => {
  const executable = path.resolve('editors/code');
  const target = {
    id: 'vscode' as const,
    displayName: 'VS Code',
    executablePath: executable,
  };
  const spawnProcess = jest.fn(() => ({ whenSpawned: Promise.resolve(42) }));

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
          installCandidates: [{ path: '/editors/code' }],
        },
      ],
      exists: async (candidate) => candidate === '/editors/code',
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

  it('rejects relative paths before spawning', async () => {
    const launcher = new CliEditorLauncher({ spawnProcess } as never);
    await expect(launcher.openFile(target, 'relative.ts')).rejects.toThrow(
      'absolute',
    );
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
