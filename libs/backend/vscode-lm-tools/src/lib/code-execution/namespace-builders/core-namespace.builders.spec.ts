/**
 * Specs for core namespace builders.
 *
 * Covers the three builders that sit directly under `ptah.*`:
 *   - buildWorkspaceNamespace → ptah.workspace
 *   - buildSearchNamespace    → ptah.search
 *   - buildDiagnosticsNamespace → ptah.diagnostics
 *
 * Focus is on shape round-trip, delegation correctness to the injected
 * services, and the documented failure behaviours (swallow → []) of the
 * search namespace.
 */

import type {
  WorkspaceAnalyzerService,
  ContextOrchestrationService,
} from '@ptah-extension/workspace-intelligence';
import type { IDiagnosticsProvider } from '@ptah-extension/platform-core';
import {
  buildWorkspaceNamespace,
  buildSearchNamespace,
  buildDiagnosticsNamespace,
  type CoreNamespaceDependencies,
} from './core-namespace.builders';

// ---------------------------------------------------------------------------
// Helpers — typed partial mocks that avoid `as any`
// ---------------------------------------------------------------------------

// We use loose jest.fn() signatures here so that `.mockResolvedValue(undefined)`
// and shape-fixture payloads remain ergonomic. The builder only cares about the
// method names, not about the full WorkspaceAnalyzerService return shapes.
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

function createDeps(
  workspaceAnalyzer: WorkspaceAnalyzerMock,
  contextOrchestration: ContextOrchestrationMock,
): CoreNamespaceDependencies {
  return {
    workspaceAnalyzer: workspaceAnalyzer as unknown as WorkspaceAnalyzerService,
    contextOrchestration:
      contextOrchestration as unknown as ContextOrchestrationService,
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
    expect(analyzer.getCurrentWorkspaceInfo).toHaveBeenCalledTimes(1);
    expect(analyzer.analyzeWorkspaceStructure).toHaveBeenCalledTimes(1);
    expect(analyzer.getProjectInfo).toHaveBeenCalledTimes(1);
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
    expect(result.info).toBeUndefined();
    expect(result.structure).toBeNull();
  });

  it('getProjectType() returns "unknown" when info is missing or projectType empty', async () => {
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
    expect(first).not.toBe(frameworks); // builder spreads into new array
    expect(await ns.getFrameworks()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildSearchNamespace
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

  it('findFiles() delegates with requestId/query/limit and extracts relativePath', async () => {
    const orchestration = createContextOrchestrationMock();
    orchestration.searchFiles.mockResolvedValue({
      results: [
        { relativePath: 'src/a.ts' },
        null,
        { relativePath: 'src/b.ts' },
      ],
    } as never);

    const ns = buildSearchNamespace(
      createDeps(createWorkspaceAnalyzerMock(), orchestration),
    );

    const paths = await ns.findFiles('src/**/*.ts', 5);

    expect(paths).toEqual(['src/a.ts', 'src/b.ts']);
    expect(orchestration.searchFiles).toHaveBeenCalledTimes(1);
    const call = orchestration.searchFiles.mock.calls[0][0];
    expect(call.query).toBe('src/**/*.ts');
    expect(call.maxResults).toBe(5);
    expect(call.includeImages).toBe(false);
    expect(typeof call.requestId).toBe('string');
    expect(call.requestId.startsWith('mcp-search-')).toBe(true);
  });

  it('findFiles() defaults limit to 20 when not provided', async () => {
    const orchestration = createContextOrchestrationMock();
    orchestration.searchFiles.mockResolvedValue({ results: [] } as never);

    const ns = buildSearchNamespace(
      createDeps(createWorkspaceAnalyzerMock(), orchestration),
    );

    await ns.findFiles('anything');
    expect(orchestration.searchFiles.mock.calls[0][0].maxResults).toBe(20);
  });

  it('findFiles() returns [] when orchestration throws', async () => {
    const orchestration = createContextOrchestrationMock();
    orchestration.searchFiles.mockRejectedValue(new Error('boom'));

    const ns = buildSearchNamespace(
      createDeps(createWorkspaceAnalyzerMock(), orchestration),
    );

    await expect(ns.findFiles('pattern')).resolves.toEqual([]);
  });

  it('findFiles() treats missing results as empty without crashing', async () => {
    const orchestration = createContextOrchestrationMock();
    orchestration.searchFiles.mockResolvedValue({} as never);

    const ns = buildSearchNamespace(
      createDeps(createWorkspaceAnalyzerMock(), orchestration),
    );

    await expect(ns.findFiles('pattern')).resolves.toEqual([]);
  });

  it('getRelevantFiles() delegates with correct params and extracts relativePath', async () => {
    const orchestration = createContextOrchestrationMock();
    orchestration.getFileSuggestions.mockResolvedValue({
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
    expect(call.requestId.startsWith('mcp-relevant-')).toBe(true);
  });

  it('getRelevantFiles() defaults maxFiles to 10 and returns [] on error', async () => {
    const orchestration = createContextOrchestrationMock();
    orchestration.getFileSuggestions.mockResolvedValueOnce({
      files: [],
    } as never);
    orchestration.getFileSuggestions.mockRejectedValueOnce(new Error('x'));

    const ns = buildSearchNamespace(
      createDeps(createWorkspaceAnalyzerMock(), orchestration),
    );

    await ns.getRelevantFiles('q');
    expect(orchestration.getFileSuggestions.mock.calls[0][0].limit).toBe(10);

    await expect(ns.getRelevantFiles('q2')).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildDiagnosticsNamespace
// ---------------------------------------------------------------------------

describe('buildDiagnosticsNamespace', () => {
  function createDiagnosticsProvider(
    entries: ReturnType<IDiagnosticsProvider['getDiagnostics']>,
  ): jest.Mocked<IDiagnosticsProvider> {
    return { getDiagnostics: jest.fn(() => entries) };
  }

  const sampleEntries = [
    {
      file: '/w/a.ts',
      diagnostics: [
        { message: 'e1', line: 1, severity: 'error' as const },
        { message: 'w1', line: 2, severity: 'warning' as const },
      ],
    },
    {
      file: '/w/b.ts',
      diagnostics: [
        { message: 'h1', line: 3, severity: 'hint' as const },
        { message: 'e2', line: 4, severity: 'error' as const },
      ],
    },
  ];

  it('exposes getErrors / getWarnings / getAll', () => {
    const ns = buildDiagnosticsNamespace(createDiagnosticsProvider([]));
    expect(typeof ns.getErrors).toBe('function');
    expect(typeof ns.getWarnings).toBe('function');
    expect(typeof ns.getAll).toBe('function');
  });

  it('getErrors() flattens only severity === "error" and drops severity field', async () => {
    const provider = createDiagnosticsProvider(sampleEntries);
    const ns = buildDiagnosticsNamespace(provider);

    const errors = await ns.getErrors();

    expect(errors).toEqual([
      { file: '/w/a.ts', message: 'e1', line: 1 },
      { file: '/w/b.ts', message: 'e2', line: 4 },
    ]);
    expect(provider.getDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('getWarnings() flattens only severity === "warning"', async () => {
    const ns = buildDiagnosticsNamespace(
      createDiagnosticsProvider(sampleEntries),
    );

    const warnings = await ns.getWarnings();

    expect(warnings).toEqual([{ file: '/w/a.ts', message: 'w1', line: 2 }]);
  });

  it('getAll() preserves severity and returns every diagnostic across files', async () => {
    const ns = buildDiagnosticsNamespace(
      createDiagnosticsProvider(sampleEntries),
    );

    const all = await ns.getAll();

    expect(all).toEqual([
      { file: '/w/a.ts', message: 'e1', line: 1, severity: 'error' },
      { file: '/w/a.ts', message: 'w1', line: 2, severity: 'warning' },
      { file: '/w/b.ts', message: 'h1', line: 3, severity: 'hint' },
      { file: '/w/b.ts', message: 'e2', line: 4, severity: 'error' },
    ]);
  });

  it('returns empty arrays when the provider reports no diagnostics', async () => {
    const ns = buildDiagnosticsNamespace(createDiagnosticsProvider([]));
    await expect(ns.getErrors()).resolves.toEqual([]);
    await expect(ns.getWarnings()).resolves.toEqual([]);
    await expect(ns.getAll()).resolves.toEqual([]);
  });
});
