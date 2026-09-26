/**
 * Specs for analysis-namespace.builders.
 *
 * Covers the four builders that sit under the analysis umbrella:
 *   - buildContextNamespace     → ptah.context
 *   - buildProjectNamespace     → ptah.project
 *   - buildRelevanceNamespace   → ptah.relevance
 *   - buildDependencyNamespace  → ptah.dependencies
 *
 * Tests verify shape and delegation through the injected workspace-intelligence
 * services. Error paths are covered where the SUT documents a swallow-and-
 * degrade contract.
 */

// The SUT reads `EXTENSION_LANGUAGE_MAP` as a value from
// `@ptah-extension/workspace-intelligence`, whose barrel transitively loads
// `vscode-core` → `vscode`. Replace the module at the boundary with the
// map's real entries (the service classes are used as types only), the same
// pattern as `ast-namespace.builder.spec.ts`.
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  EXTENSION_LANGUAGE_MAP: {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.go': 'go',
    '.cs': 'csharp',
    '.csx': 'csharp',
  },
}));

import * as path from 'path';

import type {
  ContextSizeOptimizerService,
  MonorepoDetectorService,
  DependencyAnalyzerService,
  FileRelevanceScorerService,
  TokenCounterService,
  WorkspaceIndexerService,
  ProjectDetectorService,
  WorkspaceAnalyzerService,
  ContextEnrichmentService,
  DependencyGraphService,
} from '@ptah-extension/workspace-intelligence';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

import {
  buildContextNamespace,
  buildProjectNamespace,
  buildRelevanceNamespace,
  buildDependencyNamespace,
  type AnalysisNamespaceDependencies,
} from './analysis-namespace.builders';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMocks(): AnalysisNamespaceDependencies & {
  _contextOptimizer: {
    optimizeContext: jest.Mock;
    getRecommendedBudget: jest.Mock;
  };
  _monorepoDetector: { detectMonorepo: jest.Mock };
  _dependencyAnalyzer: { analyzeDependencies: jest.Mock };
  _relevanceScorer: { scoreFile: jest.Mock; getTopFiles: jest.Mock };
  _tokenCounter: { countTokens: jest.Mock };
  _workspaceIndexer: { indexWorkspace: jest.Mock };
  _projectDetector: { detectProjectType: jest.Mock };
  _workspaceAnalyzer: { getCurrentWorkspaceInfo: jest.Mock };
  _contextEnrichment: { generateStructuralSummary: jest.Mock };
  _dependencyGraph: {
    buildGraph: jest.Mock;
    getDependencies: jest.Mock;
    getDependents: jest.Mock;
    getSymbolIndex: jest.Mock;
    isBuilt: jest.Mock;
  };
  _workspaceProvider: { getWorkspaceRoot: jest.Mock };
} {
  const _contextOptimizer = {
    optimizeContext: jest.fn(),
    getRecommendedBudget: jest.fn().mockReturnValue(42),
  };
  const _monorepoDetector = { detectMonorepo: jest.fn() };
  const _dependencyAnalyzer = { analyzeDependencies: jest.fn() };
  const _relevanceScorer = { scoreFile: jest.fn(), getTopFiles: jest.fn() };
  const _tokenCounter = { countTokens: jest.fn() };
  const _workspaceIndexer = { indexWorkspace: jest.fn() };
  const _projectDetector = { detectProjectType: jest.fn() };
  const _workspaceAnalyzer = { getCurrentWorkspaceInfo: jest.fn() };
  const _contextEnrichment = { generateStructuralSummary: jest.fn() };
  const _dependencyGraph = {
    buildGraph: jest.fn(),
    getDependencies: jest.fn(),
    getDependents: jest.fn(),
    getSymbolIndex: jest.fn(),
    isBuilt: jest.fn(),
  };
  const _workspaceProvider = {
    getWorkspaceRoot: jest.fn().mockReturnValue('D:/ws'),
  };

  return {
    contextOptimizer:
      _contextOptimizer as unknown as ContextSizeOptimizerService,
    monorepoDetector: _monorepoDetector as unknown as MonorepoDetectorService,
    dependencyAnalyzer:
      _dependencyAnalyzer as unknown as DependencyAnalyzerService,
    relevanceScorer: _relevanceScorer as unknown as FileRelevanceScorerService,
    tokenCounter: _tokenCounter as unknown as TokenCounterService,
    workspaceIndexer: _workspaceIndexer as unknown as WorkspaceIndexerService,
    projectDetector: _projectDetector as unknown as ProjectDetectorService,
    workspaceAnalyzer:
      _workspaceAnalyzer as unknown as WorkspaceAnalyzerService,
    contextEnrichment:
      _contextEnrichment as unknown as ContextEnrichmentService,
    dependencyGraph: _dependencyGraph as unknown as DependencyGraphService,
    workspaceProvider: _workspaceProvider as unknown as IWorkspaceProvider,
    _contextOptimizer,
    _monorepoDetector,
    _dependencyAnalyzer,
    _relevanceScorer,
    _tokenCounter,
    _workspaceIndexer,
    _projectDetector,
    _workspaceAnalyzer,
    _contextEnrichment,
    _dependencyGraph,
    _workspaceProvider,
  };
}

// ---------------------------------------------------------------------------
// buildContextNamespace
// ---------------------------------------------------------------------------

describe('buildContextNamespace', () => {
  it('exposes enrichFile/optimize/countTokens/getRecommendedBudget', () => {
    const ns = buildContextNamespace(makeMocks());
    expect(typeof ns.enrichFile).toBe('function');
    expect(typeof ns.optimize).toBe('function');
    expect(typeof ns.countTokens).toBe('function');
    expect(typeof ns.getRecommendedBudget).toBe('function');
  });

  it('enrichFile delegates to contextEnrichment with typed language', async () => {
    const deps = makeMocks();
    deps._contextEnrichment.generateStructuralSummary.mockResolvedValue({
      content: '// ok',
      mode: 'full',
      tokenCount: 10,
      originalTokenCount: 20,
      reductionPercentage: 50,
    });

    const out = await buildContextNamespace(deps).enrichFile(
      'src/a.ts',
      'typescript',
    );
    expect(
      deps._contextEnrichment.generateStructuralSummary,
    ).toHaveBeenCalledWith(path.join('D:/ws', 'src/a.ts'), 'typescript');
    expect(out.content).toBe('// ok');
  });

  it('enrichFile passes an absolute path through unchanged', async () => {
    const deps = makeMocks();
    deps._contextEnrichment.generateStructuralSummary.mockResolvedValue({
      content: '// ok',
      mode: 'full',
      tokenCount: 10,
      originalTokenCount: 20,
      reductionPercentage: 50,
    });
    const abs = 'D:\\elsewhere\\b.ts';

    await buildContextNamespace(deps).enrichFile(abs);

    expect(
      deps._contextEnrichment.generateStructuralSummary,
    ).toHaveBeenCalledWith(abs, 'typescript');
    expect(deps._workspaceProvider.getWorkspaceRoot).not.toHaveBeenCalled();
  });

  it('enrichFile swallows errors and returns a read-failed full result', async () => {
    const deps = makeMocks();
    deps._contextEnrichment.generateStructuralSummary.mockRejectedValue(
      new Error('bad'),
    );

    const out = await buildContextNamespace(deps).enrichFile('src/a.ts');
    expect(out.content).toMatch(/Error generating structural summary: bad/);
    expect(out.mode).toBe('full');
    expect(out.reason).toBe('read-failed');
    expect(out.tokenCount).toBe(0);
    const keys = Object.keys(out);
    expect(keys[keys.length - 1]).toBe('content');
  });

  it('enrichFile reports read-failed when a relative path has no workspace root', async () => {
    const deps = makeMocks();
    deps._workspaceProvider.getWorkspaceRoot.mockReturnValue(undefined);

    const out = await buildContextNamespace(deps).enrichFile('src/a.ts');

    expect(
      deps._contextEnrichment.generateStructuralSummary,
    ).not.toHaveBeenCalled();
    expect(out.mode).toBe('full');
    expect(out.reason).toBe('read-failed');
  });

  describe('enrichFile language inference', () => {
    /** The language `enrichFile` forwards for `file` and optional `language`. */
    async function forwardedLanguage(
      file: string,
      language?: string,
    ): Promise<unknown> {
      const deps = makeMocks();
      deps._contextEnrichment.generateStructuralSummary.mockResolvedValue({
        mode: 'structural',
        tokenCount: 1,
        originalTokenCount: 2,
        reductionPercentage: 50,
        content: '// ok',
      });
      await buildContextNamespace(deps).enrichFile(file, language);
      return deps._contextEnrichment.generateStructuralSummary.mock.calls[0][1];
    }

    it.each([
      ['src/a.ts', 'typescript'],
      ['src/a.mts', 'typescript'],
      ['src/a.cts', 'typescript'],
      ['src/a.js', 'javascript'],
      ['src/a.jsx', 'javascript'],
      ['src/a.mjs', 'javascript'],
      ['src/a.cjs', 'javascript'],
      ['src/a.spec.ts', 'typescript'],
      ['src/types.D.TS', 'typescript'],
      ['src/Legacy.MJS', 'javascript'],
    ])('infers %s → %s when no language is given', async (file, expected) => {
      await expect(forwardedLanguage(file)).resolves.toBe(expected);
    });

    it.each([
      ['src/a.py'],
      ['src/a.go'],
      ['src/a.cs'],
      ['src/App.tsx'],
      ['src/App.TSX'],
      ['README.md'],
      ['Makefile'],
      ['.eslintrc'],
      ['src/dir.ts/Dockerfile'],
    ])(
      'forwards undefined for %s (no summary language, so the service answers unsupported-language)',
      async (file) => {
        await expect(forwardedLanguage(file)).resolves.toBeUndefined();
      },
    );

    it('forwards an explicit language unchanged, even when it contradicts the extension', async () => {
      await expect(forwardedLanguage('src/a.ts', 'javascript')).resolves.toBe(
        'javascript',
      );
      await expect(forwardedLanguage('src/a.py', 'typescript')).resolves.toBe(
        'typescript',
      );
    });

    it('forwards an explicit typescript for a .tsx file (the service refuses a JSX parse)', async () => {
      await expect(
        forwardedLanguage('src/App.tsx', 'typescript'),
      ).resolves.toBe('typescript');
    });

    it('ignores an unsupported explicit value and infers from the extension', async () => {
      await expect(forwardedLanguage('src/a.mts', 'tsx')).resolves.toBe(
        'typescript',
      );
      await expect(
        forwardedLanguage('src/a.tsx', 'tsx'),
      ).resolves.toBeUndefined();
      await expect(
        forwardedLanguage('src/a.py', 'python'),
      ).resolves.toBeUndefined();
    });

    it('returns the structural result for a .ts file given no language', async () => {
      const deps = makeMocks();
      deps._contextEnrichment.generateStructuralSummary.mockImplementation(
        async (_file: string, language?: string) =>
          language
            ? {
                mode: 'structural',
                tokenCount: 1,
                originalTokenCount: 10,
                reductionPercentage: 90,
                content: '// summary',
              }
            : {
                mode: 'full',
                reason: 'unsupported-language',
                tokenCount: 10,
                originalTokenCount: 10,
                reductionPercentage: 0,
                content: 'full body',
              },
      );
      const ns = buildContextNamespace(deps);

      await expect(ns.enrichFile('src/a.ts')).resolves.toMatchObject({
        mode: 'structural',
      });
      await expect(ns.enrichFile('src/a.tsx')).resolves.toMatchObject({
        mode: 'full',
        reason: 'unsupported-language',
      });
      await expect(ns.enrichFile('src/a.py')).resolves.toMatchObject({
        mode: 'full',
        reason: 'unsupported-language',
      });
    });
  });

  it('optimize defaults maxTokens to 150000 and forwards indexed files', async () => {
    const deps = makeMocks();
    deps._workspaceIndexer.indexWorkspace.mockResolvedValue({
      files: [{ path: 'D:/ws/a.ts' }],
    });
    deps._contextOptimizer.optimizeContext.mockResolvedValue({
      selectedFiles: [],
      totalTokens: 0,
      tokensRemaining: 0,
      stats: {
        totalFiles: 1,
        selectedFiles: 0,
        excludedFiles: 1,
        reductionPercentage: 100,
      },
    });

    await buildContextNamespace(deps).optimize('my query');
    const call = deps._contextOptimizer.optimizeContext.mock.calls[0][0];
    expect(call.maxTokens).toBe(150000);
    expect(call.query).toBe('my query');
    expect(call.responseReserve).toBe(50000);
  });

  it('countTokens delegates to tokenCounter', async () => {
    const deps = makeMocks();
    deps._tokenCounter.countTokens.mockResolvedValue(123);
    await expect(buildContextNamespace(deps).countTokens('hi')).resolves.toBe(
      123,
    );
  });

  it('getRecommendedBudget is a pure pass-through', () => {
    const deps = makeMocks();
    expect(buildContextNamespace(deps).getRecommendedBudget('monorepo')).toBe(
      42,
    );
    expect(deps._contextOptimizer.getRecommendedBudget).toHaveBeenCalledWith(
      'monorepo',
    );
  });
});

// ---------------------------------------------------------------------------
// buildProjectNamespace
// ---------------------------------------------------------------------------

describe('buildProjectNamespace', () => {
  it('detectMonorepo returns shaped result from monorepoDetector', async () => {
    const deps = makeMocks();
    deps._monorepoDetector.detectMonorepo.mockResolvedValue({
      isMonorepo: true,
      type: 'nx',
      workspaceFiles: ['nx.json'],
      packageCount: 3,
    });

    const out = await buildProjectNamespace(deps).detectMonorepo();
    expect(out).toEqual({
      isMonorepo: true,
      type: 'nx',
      workspaceFiles: ['nx.json'],
      packageCount: 3,
    });
  });

  it('detectMonorepo short-circuits to {isMonorepo:false} when no workspace root', async () => {
    const deps = makeMocks();
    deps._workspaceProvider.getWorkspaceRoot.mockReturnValue(undefined);
    const out = await buildProjectNamespace(deps).detectMonorepo();
    expect(out.isMonorepo).toBe(false);
    expect(deps._monorepoDetector.detectMonorepo).not.toHaveBeenCalled();
  });

  it('detectType returns analyzer-provided projectType or "unknown"', async () => {
    const deps = makeMocks();
    deps._workspaceAnalyzer.getCurrentWorkspaceInfo
      .mockResolvedValueOnce({ projectType: 'react' })
      .mockResolvedValueOnce(undefined);

    expect(await buildProjectNamespace(deps).detectType()).toBe('react');
    expect(await buildProjectNamespace(deps).detectType()).toBe('unknown');
  });

  it('analyzeDependencies flattens prod + dev deps with isDev annotations', async () => {
    const deps = makeMocks();
    deps._projectDetector.detectProjectType.mockResolvedValue('node');
    deps._dependencyAnalyzer.analyzeDependencies.mockResolvedValue({
      dependencies: [{ name: 'lodash', version: '1.0.0' }],
      devDependencies: [{ name: 'jest', version: '30.0.0' }],
    });

    const out = await buildProjectNamespace(deps).analyzeDependencies();
    expect(out).toEqual([
      { name: 'lodash', version: '1.0.0', isDev: false },
      { name: 'jest', version: '30.0.0', isDev: true },
    ]);
  });

  it('analyzeDependencies returns [] when no workspace root', async () => {
    const deps = makeMocks();
    deps._workspaceProvider.getWorkspaceRoot.mockReturnValue(undefined);
    const out = await buildProjectNamespace(deps).analyzeDependencies();
    expect(out).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildRelevanceNamespace
// ---------------------------------------------------------------------------

describe('buildRelevanceNamespace', () => {
  it('scoreFile returns a not-found sentinel when the path is absent from the index', async () => {
    const deps = makeMocks();
    deps._workspaceIndexer.indexWorkspace.mockResolvedValue({ files: [] });
    const out = await buildRelevanceNamespace(deps).scoreFile('x.ts', 'q');
    expect(out).toEqual({
      file: 'x.ts',
      score: 0,
      reasons: ['File not found in workspace'],
    });
  });

  it('scoreFile delegates to relevanceScorer when the file is present', async () => {
    const deps = makeMocks();
    const file = {
      path: 'D:/ws/x.ts',
      relativePath: 'x.ts',
      size: 1,
      estimatedTokens: 10,
    };
    deps._workspaceIndexer.indexWorkspace.mockResolvedValue({ files: [file] });
    deps._relevanceScorer.scoreFile.mockReturnValue({
      score: 0.9,
      reasons: ['filename match'],
    });

    const out = await buildRelevanceNamespace(deps).scoreFile('x.ts', 'q');
    expect(out).toEqual({
      file: 'x.ts',
      score: 0.9,
      reasons: ['filename match'],
    });
  });

  it('rankFiles defaults limit to 20', async () => {
    const deps = makeMocks();
    deps._workspaceIndexer.indexWorkspace.mockResolvedValue({ files: [] });
    deps._relevanceScorer.getTopFiles.mockReturnValue([]);

    await buildRelevanceNamespace(deps).rankFiles('q');
    const [, , limit] = deps._relevanceScorer.getTopFiles.mock.calls[0];
    expect(limit).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// buildDependencyNamespace
// ---------------------------------------------------------------------------

describe('buildDependencyNamespace', () => {
  it('buildGraph reports node and edge counts from the dependencyGraph', async () => {
    const deps = makeMocks();
    deps._dependencyGraph.buildGraph.mockResolvedValue({
      nodes: new Map([
        ['a', 1],
        ['b', 2],
      ]),
      edges: new Map([['a', new Set(['b', 'c'])]]),
      unresolvedCount: 1,
      builtAt: 1234,
    });

    const out = await buildDependencyNamespace(deps).buildGraph(
      ['a.ts'],
      'D:/ws',
    );
    expect(out).toEqual({
      nodeCount: 2,
      edgeCount: 2,
      unresolvedCount: 1,
      builtAt: 1234,
    });
  });

  /**
   * `ptah.search.findFiles()` yields workspace-relative paths and the sandbox
   * rejects absolute ones, so relative is what this method actually receives.
   * The graph needs absolute paths to read files and key its nodes; handing
   * relative ones through produced a silent `0 nodes, 0 edges` graph.
   *
   * Split by host path semantics, exactly as `workspace-file-index.service.spec`
   * and the workspace-intelligence root-scope specs do. `toAbsoluteWorkspacePath`
   * gates on `path.isAbsolute`, which is host-scoped: a `D:/...` literal is not
   * an absolute path to a POSIX runner, so on Linux CI the already-absolute
   * fixture got the root prefixed onto it a second time — a property of the
   * fixture, not of the builder.
   */
  it('buildGraph resolves workspace-relative paths against the root', async () => {
    const deps = makeMocks();
    deps._dependencyGraph.buildGraph.mockResolvedValue({
      nodes: new Map(),
      edges: new Map(),
      unresolvedCount: 0,
      builtAt: 1,
    });

    const root = path.join(path.sep, 'ws');
    const alreadyAbsolute = path.join(root, 'src', 'main.ts');

    await buildDependencyNamespace(deps).buildGraph(
      [path.join('src', 'app', 'app.ts'), alreadyAbsolute],
      root,
    );

    const [passedFiles] = deps._dependencyGraph.buildGraph.mock.calls[0];
    expect(passedFiles).toEqual([
      path.join(root, 'src', 'app', 'app.ts'),
      alreadyAbsolute,
    ]);
  });

  it('buildGraph passes drive-letter and UNC absolute paths through on Windows', async () => {
    // Drive letters and UNC shares are Windows path concepts.
    if (path.sep !== '\\') return;
    const deps = makeMocks();
    deps._dependencyGraph.buildGraph.mockResolvedValue({
      nodes: new Map(),
      edges: new Map(),
      unresolvedCount: 0,
      builtAt: 1,
    });

    await buildDependencyNamespace(deps).buildGraph(
      [
        'src/app/app.ts',
        'D:/ws/src/main.ts',
        'D:\\ws\\src\\other.ts',
        '\\\\share\\ws\\src\\unc.ts',
      ],
      'D:/ws',
    );

    const [passedFiles] = deps._dependencyGraph.buildGraph.mock.calls[0];
    expect(passedFiles.map((f: string) => f.replace(/\\/g, '/'))).toEqual([
      'D:/ws/src/app/app.ts',
      'D:/ws/src/main.ts',
      'D:/ws/src/other.ts',
      '//share/ws/src/unc.ts',
    ]);
  });

  it('buildGraph returns a zeroed envelope with error on failure', async () => {
    const deps = makeMocks();
    deps._dependencyGraph.buildGraph.mockRejectedValue(new Error('bad graph'));
    const out = await buildDependencyNamespace(deps).buildGraph([], 'D:/ws');
    expect(out.nodeCount).toBe(0);
    expect(out.error).toMatch(/bad graph/);
  });

  it('getDependencies / getDependents swallow throws and return []', async () => {
    const deps = makeMocks();
    deps._dependencyGraph.getDependencies.mockImplementation(() => {
      throw new Error('x');
    });
    deps._dependencyGraph.getDependents.mockImplementation(() => {
      throw new Error('y');
    });
    const ns = buildDependencyNamespace(deps);
    await expect(ns.getDependencies('a.ts')).resolves.toEqual([]);
    await expect(ns.getDependents('a.ts')).resolves.toEqual([]);
  });

  it('getDependencies / getDependents resolve a relative path to absolute before querying the graph', async () => {
    const deps = makeMocks();
    deps._dependencyGraph.getDependencies.mockReturnValue([]);
    deps._dependencyGraph.getDependents.mockReturnValue([]);
    const ns = buildDependencyNamespace(deps);

    await ns.getDependencies('src/a.ts', 2);
    await ns.getDependents('src/a.ts');

    expect(deps._dependencyGraph.getDependencies).toHaveBeenCalledWith(
      path.join('D:/ws', 'src/a.ts'),
      2,
    );
    expect(deps._dependencyGraph.getDependents).toHaveBeenCalledWith(
      path.join('D:/ws', 'src/a.ts'),
    );
  });

  it('getDependents passes an absolute path through unchanged', async () => {
    const deps = makeMocks();
    deps._dependencyGraph.getDependents.mockReturnValue([]);
    const abs = 'D:\\elsewhere\\b.ts';

    await buildDependencyNamespace(deps).getDependents(abs);

    expect(deps._dependencyGraph.getDependents).toHaveBeenCalledWith(abs);
    expect(deps._workspaceProvider.getWorkspaceRoot).not.toHaveBeenCalled();
  });

  it('getSymbolIndex flattens the (file → exports) map into the public shape', async () => {
    const deps = makeMocks();
    deps._dependencyGraph.getSymbolIndex.mockReturnValue(
      new Map([['a.ts', [{ name: 'foo' }, { name: 'bar' }]]]),
    );

    const out = await buildDependencyNamespace(deps).getSymbolIndex();
    expect(out).toEqual([{ file: 'a.ts', symbols: ['foo', 'bar'] }]);
  });

  it('isBuilt swallows errors by returning false', async () => {
    const deps = makeMocks();
    deps._dependencyGraph.isBuilt.mockImplementation(() => {
      throw new Error('not ready');
    });
    await expect(buildDependencyNamespace(deps).isBuilt()).resolves.toBe(false);
  });
});
