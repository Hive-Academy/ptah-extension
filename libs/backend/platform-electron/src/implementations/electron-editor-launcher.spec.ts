import { ElectronEditorLauncher } from './electron-editor-launcher';
import * as path from 'node:path';

describe('ElectronEditorLauncher', () => {
  const spawnProcess = jest.fn(() => ({ whenSpawned: Promise.resolve(7) }));
  const openExternal = jest.fn(async () => undefined);

  beforeEach(() => {
    spawnProcess.mockClear();
    openExternal.mockClear();
  });

  it('detects a verified binary before an installed deep-link fallback', async () => {
    const launcher = new ElectronEditorLauncher(
      { spawnProcess } as never,
      { openExternal },
      {
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
              { path: '/apps/cursor', deepLinkScheme: 'cursor' },
            ],
          },
        ],
        exists: async (candidate) =>
          candidate === '/bin/code' || candidate === '/apps/cursor',
      },
    );
    await expect(launcher.detect()).resolves.toEqual([
      { id: 'vscode', displayName: 'VS Code', executablePath: '/bin/code' },
      { id: 'cursor', displayName: 'Cursor', deepLinkScheme: 'cursor' },
    ]);
  });

  it('uses the argv spawner for a detected binary', async () => {
    const launcher = new ElectronEditorLauncher({ spawnProcess } as never, {
      openExternal,
    });
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
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('uses a verified deep-link route when no binary was detected', async () => {
    const launcher = new ElectronEditorLauncher({ spawnProcess } as never, {
      openExternal,
    });
    const filePath = path.resolve('workspace/a file.ts');
    await launcher.openFile(
      { id: 'cursor', displayName: 'Cursor', deepLinkScheme: 'cursor' },
      filePath,
      2,
    );
    const encoded = encodeURI(filePath.replace(/\\/g, '/'));
    expect(openExternal).toHaveBeenCalledWith(`cursor://file/${encoded}:2`);
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
