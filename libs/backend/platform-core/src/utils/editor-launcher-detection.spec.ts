import * as path from 'node:path';
import {
  detectEditorTargets,
  editorExecutableCandidates,
  prepareEditorFileLaunch,
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
        {
          kind: 'application-marker' as const,
          path: '/apps/cursor',
          deepLinkScheme: 'cursor' as const,
        },
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

  it('detects a macOS application bundle as a deep-link target', async () => {
    const bundlePath = '/Applications/Cursor.app';
    const result = await detectEditorTargets(
      [
        {
          id: 'cursor',
          displayName: 'Cursor',
          command: 'cursor',
          installCandidates: [
            {
              kind: 'application-marker',
              path: bundlePath,
              deepLinkScheme: 'cursor',
            },
          ],
        },
      ],
      {
        env: { PATH: '' },
        platform: 'darwin',
        stat: jest.fn(async (candidate: string) => {
          if (candidate !== bundlePath) throw new Error('ENOENT');
          return { isFile: () => false, mode: 0o755 };
        }),
      },
    );

    expect(result).toEqual([
      {
        id: 'cursor',
        displayName: 'Cursor',
        deepLinkScheme: 'cursor',
      },
    ]);
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
});

describe('editor process launch', () => {
  it('builds conventional executable candidates for each operating system', () => {
    expect(
      editorExecutableCandidates('vscode', 'win32', {}, 'C:\\Users\\ptah'),
    ).toContain('C:\\Program Files\\Microsoft VS Code\\Code.exe');
    expect(
      editorExecutableCandidates('cursor', 'darwin', {}, '/Users/ptah'),
    ).toEqual([
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
    ]);
    expect(
      editorExecutableCandidates('zed', 'linux', {}, '/home/ptah'),
    ).toContain('/home/ptah/.local/bin/zed');
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

  it('reports a spawner that cannot start the detected executable', async () => {
    const executablePath = path.resolve('editors/code');
    const spawnProcess = jest.fn(() => ({ whenSpawned: Promise.resolve(null) }));

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
