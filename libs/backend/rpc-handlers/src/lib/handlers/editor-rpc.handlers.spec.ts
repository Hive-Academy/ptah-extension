import 'reflect-metadata';
import { EditorRpcHandlers } from './editor-rpc.handlers';

describe('EditorRpcHandlers', () => {
  const target = {
    id: 'cursor' as const,
    displayName: 'Cursor',
    executablePath: '/bin/cursor',
  };
  const detect = jest.fn(async () => [target]);
  const openFile = jest.fn(async () => undefined);
  const openWorkspace = jest.fn(async () => undefined);
  const methods = new Map<string, (params: unknown) => unknown>();

  beforeEach(() => {
    jest.clearAllMocks();
    methods.clear();
    new EditorRpcHandlers(
      { warn: jest.fn() } as never,
      {
        registerMethod: (name: string, handler: (params: unknown) => unknown) =>
          methods.set(name, handler),
      } as never,
      { detect, openFile, openWorkspace },
      { getWorkspaceFolders: () => ['/workspace'] } as never,
    ).register();
  });

  it('returns only detected targets', async () => {
    await expect(methods.get('editor:detectTargets')?.({})).resolves.toEqual({
      success: true,
      targets: [target],
    });
  });

  it('opens a contained file with the detected target object', async () => {
    await expect(
      methods.get('editor:openFile')?.({
        target: 'cursor',
        path: '/workspace/a.ts',
        line: 3,
      }),
    ).resolves.toEqual({ success: true });
    expect(openFile).toHaveBeenCalledWith(
      target,
      expect.stringContaining('workspace'),
      3,
    );
  });

  it('rejects an unknown target and an out-of-workspace path', async () => {
    await expect(
      methods.get('editor:openFile')?.({
        target: 'zed',
        path: '/workspace/a.ts',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'Editor target is not installed',
    });
    await expect(
      methods.get('editor:openFile')?.({
        target: 'cursor',
        path: '/other/a.ts',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'Path is outside the workspace',
    });
    expect(openFile).not.toHaveBeenCalled();
  });
});
