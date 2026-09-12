import 'reflect-metadata';
import { EditorRpcHandlers } from './editor-rpc.handlers';
import { FileType } from '@ptah-extension/platform-core';

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

  /**
   * What the external-link policy will answer. Defaulted to a resolved file
   * under the user's home so the happy path reads clearly; individual tests
   * override it to a rejection.
   */
  let externalResolution: unknown;
  const resolveForExternalOpen = jest.fn(async () => externalResolution);

  beforeEach(() => {
    jest.clearAllMocks();
    methods.clear();
    externalResolution = {
      kind: 'file',
      lexicalPath: '/home/me/.claude/notes.md',
      realPath: '/home/me/.claude/notes.md',
      root: '/home/me',
      sizeBytes: 12,
    };
    new EditorRpcHandlers(
      { warn: jest.fn() } as never,
      {
        registerMethod: (name: string, handler: (params: unknown) => unknown) =>
          methods.set(name, handler),
      } as never,
      { detect, openFile, openWorkspace },
      { getWorkspaceFolders: () => ['/workspace'] } as never,
      {
        stat: async () => ({
          type: FileType.File,
          ctime: 0,
          mtime: 0,
          size: 1,
        }),
      } as never,
      { resolveForExternalOpen } as never,
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

  it('resolves a relative file against its explicit registered root', async () => {
    await methods.get('editor:openFile')?.({
      target: 'cursor',
      workspaceRoot: '/workspace',
      path: 'src/a.ts',
    });
    expect(openFile).toHaveBeenCalledWith(
      target,
      expect.stringMatching(/workspace[\\/]src[\\/]a\.ts$/),
      undefined,
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

  describe("scope 'external-link'", () => {
    it('routes an out-of-workspace link through the external-link policy', async () => {
      await expect(
        methods.get('editor:openFile')?.({
          target: 'cursor',
          path: '/home/me/.claude/notes.md',
          scope: 'external-link',
        }),
      ).resolves.toEqual({ success: true });
      expect(resolveForExternalOpen).toHaveBeenCalledWith({
        path: '/home/me/.claude/notes.md',
        workspaceRoot: undefined,
      });
      expect(openFile).toHaveBeenCalledWith(
        target,
        '/home/me/.claude/notes.md',
        undefined,
      );
    });

    it('launches the LEXICAL path, never the realpath', async () => {
      externalResolution = {
        kind: 'file',
        lexicalPath: '/home/me/link.md',
        realPath: '/home/me/elsewhere/real.md',
        root: '/home/me',
        sizeBytes: 3,
      };
      await methods.get('editor:openFile')?.({
        target: 'cursor',
        path: '/home/me/link.md',
        scope: 'external-link',
      });
      expect(openFile).toHaveBeenCalledWith(
        target,
        '/home/me/link.md',
        undefined,
      );
    });

    it.each([
      [
        'a deny-listed credential',
        { kind: 'rejected', reason: 'outside-roots' },
      ],
      ['a directory', { kind: 'directory', lexicalPath: '/home/me/dir' }],
    ])('refuses %s with fixed copy and never launches', async (_l, answer) => {
      externalResolution = answer;
      await expect(
        methods.get('editor:openFile')?.({
          target: 'cursor',
          path: '/home/me/x',
          scope: 'external-link',
        }),
      ).resolves.toEqual({
        success: false,
        error: 'That file cannot be opened from a link.',
      });
      expect(openFile).not.toHaveBeenCalled();
    });

    it('keeps the default scope on the workspace resolver', async () => {
      await methods.get('editor:openFile')?.({
        target: 'cursor',
        path: '/workspace/a.ts',
      });
      expect(resolveForExternalOpen).not.toHaveBeenCalled();
      expect(openFile).toHaveBeenCalled();
    });

    it('rejects an unknown scope value at the schema', async () => {
      const result = (await methods.get('editor:openFile')?.({
        target: 'cursor',
        path: '/workspace/a.ts',
        scope: 'anything',
      })) as { success: boolean };
      expect(result.success).toBe(false);
      expect(resolveForExternalOpen).not.toHaveBeenCalled();
      expect(openFile).not.toHaveBeenCalled();
    });
  });
});
