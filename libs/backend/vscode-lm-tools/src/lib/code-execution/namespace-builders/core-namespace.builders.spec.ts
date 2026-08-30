/**
 * Specs for core namespace builders.
 *
 * Covers the three builders that sit directly under `ptah.*`:
 *   - buildWorkspaceNamespace → ptah.workspace
 *   - buildSearchNamespace    → ptah.search
 *   - buildDiagnosticsNamespace → ptah.diagnostics
 */

// The SUT imports `DEFAULT_WORKSPACE_EXCLUDES` as a value from
// `@ptah-extension/workspace-intelligence`, which transitively loads
// `vscode-core` → `tsyringe`. Mock the barrel at the boundary so only the
// symbols our SUT reads are materialized. Mirrors the pattern used by
// `ast-namespace.builder.spec.ts`.
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  DEFAULT_WORKSPACE_EXCLUDES: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.git/**',
    '**/build/**',
  ],
}));

import 'reflect-metadata';

import type {
  WorkspaceAnalyzerService,
  ContextOrchestrationService,
} from '@ptah-extension/workspace-intelligence';
import type {
  IDiagnosticsProvider,
  IWorkspaceProvider,
  IFileSystemProvider,
  DiagnosticsResult,
} from '@ptah-extension/platform-core';
import {
  buildWorkspaceNamespace,
  buildSearchNamespace,
  buildDiagnosticsNamespace,
  type CoreNamespaceDependencies,
} from './core-namespace.builders';

// ---------------------------------------------------------------------------
// Helpers — typed partial mocks
// ---------------------------------------------------------------------------

interface WorkspaceAnalyzerMock {
  getCurrentWorkspaceInfo: jest.Mock;
  analyzeWorkspaceStructure: jest.Mock;
  getProjectInfo: jest.Mock;
}

interface ContextOrchestrationMock {
  searchFiles: jest.Mock;
  getFileSuggestions: jest.Mock;
}

function createWorkspaceAnalyzerMock(): WorkspaceAnalyzerMock {
  return {
    getCurrentWorkspaceInfo: jest.fn(),
    analyzeWorkspaceStructure: jest.fn(),
    getProjectInfo: jest.fn(),
  };
}

function createContextOrchestrationMock(): ContextOrchestrationMock {
  return {
    searchFiles: jest.fn(),
    getFileSuggestions: jest.fn(),
  };
}

function createWorkspaceProviderMock(
  root: string | undefined = undefined,
): jest.Mocked<IWorkspaceProvider> {
  return {
    getWorkspaceFolders: jest.fn().mockReturnValue(root ? [root] : []),
    getWorkspaceRoot: jest.fn().mockReturnValue(root),
    getConfiguration: jest.fn(),
    setConfiguration: jest.fn(),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as jest.Mocked<IWorkspaceProvider>;
}

function createFileSystemProviderMock(
  findFilesResult: string[] = [],
): jest.Mocked<IFileSystemProvider> {
  return {
    findFiles: jest.fn().mockResolvedValue(findFilesResult),
    readFile: jest.fn(),
    readFileBytes: jest.fn(),
    writeFile: jest.fn(),
    writeFileBytes: jest.fn(),
    deleteFile: jest.fn(),
    stat: jest.fn(),
    readDirectory: jest.fn(),
    createDirectory: jest.fn(),
    rename: jest.fn(),
    copy: jest.fn(),
    exists: jest.fn(),
    createFileWatcher: jest.fn(),
  } as unknown as jest.Mocked<IFileSystemProvider>;
}

function createDeps(
  workspaceAnalyzer: WorkspaceAnalyzerMock,
  contextOrchestration: ContextOrchestrationMock,
  workspaceProvider: IWorkspaceProvider = createWorkspaceProviderMock(),
  fileSystemProvider: IFileSystemProvider = createFileSystemProviderMock(),
): CoreNamespaceDependencies {
  return {
    workspaceAnalyzer: workspaceAnalyzer as unknown as WorkspaceAnalyzerService,
    contextOrchestration:
      contextOrchestration as unknown as ContextOrchestrationService,
    workspaceProvider,
    fileSystemProvider,
  };
}

// ---------------------------------------------------------------------------
// buildWorkspaceNamespace
// ---------------------------------------------------------------------------

describe('buildWorkspaceNamespace', () => {
  it('returns an object exposing the documented WorkspaceNamespace shape', () => {
    const deps = createDeps(
      createWorkspaceAnalyzerMock(),
      createContextOrchestrationMock(),
    );
    const ns = buildWorkspaceNamespace(deps);
    expect(typeof ns.analyze).toBe('function');
    expect(typeof ns.getInfo).toBe('function');
    expect(typeof ns.getProjectType).toBe('function');
    expect(typeof ns.getFrameworks).toBe('function');
  });

  it('analyze() parallelises info/structure/projectInfo and merges results', async () => {
    const analyzer = createWorkspaceAnalyzerMock();
    const info = { projectType: 'node', frameworks: ['nestjs'] } as never;
    const structure = { folders: 3 } as never;
    const projectInfo = { name: 'ptah' } as never;

    analyzer.getCurrentWorkspaceInfo.mockResolvedValue(info);
    analyzer.analyzeWorkspaceStructure.mockResolvedValue(structure);
    analyzer.getProjectInfo.mockResolvedValue(projectInfo);

    const ns = buildWorkspaceNamespace(
      createDeps(analyzer, createContextOrchestrationMock()),
    );
    const result = await ns.analyze();

    expect(result).toEqual({ info, structure, projectInfo });
  });

  it('analyze() degrades projectInfo to undefined when getProjectInfo rejects', async () => {
    const analyzer = createWorkspaceAnalyzerMock();
    analyzer.getCurrentWorkspaceInfo.mockResolvedValue(undefined);
    analyzer.analyzeWorkspaceStructure.mockResolvedValue(null as never);
    analyzer.getProjectInfo.mockRejectedValue(new Error('no project'));

    const ns = buildWorkspaceNamespace(
      createDeps(analyzer, createContextOrchestrationMock()),
    );
    const result = await ns.analyze();

    expect(result.projectInfo).toBeUndefined();
  });

  it('getProjectType() returns "unknown" when info is missing', async () => {
    const analyzer = createWorkspaceAnalyzerMock();
    analyzer.getCurrentWorkspaceInfo.mockResolvedValueOnce(undefined);
    analyzer.getCurrentWorkspaceInfo.mockResolvedValueOnce({} as never);

    const ns = buildWorkspaceNamespace(
      createDeps(analyzer, createContextOrchestrationMock()),
    );

    expect(await ns.getProjectType()).toBe('unknown');
    expect(await ns.getProjectType()).toBe('unknown');
  });

  it('getProjectType() returns analyzer-provided value when present', async () => {
    const analyzer = createWorkspaceAnalyzerMock();
    analyzer.getCurrentWorkspaceInfo.mockResolvedValue({
      projectType: 'angular',
    } as never);

    const ns = buildWorkspaceNamespace(
      createDeps(analyzer, createContextOrchestrationMock()),
    );

    expect(await ns.getProjectType()).toBe('angular');
  });

  it('analyze() passes the session-aware root into all three analyzer calls', async () => {
    const analyzer = createWorkspaceAnalyzerMock();
    analyzer.getCurrentWorkspaceInfo.mockResolvedValue(undefined);
    analyzer.analyzeWorkspaceStructure.mockResolvedValue(null as never);
    analyzer.getProjectInfo.mockResolvedValue(undefined);

    const ns = buildWorkspaceNamespace(
      createDeps(
        analyzer,
        createContextOrchestrationMock(),
        createWorkspaceProviderMock('D:\\projects\\session-root'),
      ),
    );

    await ns.analyze();

    expect(analyzer.getCurrentWorkspaceInfo).toHaveBeenCalledWith(
      'D:\\projects\\session-root',
    );
    expect(analyzer.analyzeWorkspaceStructure).toHaveBeenCalledWith(
      'D:\\projects\\session-root',
    );
  });

  it('resolves the root per call, not once at build time', async () => {
    const analyzer = createWorkspaceAnalyzerMock();
    analyzer.getCurrentWorkspaceInfo.mockResolvedValue(undefined);

    const provider = createWorkspaceProviderMock();
    (provider.getWorkspaceRoot as jest.Mock)
      .mockReturnValueOnce('D:\\projects\\session-a')
      .mockReturnValueOnce('D:\\projects\\session-b');

    const ns = buildWorkspaceNamespace(
      createDeps(analyzer, createContextOrchestrationMock(), provider),
    );

    await ns.getInfo();
    await ns.getInfo();

    expect(analyzer.getCurrentWorkspaceInfo.mock.calls).toEqual([
      ['D:\\projects\\session-a'],
      ['D:\\projects\\session-b'],
    ]);
  });

  it('getFrameworks() returns a fresh array copy and empty array when missing', async () => {
    const analyzer = createWorkspaceAnalyzerMock();
    const frameworks = ['react', 'next'];
    analyzer.getCurrentWorkspaceInfo.mockResolvedValueOnce({
      frameworks,
    } as never);
    analyzer.getCurrentWorkspaceInfo.mockResolvedValueOnce(undefined);

    const ns = buildWorkspaceNamespace(
      createDeps(analyzer, createContextOrchestrationMock()),
    );

    const first = await ns.getFrameworks();
    expect(first).toEqual(frameworks);
    expect(first).not.toBe(frameworks);
    expect(await ns.getFrameworks()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildSearchNamespace — true glob (TASK_2026_299)
// ---------------------------------------------------------------------------

describe('buildSearchNamespace', () => {
  it('exposes findFiles and getRelevantFiles methods', () => {
    const ns = buildSearchNamespace(
      createDeps(
        createWorkspaceAnalyzerMock(),
        createContextOrchestrationMock(),
      ),
    );
    expect(typeof ns.findFiles).toBe('function');
    expect(typeof ns.getRelevantFiles).toBe('function');
  });

  it('findFiles() delegates to fileSystemProvider.findFiles (true glob, not fuzzy)', async () => {
    const fsProvider = createFileSystemProviderMock([
      'D:/workspace/src/a.ts',
      'D:/workspace/src/b.ts',
    ]);
    const provider = createWorkspaceProviderMock('D:/workspace');

    const ns = buildSearchNamespace(
      createDeps(
        createWorkspaceAnalyzerMock(),
        createContextOrchestrationMock(),
        provider,
        fsProvider,
      ),
    );

    const paths = await ns.findFiles('src/**/*.ts', 50);

    expect(fsProvider.findFiles).toHaveBeenCalledTimes(1);
    const call = fsProvider.findFiles.mock.calls[0];
    expect(call[0]).toBe('src/**/*.ts');
    expect(call[2]).toBe(50);
    expect(call[3]).toBe('D:/workspace'); // session root as cwd
    // Results normalized to workspace-relative.
    expect(paths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('findFiles() defaults limit to 20 when not provided', async () => {
    const fsProvider = createFileSystemProviderMock([]);

    const ns = buildSearchNamespace(
      createDeps(
        createWorkspaceAnalyzerMock(),
        createContextOrchestrationMock(),
        createWorkspaceProviderMock(),
        fsProvider,
      ),
    );

    await ns.findFiles('anything');
    expect(fsProvider.findFiles.mock.calls[0][2]).toBe(20);
  });

  it('findFiles() passes the session root as cwd', async () => {
    const fsProvider = createFileSystemProviderMock([]);

    const ns = buildSearchNamespace(
      createDeps(
        createWorkspaceAnalyzerMock(),
        createContextOrchestrationMock(),
        createWorkspaceProviderMock('D:/projects/session-root'),
        fsProvider,
      ),
    );

    await ns.findFiles('pattern');
    expect(fsProvider.findFiles.mock.calls[0][3]).toBe(
      'D:/projects/session-root',
    );
  });

  it('findFiles() returns [] for zero matches (success, not error)', async () => {
    const fsProvider = createFileSystemProviderMock([]);

    const ns = buildSearchNamespace(
      createDeps(
        createWorkspaceAnalyzerMock(),
        createContextOrchestrationMock(),
        createWorkspaceProviderMock(),
        fsProvider,
      ),
    );

    await expect(ns.findFiles('**/nonexistent*.ts')).resolves.toEqual([]);
  });

  it('findFiles() propagates errors (does NOT swallow to [])', async () => {
    const fsProvider = createFileSystemProviderMock();
    fsProvider.findFiles.mockRejectedValue(new Error('filesystem error'));

    const ns = buildSearchNamespace(
      createDeps(
        createWorkspaceAnalyzerMock(),
        createContextOrchestrationMock(),
        createWorkspaceProviderMock(),
        fsProvider,
      ),
    );

    await expect(ns.findFiles('pattern')).rejects.toThrow('filesystem error');
  });

  it('findFiles() normalizes absolute paths to workspace-relative with forward slashes', async () => {
    const fsProvider = createFileSystemProviderMock([
      'D:\\workspace\\src\\a.ts',
      'D:\\workspace\\lib\\b.ts',
    ]);
    const provider = createWorkspaceProviderMock('D:\\workspace');

    const ns = buildSearchNamespace(
      createDeps(
        createWorkspaceAnalyzerMock(),
        createContextOrchestrationMock(),
        provider,
        fsProvider,
      ),
    );

    const paths = await ns.findFiles('**/*.ts');
    expect(paths).toEqual(['src/a.ts', 'lib/b.ts']);
  });

  it('getRelevantFiles() delegates to contextOrchestration (fuzzy) and propagates failures', async () => {
    const orchestration = createContextOrchestrationMock();
    orchestration.getFileSuggestions.mockResolvedValue({
      success: true,
      files: [{ relativePath: 'lib/x.ts' }, { relativePath: 'lib/y.ts' }],
    } as never);

    const ns = buildSearchNamespace(
      createDeps(createWorkspaceAnalyzerMock(), orchestration),
    );

    const out = await ns.getRelevantFiles('authentication', 3);

    expect(out).toEqual(['lib/x.ts', 'lib/y.ts']);
    const call = orchestration.getFileSuggestions.mock.calls[0][0];
    expect(call.query).toBe('authentication');
    expect(call.limit).toBe(3);
  });

  it('getRelevantFiles() propagates errors (does NOT swallow to [])', async () => {
    const orchestration = createContextOrchestrationMock();
    orchestration.getFileSuggestions.mockRejectedValue(new Error('fuzzy fail'));

    const ns = buildSearchNamespace(
      createDeps(createWorkspaceAnalyzerMock(), orchestration),
    );

    await expect(ns.getRelevantFiles('q')).rejects.toThrow('fuzzy fail');
  });

  it('EXPECTED RED (Batch 8 finding #3) — getRelevantFiles() rejects when contextOrchestration resolves { success: false } (does NOT swallow to [])', async () => {
    // `core-namespace.builders.ts:162` reads `result.files` unconditionally
    // (`(result.files || [])...`) without checking `result.success`, so a
    // RESOLVED `{ success: false, error }` — as opposed to a thrown/rejected
    // failure, already covered by the previous test — degrades silently to
    // `[]`. context.md: "propagate thrown and `{ success: false }` failures
    // instead of swallowing to []." This spec asserts the correct contract
    // and is expected to fail until the source is fixed.
    const orchestration = createContextOrchestrationMock();
    orchestration.getFileSuggestions.mockResolvedValue({
      success: false,
      error: { message: 'index unavailable' },
    } as never);

    const ns = buildSearchNamespace(
      createDeps(createWorkspaceAnalyzerMock(), orchestration),
    );

    await expect(ns.getRelevantFiles('q')).rejects.toThrow();
  });

  it('getRelevantFiles() forwards the session-aware root', async () => {
    const orchestration = createContextOrchestrationMock();
    orchestration.getFileSuggestions.mockResolvedValue({
      success: true,
      files: [],
    } as never);

    const ns = buildSearchNamespace(
      createDeps(
        createWorkspaceAnalyzerMock(),
        orchestration,
        createWorkspaceProviderMock('D:/projects/session-root'),
      ),
    );

    await ns.getRelevantFiles('query');

    expect(
      orchestration.getFileSuggestions.mock.calls[0][0].workspaceRoot,
    ).toBe('D:/projects/session-root');
  });
});

// ---------------------------------------------------------------------------
// buildDiagnosticsNamespace — async + capability-aware (TASK_2026_299)
// ---------------------------------------------------------------------------

describe('buildDiagnosticsNamespace', () => {
  function createDiagnosticsProvider(
    result: DiagnosticsResult,
  ): jest.Mocked<IDiagnosticsProvider> {
    return {
      getDiagnostics: jest.fn().mockResolvedValue(result),
    } as unknown as jest.Mocked<IDiagnosticsProvider>;
  }

  const availableResult: DiagnosticsResult = {
    status: 'available',
    source: 'test',
    diagnostics: [
      {
        file: '/w/a.ts',
        diagnostics: [
          { message: 'e1', line: 1, severity: 'error' },
          { message: 'w1', line: 2, severity: 'warning' },
        ],
      },
      {
        file: '/w/b.ts',
        diagnostics: [
          { message: 'h1', line: 3, severity: 'hint' },
          { message: 'e2', line: 4, severity: 'error' },
        ],
      },
    ],
  };

  it('exposes getErrors / getWarnings / getAll', () => {
    const ns = buildDiagnosticsNamespace(
      createDiagnosticsProvider({
        status: 'available',
        source: 'test',
        diagnostics: [],
      }),
      createWorkspaceProviderMock(),
    );
    expect(typeof ns.getErrors).toBe('function');
    expect(typeof ns.getWarnings).toBe('function');
    expect(typeof ns.getAll).toBe('function');
  });

  it('getErrors() returns payload with only error-severity diagnostics', async () => {
    const provider = createDiagnosticsProvider(availableResult);
    const ns = buildDiagnosticsNamespace(
      provider,
      createWorkspaceProviderMock(),
    );

    const payload = await ns.getErrors();

    expect(payload.status).toBe('available');
    expect(payload.source).toBe('test');
    expect(payload.diagnostics).toEqual([
      { file: '/w/a.ts', message: 'e1', line: 1, severity: 'error' },
      { file: '/w/b.ts', message: 'e2', line: 4, severity: 'error' },
    ]);
  });

  it('getWarnings() returns payload with only warning-severity diagnostics', async () => {
    const ns = buildDiagnosticsNamespace(
      createDiagnosticsProvider(availableResult),
      createWorkspaceProviderMock(),
    );

    const payload = await ns.getWarnings();

    expect(payload.status).toBe('available');
    expect(payload.diagnostics).toEqual([
      { file: '/w/a.ts', message: 'w1', line: 2, severity: 'warning' },
    ]);
  });

  it('getAll() preserves severity and returns every diagnostic', async () => {
    const ns = buildDiagnosticsNamespace(
      createDiagnosticsProvider(availableResult),
      createWorkspaceProviderMock(),
    );

    const payload = await ns.getAll();

    expect(payload.status).toBe('available');
    expect(payload.diagnostics).toEqual([
      { file: '/w/a.ts', message: 'e1', line: 1, severity: 'error' },
      { file: '/w/a.ts', message: 'w1', line: 2, severity: 'warning' },
      { file: '/w/b.ts', message: 'h1', line: 3, severity: 'hint' },
      { file: '/w/b.ts', message: 'e2', line: 4, severity: 'error' },
    ]);
  });

  it('unavailable result is preserved with source and reason', async () => {
    const provider = createDiagnosticsProvider({
      status: 'unavailable',
      source: 'cli-phase0',
      reason: 'Diagnostics not configured.',
    });
    const ns = buildDiagnosticsNamespace(
      provider,
      createWorkspaceProviderMock(),
    );

    const payload = await ns.getAll();

    expect(payload.status).toBe('unavailable');
    expect(payload.source).toBe('cli-phase0');
    expect(payload.reason).toBe('Diagnostics not configured.');
    expect(payload.diagnostics).toEqual([]);
  });

  it('passes a file scope through to getDiagnostics', async () => {
    const provider = createDiagnosticsProvider({
      status: 'available',
      source: 'test',
      diagnostics: [],
    });
    const ns = buildDiagnosticsNamespace(
      provider,
      createWorkspaceProviderMock('D:/workspace'),
    );

    await ns.getErrors(['D:/workspace/src/a.ts']);

    expect(provider.getDiagnostics).toHaveBeenCalledWith('D:/workspace', {
      files: ['D:/workspace/src/a.ts'],
    });
  });

  it('treats an empty file list as no scope', async () => {
    const provider = createDiagnosticsProvider({
      status: 'available',
      source: 'test',
      diagnostics: [],
    });
    const ns = buildDiagnosticsNamespace(
      provider,
      createWorkspaceProviderMock('D:/workspace'),
    );

    await ns.getAll([]);

    // A caller whose filter matched nothing must get the whole workspace, not
    // a clean bill of health for zero files.
    expect(provider.getDiagnostics).toHaveBeenCalledWith(
      'D:/workspace',
      undefined,
    );
  });

  it('passes the session root to getDiagnostics', async () => {
    const provider = createDiagnosticsProvider({
      status: 'available',
      source: 'test',
      diagnostics: [],
    });
    const ns = buildDiagnosticsNamespace(
      provider,
      createWorkspaceProviderMock('D:/workspace'),
    );

    await ns.getAll();

    // No `files` argument means no scope at all, NOT an empty one: a provider
    // that compiles reads an empty scope as "check nothing" and would answer
    // clean over a workspace it never looked at.
    expect(provider.getDiagnostics).toHaveBeenCalledWith(
      'D:/workspace',
      undefined,
    );
  });

  it('available with zero diagnostics returns empty diagnostics array', async () => {
    const ns = buildDiagnosticsNamespace(
      createDiagnosticsProvider({
        status: 'available',
        source: 'test',
        diagnostics: [],
      }),
      createWorkspaceProviderMock(),
    );

    const payload = await ns.getErrors();
    expect(payload.status).toBe('available');
    expect(payload.diagnostics).toEqual([]);
  });
});
