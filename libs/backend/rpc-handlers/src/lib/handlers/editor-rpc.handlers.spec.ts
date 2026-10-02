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
  const warn = jest.fn();

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
      { warn } as never,
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
      {} as never,
    ).register();
  });

  it('returns only detected targets', async () => {
    await expect(methods.get('editor:detectTargets')?.({})).resolves.toEqual({
      success: true,
      targets: [target],
    });
  });

  /**
   * LOW-1. A spawn failure carries the resolved executable path and an OS
   * errno string. The renderer gets a fixed sentence; the real error is only
   * ever logged.
   */
  it('returns fixed copy and logs the real error when a launch throws', async () => {
    openFile.mockRejectedValueOnce(
      new Error('spawn C:\\Users\\me\\AppData\\Cursor.exe ENOENT') as never,
    );

    const result = (await methods.get('editor:openFile')?.({
      target: 'cursor',
      path: '/workspace/a.ts',
    })) as { success: boolean; error?: string };

    expect(result).toEqual({
      success: false,
      error: 'Could not launch the requested editor.',
    });
    expect(result.error).not.toContain('AppData');
    expect(warn).toHaveBeenCalledWith(
      '[editor RPC] launch failed',
      expect.any(Error),
    );
  });

  it('returns fixed copy when detection throws', async () => {
    detect.mockRejectedValueOnce(
      new Error('EACCES /usr/local/bin/cursor') as never,
    );

    await expect(methods.get('editor:detectTargets')?.({})).resolves.toEqual({
      success: false,
      targets: [],
      error: 'Could not detect installed editors.',
    });
    expect(warn).toHaveBeenCalledWith(
      '[editor RPC] detection failed',
      expect.any(Error),
    );
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

  describe("target 'terminal'", () => {
    const terminal = {
      id: 'terminal' as const,
      displayName: 'Terminal',
      executablePath: '/usr/bin/x-terminal-emulator',
    };

    it('opens a terminal at an authorized workspace root', async () => {
      detect.mockResolvedValueOnce([target, terminal] as never);

      await expect(
        methods.get('editor:openWorkspace')?.({
          target: 'terminal',
          root: '/workspace',
        }),
      ).resolves.toEqual({ success: true });
      expect(openWorkspace).toHaveBeenCalledWith(terminal, '/workspace');
    });

    it('answers a failed launch with fixed copy, never a retry loop', async () => {
      detect.mockResolvedValueOnce([target, terminal] as never);
      openWorkspace.mockRejectedValueOnce(new Error('wt failed') as never);

      await expect(
        methods.get('editor:openWorkspace')?.({
          target: 'terminal',
          root: '/workspace',
        }),
      ).resolves.toEqual({
        success: false,
        error: 'Could not launch the requested editor.',
      });

      // Detection yields at most one target per id; the candidate fallback
      // lives in spawnTerminalProcess (platform-core), not here.
      expect(openWorkspace).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[editor RPC] launch failed',
        expect.any(Error),
      );
    });

    it('refuses a root outside the workspace before launching', async () => {
      await expect(
        methods.get('editor:openWorkspace')?.({
          target: 'terminal',
          root: '/etc',
        }),
      ).resolves.toEqual({
        success: false,
        error: 'Workspace root is outside the workspace',
      });
      expect(openWorkspace).not.toHaveBeenCalled();
    });

    it('answers openFile with an error result, never a launch', async () => {
      await expect(
        methods.get('editor:openFile')?.({
          target: 'terminal',
          path: '/workspace/a.ts',
        }),
      ).resolves.toEqual({
        success: false,
        error: 'A terminal cannot open a file.',
      });
      expect(openFile).not.toHaveBeenCalled();
      expect(detect).not.toHaveBeenCalled();
    });
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

describe('EditorRpcHandlers editor:openMerge', () => {
  const vscode = {
    id: 'vscode' as const,
    displayName: 'VS Code',
    executablePath: 'C:\\Users\\me\\AppData\\Local\\Programs\\code.cmd',
  };
  const cursor = {
    id: 'cursor' as const,
    displayName: 'Cursor',
    executablePath: '/bin/cursor',
  };
  const STAGES = {
    status: 'ok' as const,
    base: 'C:\\repo\\.git\\ptah-merge\\h\\base',
    local: 'C:\\repo\\.git\\ptah-merge\\h\\local',
    remote: 'C:\\repo\\.git\\ptah-merge\\h\\remote',
    result: 'C:\\repo\\src\\a.ts',
  };

  const detect = jest.fn();
  const openMergeTool = jest.fn();
  const materializeConflictStages = jest.fn();
  const warn = jest.fn();

  function register(
    launcher: Record<string, unknown>,
  ): (params: unknown) => Promise<unknown> {
    const methods = new Map<string, (params: unknown) => Promise<unknown>>();
    new EditorRpcHandlers(
      { warn } as never,
      {
        registerMethod: (
          name: string,
          handler: (params: unknown) => Promise<unknown>,
        ) => methods.set(name, handler),
      } as never,
      launcher as never,
      {
        getWorkspaceFolders: () => ['C:\\repo', '/other'],
        getWorkspaceRoot: () => 'C:\\repo',
      } as never,
      {} as never,
      {} as never,
      { materializeConflictStages } as never,
    ).register();
    const handler = methods.get('editor:openMerge');
    if (!handler) throw new Error('editor:openMerge was not registered');
    return handler;
  }

  const fullLauncher = (): Record<string, unknown> => ({
    detect,
    openFile: jest.fn(),
    openWorkspace: jest.fn(),
    openMergeTool,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    detect.mockResolvedValue([vscode, cursor]);
    openMergeTool.mockResolvedValue({ status: 'launched' });
    materializeConflictStages.mockResolvedValue(STAGES);
  });

  it('is owned by the editor handler', () => {
    expect(EditorRpcHandlers.METHODS).toContain('editor:openMerge');
  });

  it('materializes the stages and launches the merge view for a mergeArgs target', async () => {
    const openMerge = register(fullLauncher());

    const result = await openMerge({
      target: 'vscode',
      path: 'src/a.ts',
      workspaceRoot: 'C:/repo/',
    });

    expect(result).toEqual({ status: 'ok' });
    // The registered folder's own spelling, not the caller's.
    expect(materializeConflictStages).toHaveBeenCalledWith(
      'C:\\repo',
      'src/a.ts',
    );
    expect(openMergeTool).toHaveBeenCalledWith(vscode, {
      local: STAGES.local,
      remote: STAGES.remote,
      base: STAGES.base,
      result: STAGES.result,
    });
    // Absolute stage paths never reach the renderer.
    expect(JSON.stringify(result)).not.toContain('ptah-merge');
  });

  it('uses the active workspace folder when none is named', async () => {
    await register(fullLauncher())({ target: 'vscode', path: 'src/a.ts' });

    expect(materializeConflictStages).toHaveBeenCalledWith(
      'C:\\repo',
      'src/a.ts',
    );
  });

  it.each(['cursor', 'antigravity', 'zed', 'kiro', 'terminal'] as const)(
    'A11: answers unsupported for %s (no mergeArgs) without materializing stages',
    async (targetId) => {
      const result = await register(fullLauncher())({
        target: targetId,
        path: 'src/a.ts',
      });

      expect(result).toEqual({ status: 'unsupported' });
      expect(materializeConflictStages).not.toHaveBeenCalled();
      expect(detect).not.toHaveBeenCalled();
      expect(openMergeTool).not.toHaveBeenCalled();
    },
  );

  it('A11: answers unsupported when the host launcher has no openMergeTool', async () => {
    const launcher = fullLauncher();
    delete launcher['openMergeTool'];

    const result = await register(launcher)({
      target: 'vscode',
      path: 'src/a.ts',
    });

    expect(result).toEqual({ status: 'unsupported' });
    expect(materializeConflictStages).not.toHaveBeenCalled();
  });

  it('passes an unsupported launcher answer through', async () => {
    openMergeTool.mockResolvedValueOnce({ status: 'unsupported' });

    await expect(
      register(fullLauncher())({ target: 'vscode', path: 'src/a.ts' }),
    ).resolves.toEqual({ status: 'unsupported' });
  });

  it.each([
    ['an unknown key', { target: 'vscode', path: 'a.ts', tool: 'meld' }],
    ['a missing path', { target: 'vscode' }],
    ['an empty path', { target: 'vscode', path: '' }],
    ['an unknown target', { target: 'notepad', path: 'a.ts' }],
    [
      'an empty workspaceRoot',
      { target: 'vscode', path: 'a.ts', workspaceRoot: '' },
    ],
    ['no params', undefined],
  ])('refuses %s at the schema', async (_label, params) => {
    await expect(register(fullLauncher())(params)).resolves.toEqual({
      status: 'failed',
      reason: 'invalid-params',
      error: 'Invalid editor:openMerge params.',
    });
    expect(materializeConflictStages).not.toHaveBeenCalled();
    expect(openMergeTool).not.toHaveBeenCalled();
  });

  it('never acts on an unregistered workspace folder', async () => {
    const result = await register(fullLauncher())({
      target: 'vscode',
      path: 'a.ts',
      workspaceRoot: '/somewhere/else',
    });

    expect(result).toMatchObject({ status: 'failed', reason: 'failed' });
    expect(materializeConflictStages).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('answers not-installed without writing stages when the target is not detected', async () => {
    detect.mockResolvedValueOnce([cursor]);

    await expect(
      register(fullLauncher())({ target: 'vscode', path: 'a.ts' }),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'not-installed',
      error: 'Editor target is not installed',
    });
    expect(materializeConflictStages).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid-path', { status: 'invalid-path' }],
    ['no-operation', { status: 'no-operation' }],
    ['not-conflicted', { status: 'not-conflicted' }],
    ['not-mergeable', { status: 'not-mergeable', conflictKind: 'symlink' }],
  ] as const)(
    'maps a %s stage answer to a typed failure without launching',
    async (reason, stages) => {
      materializeConflictStages.mockResolvedValueOnce(stages);

      const result = await register(fullLauncher())({
        target: 'vscode',
        path: 'a.ts',
      });

      expect(result).toMatchObject({ status: 'failed', reason });
      expect(openMergeTool).not.toHaveBeenCalled();
    },
  );

  it('keeps a stage-write failure message in the log, not the result', async () => {
    materializeConflictStages.mockResolvedValueOnce({
      status: 'failed',
      error: 'Could not write C:\\repo\\.git\\ptah-merge\\h',
    });

    const result = await register(fullLauncher())({
      target: 'vscode',
      path: 'a.ts',
    });

    expect(result).toEqual({
      status: 'failed',
      reason: 'failed',
      error: 'Could not open the merge view.',
    });
    expect(JSON.stringify(result)).not.toContain('ptah-merge');
    expect(warn).toHaveBeenCalled();
    expect(openMergeTool).not.toHaveBeenCalled();
  });

  it('sanitizes a failed launch: fixed copy out, raw error to the log', async () => {
    const raw = new Error('spawn C:\\Users\\me\\AppData\\code.cmd ENOENT');
    openMergeTool.mockResolvedValueOnce({ status: 'failed', error: raw });

    const result = await register(fullLauncher())({
      target: 'vscode',
      path: 'a.ts',
    });

    expect(result).toEqual({
      status: 'failed',
      reason: 'failed',
      error: 'Could not open the merge view.',
    });
    expect(JSON.stringify(result)).not.toContain('AppData');
    expect(warn).toHaveBeenCalledWith('[editor RPC] merge launch failed', raw);
  });

  it('sanitizes a throw from detection or the service', async () => {
    materializeConflictStages.mockRejectedValueOnce(
      new Error('EACCES C:\\repo\\.git'),
    );

    const result = await register(fullLauncher())({
      target: 'vscode',
      path: 'a.ts',
    });

    expect(result).toEqual({
      status: 'failed',
      reason: 'failed',
      error: 'Could not open the merge view.',
    });
    expect(warn).toHaveBeenCalledWith(
      '[editor RPC] merge launch failed',
      expect.any(Error),
    );
  });
});
