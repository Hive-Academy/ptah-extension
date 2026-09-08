import { detectEditorTargets } from './editor-launcher-detection';

describe('detectEditorTargets', () => {
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
      exists: async (candidate) => existing.has(candidate),
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
      exists: async () => false,
    });

    expect(result).toEqual([]);
  });

  it('returns a verified deep-link fallback without inventing an executable', async () => {
    const result = await detectEditorTargets(definitions, {
      env: { PATH: '' },
      platform: 'linux',
      exists: async (candidate) => candidate === '/apps/cursor',
    });

    expect(result).toEqual([
      {
        id: 'cursor',
        displayName: 'Cursor',
        deepLinkScheme: 'cursor',
      },
    ]);
  });
});
