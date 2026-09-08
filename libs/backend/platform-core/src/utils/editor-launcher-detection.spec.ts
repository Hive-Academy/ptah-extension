import { detectEditorTargets } from './editor-launcher-detection';

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
      installCandidates: [{ path: '/apps/code' }],
    },
    {
      id: 'cursor' as const,
      displayName: 'Cursor',
      command: 'cursor',
      installCandidates: [
        { path: '/apps/cursor', deepLinkScheme: 'cursor' as const },
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
    const result = await detectEditorTargets(definitions, {
      env: { PATH: '' },
      platform: 'linux',
      stat: jest.fn(async () => {
        throw new Error('ENOENT');
      }),
    });

    expect(result).toEqual([]);
  });

  it('returns a verified deep-link fallback without inventing an executable', async () => {
    const result = await detectEditorTargets(definitions, {
      env: { PATH: '' },
      platform: 'linux',
      stat: statFrom(new Set(['/apps/cursor'])),
    });

    expect(result).toEqual([
      {
        id: 'cursor',
        displayName: 'Cursor',
        deepLinkScheme: 'cursor',
      },
    ]);
  });

  it('rejects a directory candidate', async () => {
    const result = await detectEditorTargets(definitions, {
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
    const result = await detectEditorTargets(definitions, {
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
          installCandidates: [{ path: 'C:\\apps\\code.txt' }],
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
