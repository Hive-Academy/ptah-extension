import { VscodeEditorLauncher } from './vscode-editor-launcher';
import * as path from 'node:path';

describe('VscodeEditorLauncher', () => {
  const spawnProcess = jest.fn(() => ({ whenSpawned: Promise.resolve(9) }));
  const vscodeApi = {
    openFile: jest.fn(async () => undefined),
    openWorkspace: jest.fn(async () => undefined),
  };

  beforeEach(() => {
    spawnProcess.mockClear();
    vscodeApi.openFile.mockClear();
    vscodeApi.openWorkspace.mockClear();
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
        exists: async (candidate) => candidate === '/bin/cursor',
      },
    );
    await expect(launcher.detect()).resolves.toEqual([
      { id: 'cursor', displayName: 'Cursor', executablePath: '/bin/cursor' },
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
});
