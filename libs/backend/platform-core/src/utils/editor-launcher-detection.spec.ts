import * as path from 'node:path';
import {
  createExecutableEditorDefinitions,
  detectEditorTargets,
  EDITOR_DESCRIPTORS,
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
    ]);
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

    expect(definitions).toHaveLength(EDITOR_DESCRIPTORS.length);
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
