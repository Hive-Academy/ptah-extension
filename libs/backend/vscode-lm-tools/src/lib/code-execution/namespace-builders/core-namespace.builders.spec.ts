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

import * as path from 'path';
import type {
  WorkspaceAnalyzerService,
  ContextOrchestrationService,
} from '@ptah-extension/workspace-intelligence';
import { withCoverageVerdict } from '@ptah-extension/platform-core';
import type {
  IDiagnosticsProvider,
  IWorkspaceProvider,
  IFileSystemProvider,
  DiagnosticsResult,
  LanguageCoverage,
  NotCheckedFiles,
} from '@ptah-extension/platform-core';
import {
  buildWorkspaceNamespace,
  buildSearchNamespace,
  buildDiagnosticsNamespace,
  type CoreNamespaceDependencies,
} from './core-namespace.builders';
import { formatDiagnostics } from '../mcp-core/mcp-response-formatter';

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
    // Built with path.resolve so the entry is absolute on every platform:
    // `D:/...` is relative on posix and would now be resolved against the root.
    const root = path.resolve('/workspace');
    const file = path.resolve(root, 'src/a.ts');
    const ns = buildDiagnosticsNamespace(
      provider,
      createWorkspaceProviderMock(root),
    );

    await ns.getErrors([file]);

    expect(provider.getDiagnostics).toHaveBeenCalledWith(root, {
      files: [file],
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

  describe('requested-file scope (TASK_2026_559 r1)', () => {
    // A root that is absolute on the platform running the spec, spelled the
    // way the workspace provider reports it.
    const ROOT = process.platform === 'win32' ? 'D:\\repo' : '/repo';
    // Diagnostic paths as the compiler reports them: forward slashes.
    const onDisk = (relative: string): string =>
      path.resolve(ROOT, relative).replace(/\\/g, '/');

    function providerReturning(
      entries: Array<{ file: string; messages: string[] }>,
    ): jest.Mocked<IDiagnosticsProvider> {
      return createDiagnosticsProvider({
        status: 'available',
        source: 'typescript-compiler',
        diagnostics: entries.map(({ file, messages }) => ({
          file,
          diagnostics: messages.map((message, i) => ({
            message,
            line: i + 1,
            severity: 'error' as const,
          })),
        })),
      });
    }

    // The dispatcher's path: the namespace payload goes to the formatter as-is.
    function render(payload: unknown): string {
      return formatDiagnostics(payload);
    }

    it('resolves relative files against the session root, never the process cwd', async () => {
      const provider = providerReturning([]);
      const ns = buildDiagnosticsNamespace(
        provider,
        createWorkspaceProviderMock(ROOT),
      );
      const absolute = path.resolve(ROOT, 'libs/x/src/abs.ts');

      const payload = await ns.getAll([
        'src/a.ts',
        './src/../src/z.ts',
        absolute,
      ]);

      const expected = [
        path.resolve(ROOT, 'src/a.ts'),
        path.resolve(ROOT, 'src/z.ts'),
        absolute,
      ];
      expect(provider.getDiagnostics).toHaveBeenCalledWith(ROOT, {
        files: expected,
      });
      expect(payload.requestedFiles).toEqual(expected);
    });

    it('without a session root, forwards relative files unchanged and reports only the absolute ones as requested', async () => {
      const provider = providerReturning([]);
      const ns = buildDiagnosticsNamespace(
        provider,
        createWorkspaceProviderMock(undefined),
      );
      const absolute = path.resolve(ROOT, 'src/a.ts');

      const payload = await ns.getAll(['src/z.ts', absolute]);

      expect(provider.getDiagnostics).toHaveBeenCalledWith(undefined, {
        files: ['src/z.ts', absolute],
      });
      expect(payload.requestedFiles).toEqual([absolute]);
    });

    it('carries no requested scope for an unscoped or empty-files call', async () => {
      const ns = buildDiagnosticsNamespace(
        providerReturning([]),
        createWorkspaceProviderMock(ROOT),
      );
      expect((await ns.getAll()).requestedFiles).toBeUndefined();
      expect((await ns.getAll([])).requestedFiles).toBeUndefined();
    });

    it('a relative dot-segment request keeps its diagnostic ahead of 60 earlier-sorting siblings', async () => {
      const files = ['./src/../src/z.ts'];
      const ns = buildDiagnosticsNamespace(
        providerReturning([
          {
            file: onDisk('src/a.ts'),
            messages: Array.from({ length: 60 }, (_, i) => `sib-${i}`),
          },
          { file: onDisk('src/z.ts'), messages: ['TARGET'] },
        ]),
        createWorkspaceProviderMock(ROOT),
      );

      const out = render(await ns.getAll(files));

      expect(out).toContain('TARGET');
      expect(out).not.toContain('No diagnostics in the requested files');
      expect(out).toContain(
        'Shown 50 of 61 (1 in requested files, 11 in sibling files omitted)',
      );
    });

    it('a relative request selects only the file under the root, not every file sharing its suffix', async () => {
      const files = ['src/a.ts'];
      const ns = buildDiagnosticsNamespace(
        providerReturning([
          { file: onDisk('src/a.ts'), messages: ['REQUESTED'] },
          { file: onDisk('packages/other/src/a.ts'), messages: ['OTHER'] },
          {
            file: onDisk('libs/b.ts'),
            messages: Array.from({ length: 60 }, (_, i) => `sib-${i}`),
          },
        ]),
        createWorkspaceProviderMock(ROOT),
      );

      const out = render(await ns.getAll(files));

      expect(out).toContain('REQUESTED');
      expect(out).not.toContain('OTHER');
      expect(out).toContain(
        'Shown 50 of 62 (1 in requested files, 12 in sibling files omitted)',
      );
      expect(out).toContain(`\`${onDisk('packages/other/src/a.ts')}\` (1)`);
    });
  });

  describe('coverage forwarding (TASK_2026_559 Batch 25b)', () => {
    const MIXED_UNSCOPED: LanguageCoverage = withCoverageVerdict({
      supportedLanguages: ['typescript', 'javascript', 'tsx', 'python'],
      census: 'complete',
      analyzed: null,
      unchecked: 2,
      failed: 0,
      unsupported: 0,
      unrecognised: 0,
      nonSource: 0,
      excluded: null,
      omittedByCap: 0,
      checks: 'type-check',
    });
    const NOT_CHECKED: NotCheckedFiles[] = [
      {
        language: 'python',
        count: 2,
        reason:
          'The syntax check runs only on requested files: pass `files` to check them.',
      },
    ];

    it('mixed repo never prints a bare No issues found', async () => {
      const ns = buildDiagnosticsNamespace(
        createDiagnosticsProvider({
          status: 'available',
          source: 'typescript-compiler',
          coverage: MIXED_UNSCOPED,
          notChecked: NOT_CHECKED,
          diagnostics: [],
        }),
        createWorkspaceProviderMock('D:/workspace'),
      );

      const out = formatDiagnostics(await ns.getErrors());

      expect(out).not.toMatch(/No issues found/);
      expect(out).toContain('2 files unchecked (pass `files` to check them)');
      expect(out).toContain('2 python files');
    });

    it('forwards coverage and notChecked unchanged on the available arm, for every severity filter', async () => {
      const ns = buildDiagnosticsNamespace(
        createDiagnosticsProvider({
          ...availableResult,
          coverage: MIXED_UNSCOPED,
          notChecked: NOT_CHECKED,
        }),
        createWorkspaceProviderMock(),
      );

      for (const payload of [
        await ns.getErrors(),
        await ns.getWarnings(),
        await ns.getAll(),
      ]) {
        expect(payload.coverage).toBe(MIXED_UNSCOPED);
        expect(payload.notChecked).toBe(NOT_CHECKED);
      }
    });

    it('forwards coverage and notChecked on the unavailable arm', async () => {
      const ns = buildDiagnosticsNamespace(
        createDiagnosticsProvider({
          status: 'unavailable',
          source: 'typescript-compiler',
          reason: 'No tsconfig.json found under workspace root.',
          coverage: MIXED_UNSCOPED,
          notChecked: NOT_CHECKED,
        }),
        createWorkspaceProviderMock(),
      );

      const payload = await ns.getAll();

      expect(payload).toMatchObject({
        status: 'unavailable',
        coverage: MIXED_UNSCOPED,
        notChecked: NOT_CHECKED,
        diagnostics: [],
      });
    });

    it('leaves notChecked out when the provider names none', async () => {
      const ns = buildDiagnosticsNamespace(
        createDiagnosticsProvider({
          status: 'available',
          source: 'typescript-compiler',
          coverage: MIXED_UNSCOPED,
          notChecked: [],
          diagnostics: [],
        }),
        createWorkspaceProviderMock(),
      );
      expect('notChecked' in (await ns.getAll())).toBe(false);
    });

    it.each(['available', 'unavailable'] as const)(
      'a provider with no coverage (the VS Code provider) is provider-defined on the %s arm, analyzed null, never clean',
      async (status) => {
        const result: DiagnosticsResult =
          status === 'available'
            ? { status, source: 'vscode-languages', diagnostics: [] }
            : { status, source: 'vscode-languages', reason: 'No workspace.' };
        const ns = buildDiagnosticsNamespace(
          createDiagnosticsProvider(result),
          createWorkspaceProviderMock(),
        );

        const payload = await ns.getAll();

        expect(payload.coverage).toMatchObject({
          clean: false,
          checks: 'provider-defined',
          census: 'unknown',
          analyzed: null,
        });
        const out = formatDiagnostics(payload);
        expect(out).not.toMatch(/No issues found/);
        expect(out).toContain('provider-defined');
      },
    );
  });
});
