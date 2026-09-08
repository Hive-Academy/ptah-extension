import 'reflect-metadata';
import { ElectronFileOpenRpcHandlers } from './file-open-rpc.handlers';

type RpcMethod = (params?: unknown) => unknown;

describe('ElectronFileOpenRpcHandlers - file:open through IEditorLauncher', () => {
  const vscode = {
    id: 'vscode' as const,
    displayName: 'VS Code',
    executablePath: 'C:\\editors\\code.exe',
  };
  const cursor = {
    id: 'cursor' as const,
    displayName: 'Cursor',
    executablePath: 'C:\\editors\\cursor.exe',
  };

  function build(
    options: {
      targets?: Array<typeof vscode | typeof cursor>;
      remembered?: string;
      workspaceFolders?: string[];
      openFile?: jest.Mock;
    } = {},
  ) {
    const methods = new Map<string, RpcMethod>();
    const notifyFileOpened = jest.fn();
    const openFile = options.openFile ?? jest.fn(async () => undefined);
    const launcher = {
      detect: jest.fn(async () => options.targets ?? [vscode, cursor]),
      openFile,
    };
    new ElectronFileOpenRpcHandlers(
      { warn: jest.fn() } as never,
      {
        registerMethod: (name: string, method: RpcMethod) =>
          methods.set(name, method),
      } as never,
      {
        getWorkspaceFolders: () => options.workspaceFolders ?? ['C:/ws'],
        getConfiguration: () => options.remembered,
      } as never,
      { notifyFileOpened },
      launcher as never,
    ).register();
    const method = methods.get('file:open');
    if (!method) throw new Error('file:open was not registered');
    return { method, launcher, openFile, notifyFileOpened };
  }

  it('keeps VS Code as the default when no preference is stored', async () => {
    const { method, openFile, notifyFileOpened } = build();
    await expect(method({ path: 'C:\\ws\\a.ts', line: 12 })).resolves.toEqual({
      success: true,
    });
    expect(openFile).toHaveBeenCalledWith(vscode, 'C:\\ws\\a.ts', 12);
    expect(notifyFileOpened).toHaveBeenCalledWith('C:\\ws\\a.ts');
  });

  it('uses a detected remembered target', async () => {
    const { method, openFile } = build({ remembered: 'cursor' });
    await method({ path: 'C:\\ws\\a.ts' });
    expect(openFile).toHaveBeenCalledWith(cursor, 'C:\\ws\\a.ts', undefined);
  });

  it('falls back to VS Code when the remembered target is unavailable', async () => {
    const { method, openFile } = build({
      remembered: 'cursor',
      targets: [vscode],
    });
    await method({ path: 'C:\\ws\\a.ts' });
    expect(openFile).toHaveBeenCalledWith(vscode, 'C:\\ws\\a.ts', undefined);
  });

  it('falls back to the first detected editor when VS Code is unavailable', async () => {
    const { method, openFile } = build({ targets: [cursor] });
    await method({ path: 'C:\\ws\\a.ts' });
    expect(openFile).toHaveBeenCalledWith(cursor, 'C:\\ws\\a.ts', undefined);
  });

  it('refuses an outside path and never launches', async () => {
    const { method, openFile } = build();
    await expect(method({ path: 'C:\\other\\a.ts' })).resolves.toEqual({
      success: false,
      error: 'Path is outside the workspace',
    });
    expect(openFile).not.toHaveBeenCalled();
  });

  it('reports launcher failures without notifying the editor provider', async () => {
    const openFile = jest.fn(async () => {
      throw new Error('launch failed');
    });
    const { method, notifyFileOpened } = build({ openFile });
    await expect(method({ path: 'C:\\ws\\a.ts' })).resolves.toEqual({
      success: false,
      error: 'launch failed',
    });
    expect(notifyFileOpened).not.toHaveBeenCalled();
  });

  it('rejects malformed params before detection', async () => {
    const { method, launcher } = build();
    const result = (await method({})) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toContain('path');
    expect(launcher.detect).not.toHaveBeenCalled();
  });
});
