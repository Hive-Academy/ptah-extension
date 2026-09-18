import * as path from 'node:path';
import {
  createExecutableEditorDefinitions,
  detectEditorTargets,
  EDITOR_DESCRIPTORS,
  EDITOR_PROBE_CONCURRENCY,
  EditorTargetCache,
  editorExecutableCandidates,
  prepareEditorFileLaunch,
  prepareEditorWorkspaceLaunch,
  spawnEditorProcess,
} from './editor-launcher-detection';

describe('detectEditorTargets', () => {
  const executableFile = {
    isFile: () => true,
    mode: 0o755,
  };
  const statFrom = (existing: ReadonlySet<string>) =>
    jest.fn(async (candidate: string) => {
      if (!existing.has(candidate)) throw new Error('ENOENT');
      return executableFile;
    });

  const definitions = [
    {
      id: 'vscode' as const,
      displayName: 'VS Code',
      command: 'code',
      installCandidates: [{ kind: 'executable' as const, path: '/apps/code' }],
    },
    {
      id: 'cursor' as const,
      displayName: 'Cursor',
      command: 'cursor',
      installCandidates: [
        { kind: 'executable' as const, path: '/apps/cursor' },
      ],
    },
  ];

  it('reports every PATH match before verified install-location matches', async () => {
    const existing = new Set(['/bin/cursor', '/apps/code']);
    const result = await detectEditorTargets(definitions, {
      env: { PATH: '/bin' },
      platform: 'linux',
      stat: statFrom(existing),
    });

    expect(result).toEqual([
      {
        id: 'cursor',
        displayName: 'Cursor',
        executablePath: '/bin/cursor',
      },
      {
        id: 'vscode',
        displayName: 'VS Code',
        executablePath: '/apps/code',
      },
    ]);
  });

  it('never reports an install location that does not exist', async () => {
    const result = await detectEditorTargets(definitions.slice(0, 1), {
      env: { PATH: '' },
      platform: 'linux',
      stat: jest.fn(async () => {
        throw new Error('ENOENT');
      }),
    });

    expect(result).toEqual([]);
  });

  it('rejects a plain directory that is declared as an executable', async () => {
    const result = await detectEditorTargets(definitions.slice(0, 1), {
      env: { PATH: '' },
      platform: 'linux',
      stat: jest.fn(async () => ({
        isFile: () => false,
        mode: 0o755,
      })),
    });

    expect(result).toEqual([]);
  });

  it('rejects a POSIX file without execute permission', async () => {
    const result = await detectEditorTargets(definitions.slice(0, 1), {
      env: { PATH: '' },
      platform: 'linux',
      stat: jest.fn(async () => ({
        isFile: () => true,
        mode: 0o644,
      })),
    });

    expect(result).toEqual([]);
  });

  it('rejects a Windows file without an executable extension', async () => {
    const result = await detectEditorTargets(
      [
        {
          id: 'vscode',
          displayName: 'VS Code',
          command: 'code',
          installCandidates: [
            { kind: 'executable', path: 'C:\\apps\\code.txt' },
          ],
        },
      ],
      {
        env: { PATH: '', PATHEXT: '.EXE;.CMD' },
        platform: 'win32',
        stat: jest.fn(async () => ({
          isFile: () => true,
          mode: 0o755,
        })),
      },
    );

    expect(result).toEqual([]);
  });

  it('rejects a Windows executable candidate that is not a file', async () => {
    const result = await detectEditorTargets(
      [
        {
          id: 'vscode',
          displayName: 'VS Code',
          command: 'code',
          installCandidates: [
            { kind: 'executable', path: 'C:\\apps\\Code.exe' },
          ],
        },
      ],
      {
        env: { PATH: '' },
        platform: 'win32',
        stat: jest.fn(async () => ({
          isFile: () => false,
          mode: 0o755,
        })),
      },
    );

    expect(result).toEqual([]);
  });

  it('honours Windows Path casing and configured PATHEXT entries', async () => {
    const executablePath = 'C:\\Tools\\code.CMD';
    const result = await detectEditorTargets(definitions.slice(0, 1), {
      env: { Path: 'C:\\Tools', PATHEXT: '.CMD' },
      platform: 'win32',
      stat: statFrom(new Set([executablePath])),
    });

    expect(result).toEqual([
      { id: 'vscode', displayName: 'VS Code', executablePath },
    ]);
  });
});

/**
 * TASK_2026_437 C14 (e): `editor:detectTargets` runs at boot. Its PATH probes
 * are bounded to 8 concurrent stats and its result is cached per PATH +
 * PATHEXT — but only a conclusive, successful detection is kept.
 */
describe('detectEditorTargets — bounded probes and cache', () => {
  const executable = { isFile: () => true, mode: 0o755 };
  const enoent = (): Error =>
    Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
  const codeDefinition = [
    {
      id: 'vscode' as const,
      displayName: 'VS Code',
      command: 'code',
      installCandidates: [] as { kind: 'executable'; path: string }[],
    },
  ];
  const manyDirs = Array.from({ length: 40 }, (_, i) => `/p${i}`).join(':');

  it('never runs more than EDITOR_PROBE_CONCURRENCY stats at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const probe = jest.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      throw enoent();
    });

    const result = await detectEditorTargets(definitionsFor(['code', 'zed']), {
      env: { PATH: manyDirs },
      platform: 'linux',
      stat: probe,
    });

    expect(result).toEqual([]);
    expect(probe).toHaveBeenCalledTimes(80);
    expect(EDITOR_PROBE_CONCURRENCY).toBe(8);
    expect(peak).toBe(EDITOR_PROBE_CONCURRENCY);
  });

  it('still reports the FIRST PATH match when a later directory answers sooner', async () => {
    const probe = jest.fn(async (candidate: string) => {
      if (candidate === '/p1/code') {
        // The earlier directory is slow; the later one is instant.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return executable;
      }
      if (candidate === '/p5/code') return executable;
      throw enoent();
    });

    const result = await detectEditorTargets(codeDefinition, {
      env: { PATH: manyDirs },
      platform: 'linux',
      stat: probe,
    });

    expect(result).toEqual([
      { id: 'vscode', displayName: 'VS Code', executablePath: '/p1/code' },
    ]);
    // Probes queued behind the match were skipped, not run.
    expect(probe.mock.calls.length).toBeLessThan(40);
  });

  it('caches a conclusive result per PATH + PATHEXT and probes again when either changes', async () => {
    const cache = new EditorTargetCache();
    const probe = jest.fn(async (candidate: string) => {
      if (candidate === 'C:\\Tools\\code.CMD') return executable;
      throw enoent();
    });
    const run = (env: Record<string, string>) =>
      detectEditorTargets(codeDefinition, {
        env,
        platform: 'win32',
        stat: probe,
        cache,
      });

    const first = await run({ PATH: 'C:\\Tools', PATHEXT: '.EXE;.CMD' });
    const callsAfterFirst = probe.mock.calls.length;
    const second = await run({ PATH: 'C:\\Tools', PATHEXT: '.EXE;.CMD' });
    expect(second).toEqual(first);
    expect(probe).toHaveBeenCalledTimes(callsAfterFirst);

    // A copy each time: a caller mutating its array cannot poison the cache.
    second.pop();
    expect(await run({ PATH: 'C:\\Tools', PATHEXT: '.EXE;.CMD' })).toHaveLength(
      1,
    );

    await run({ PATH: 'C:\\Tools', PATHEXT: '.CMD' });
    expect(probe.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    const callsAfterPathext = probe.mock.calls.length;
    await run({ PATH: 'C:\\Other;C:\\Tools', PATHEXT: '.CMD' });
    expect(probe.mock.calls.length).toBeGreaterThan(callsAfterPathext);
  });

  it('caches a conclusive EMPTY result (every probe proved absence)', async () => {
    const cache = new EditorTargetCache();
    const probe = jest.fn(async () => {
      throw enoent();
    });
    const options = {
      env: { PATH: '/a:/b' },
      platform: 'linux' as const,
      stat: probe,
      cache,
    };

    expect(await detectEditorTargets(codeDefinition, options)).toEqual([]);
    expect(await detectEditorTargets(codeDefinition, options)).toEqual([]);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('does not keep a result an inconclusive probe could have changed', async () => {
    const cache = new EditorTargetCache();
    let busy = true;
    const probe = jest.fn(async (candidate: string) => {
      if (candidate === '/net/code') {
        if (busy) {
          throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
        }
        return executable;
      }
      if (candidate === '/usr/bin/code') return executable;
      throw enoent();
    });
    const options = {
      env: { PATH: '/net:/usr/bin' },
      platform: 'linux' as const,
      stat: probe,
      cache,
    };

    // The busy mount hides the first match: the answer is served, not kept.
    expect(await detectEditorTargets(codeDefinition, options)).toEqual([
      { id: 'vscode', displayName: 'VS Code', executablePath: '/usr/bin/code' },
    ]);
    busy = false;
    expect(await detectEditorTargets(codeDefinition, options)).toEqual([
      { id: 'vscode', displayName: 'VS Code', executablePath: '/net/code' },
    ]);
    // Now conclusive: kept.
    const calls = probe.mock.calls.length;
    await detectEditorTargets(codeDefinition, options);
    expect(probe).toHaveBeenCalledTimes(calls);
  });

  it('keeps a result when the only inconclusive probe comes AFTER the chosen match', async () => {
    const cache = new EditorTargetCache();
    const probe = jest.fn(async (candidate: string) => {
      if (candidate === '/a/code') return executable;
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    });
    const options = {
      env: { PATH: '/a:/b' },
      platform: 'linux' as const,
      stat: probe,
      cache,
    };

    await detectEditorTargets(codeDefinition, options);
    const calls = probe.mock.calls.length;
    await detectEditorTargets(codeDefinition, options);
    expect(probe).toHaveBeenCalledTimes(calls);
  });

  it('does not keep a detection that rejected, and shares one in-flight detection', async () => {
    const cache = new EditorTargetCache();
    let broken = true;
    const probe = jest.fn(async () => ({
      mode: 0o755,
      isFile: () => {
        if (broken) throw new Error('stat object unusable');
        return true;
      },
    }));
    const options = {
      env: { PATH: '/a' },
      platform: 'linux' as const,
      stat: probe,
      cache,
    };

    const one = detectEditorTargets(codeDefinition, options);
    const two = detectEditorTargets(codeDefinition, options);
    await expect(one).rejects.toThrow('stat object unusable');
    await expect(two).rejects.toThrow('stat object unusable');
    expect(probe).toHaveBeenCalledTimes(1);

    broken = false;
    await expect(detectEditorTargets(codeDefinition, options)).resolves.toEqual(
      [{ id: 'vscode', displayName: 'VS Code', executablePath: '/a/code' }],
    );
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('keeps nothing for an injected stat without a cache, or with cache: null', async () => {
    const probe = jest.fn(async () => {
      throw enoent();
    });
    const base = {
      env: { PATH: '/a' },
      platform: 'linux' as const,
      stat: probe,
    };

    await detectEditorTargets(codeDefinition, base);
    await detectEditorTargets(codeDefinition, base);
    await detectEditorTargets(codeDefinition, { ...base, cache: null });
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it('clear() drops kept results', async () => {
    const cache = new EditorTargetCache();
    const probe = jest.fn(async () => {
      throw enoent();
    });
    const options = {
      env: { PATH: '/a' },
      platform: 'linux' as const,
      stat: probe,
      cache,
    };

    await detectEditorTargets(codeDefinition, options);
    cache.clear();
    await detectEditorTargets(codeDefinition, options);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  function definitionsFor(commands: readonly string[]) {
    const ids = { code: 'vscode', zed: 'zed' } as const;
    return commands.map((command) => ({
      id: ids[command as keyof typeof ids],
      displayName: command,
      command,
      installCandidates: [] as { kind: 'executable'; path: string }[],
    }));
  }
});

describe('editor process launch', () => {
  it('defines each supported editor identity and command once', () => {
    expect(EDITOR_DESCRIPTORS).toEqual([
      { id: 'vscode', displayName: 'VS Code', command: 'code' },
      { id: 'cursor', displayName: 'Cursor', command: 'cursor' },
      {
        id: 'antigravity',
        displayName: 'Antigravity',
        command: 'antigravity',
      },
      { id: 'zed', displayName: 'Zed', command: 'zed' },
      { id: 'kiro', displayName: 'Kiro', command: 'kiro' },
    ]);
  });

  it('detects Kiro from PATH and has no inferred install candidates', async () => {
    const definitions = createExecutableEditorDefinitions(
      'linux',
      {},
      '/home/ptah',
    );
    const kiro = definitions.find(({ id }) => id === 'kiro');
    expect(kiro?.installCandidates).toEqual([]);
    await expect(
      detectEditorTargets(definitions, {
        env: { PATH: '/tools' },
        platform: 'linux',
        stat: jest.fn(async (candidate: string) => {
          if (candidate !== '/tools/kiro') throw new Error('ENOENT');
          return { isFile: () => true, mode: 0o755 };
        }),
      }),
    ).resolves.toContainEqual({
      id: 'kiro',
      displayName: 'Kiro',
      executablePath: '/tools/kiro',
    });
  });

  it('builds conventional Windows candidates from environment and defaults', () => {
    expect(
      editorExecutableCandidates(
        'vscode',
        'win32',
        {
          LOCALAPPDATA: 'D:\\Local',
          ProgramFiles: 'E:\\Programs',
        },
        'C:\\Users\\ptah',
      ),
    ).toEqual([
      'D:\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      'E:\\Programs\\Microsoft VS Code\\Code.exe',
    ]);
    expect(
      editorExecutableCandidates('cursor', 'win32', {}, 'C:\\Users\\ptah'),
    ).toEqual([
      'C:\\Users\\ptah\\AppData\\Local\\Programs\\Cursor\\Cursor.exe',
      'C:\\Program Files\\Cursor\\Cursor.exe',
    ]);
  });

  it('builds conventional macOS CLI candidates inside application bundles', () => {
    expect(
      editorExecutableCandidates('cursor', 'darwin', {}, '/Users/ptah'),
    ).toEqual(['/Applications/Cursor.app/Contents/Resources/app/bin/cursor']);
    expect(
      editorExecutableCandidates('zed', 'darwin', {}, '/Users/ptah'),
    ).toEqual(['/Applications/Zed.app/Contents/MacOS/cli']);
  });

  it('creates executable-only definitions for every supported editor', () => {
    const definitions = createExecutableEditorDefinitions(
      'linux',
      {},
      '/home/ptah',
    );

    expect(definitions).toHaveLength(EDITOR_DESCRIPTORS.length + 1);
    expect(definitions[definitions.length - 1]).toMatchObject({
      id: 'terminal',
      displayName: 'Terminal',
      command: 'x-terminal-emulator',
    });
    expect(
      definitions.flatMap(({ installCandidates }) => installCandidates),
    ).toEqual(
      expect.arrayContaining([
        { kind: 'executable', path: '/home/ptah/.local/bin/code' },
        { kind: 'executable', path: '/usr/local/bin/cursor' },
        { kind: 'executable', path: '/usr/bin/zed' },
      ]),
    );
  });

  it('prepares editor-specific argv without constructing a shell command', () => {
    const filePath = path.resolve('workspace/file.ts');
    expect(
      prepareEditorFileLaunch(
        { id: 'zed', displayName: 'Zed', executablePath: '/editors/zed' },
        filePath,
        5,
      ),
    ).toEqual({
      normalizedPath: filePath,
      args: [`${filePath}:5`],
      cwd: path.dirname(filePath),
    });
  });

  it('prepares VS Code argv without a line suffix when no line is requested', () => {
    const filePath = path.resolve('workspace/file.ts');

    expect(
      prepareEditorFileLaunch(
        {
          id: 'vscode',
          displayName: 'VS Code',
          executablePath: '/editors/code',
        },
        filePath,
      ),
    ).toEqual({
      normalizedPath: filePath,
      args: ['-g', filePath],
      cwd: path.dirname(filePath),
    });
  });

  it('lists the terminal only when one of its launchers exists', async () => {
    const definitions = createExecutableEditorDefinitions(
      'linux',
      {},
      '/home/ptah',
    );
    const noTerminal = await detectEditorTargets(definitions, {
      env: { PATH: '/tools' },
      platform: 'linux',
      cache: null,
      stat: jest.fn(async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }),
    });
    expect(noTerminal.some(({ id }) => id === 'terminal')).toBe(false);

    const withKonsole = await detectEditorTargets(definitions, {
      env: { PATH: '/tools' },
      platform: 'linux',
      cache: null,
      stat: jest.fn(async (candidate: string) => {
        if (candidate !== '/usr/bin/konsole')
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return { isFile: () => true, mode: 0o755 };
      }),
    });
    expect(withKonsole).toEqual([
      {
        id: 'terminal',
        displayName: 'Terminal',
        executablePath: '/usr/bin/konsole',
      },
    ]);
  });

  it('refuses to open a file with the terminal target', () => {
    expect(() =>
      prepareEditorFileLaunch(
        {
          id: 'terminal',
          displayName: 'Terminal',
          executablePath: '/usr/bin/xterm',
        },
        path.resolve('workspace/a.ts'),
      ),
    ).toThrow('Terminal cannot open a file');
  });

  it('rejects relative file and workspace paths and invalid line numbers', () => {
    const target = {
      id: 'vscode' as const,
      displayName: 'VS Code',
      executablePath: '/editors/code',
    };
    const filePath = path.resolve('workspace/file.ts');

    expect(() => prepareEditorFileLaunch(target, 'relative.ts')).toThrow(
      'File path must be absolute',
    );
    expect(() => prepareEditorWorkspaceLaunch('relative')).toThrow(
      'Workspace root must be absolute',
    );
    expect(() => prepareEditorFileLaunch(target, filePath, 0)).toThrow(
      'Line must be a positive integer',
    );
    expect(() => prepareEditorFileLaunch(target, filePath, 1.5)).toThrow(
      'Line must be a positive integer',
    );
  });

  it('prepares workspace argv and cwd from the normalized root', () => {
    const workspaceRoot = path.resolve('workspace', '..', 'workspace');

    expect(prepareEditorWorkspaceLaunch(workspaceRoot)).toEqual({
      normalizedRoot: path.normalize(workspaceRoot),
      args: [path.normalize(workspaceRoot)],
      cwd: path.normalize(workspaceRoot),
    });
  });

  it('resolves after the detected executable starts successfully', async () => {
    const executablePath = path.resolve('editors/code');
    const spawnProcess = jest.fn(() => ({
      whenSpawned: Promise.resolve(123),
    }));

    await expect(
      spawnEditorProcess(
        { spawnProcess } as never,
        { id: 'vscode', displayName: 'VS Code', executablePath },
        ['-g', '/workspace/file.ts'],
        '/workspace',
      ),
    ).resolves.toBeUndefined();
    expect(spawnProcess).toHaveBeenCalledWith({
      command: executablePath,
      args: ['-g', '/workspace/file.ts'],
      cwd: '/workspace',
      env: process.env,
      detached: process.platform !== 'win32',
      needsConsole: false,
    });
  });

  it('reports a spawner that cannot start the detected executable', async () => {
    const executablePath = path.resolve('editors/code');
    const spawnProcess = jest.fn(() => ({
      whenSpawned: Promise.resolve(null),
    }));

    await expect(
      spawnEditorProcess(
        { spawnProcess } as never,
        { id: 'vscode', displayName: 'VS Code', executablePath },
        ['-g', '/workspace/file.ts'],
        '/workspace',
      ),
    ).rejects.toThrow('Failed to launch VS Code');
    expect(spawnProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        command: executablePath,
        args: ['-g', '/workspace/file.ts'],
      }),
    );
  });
});
