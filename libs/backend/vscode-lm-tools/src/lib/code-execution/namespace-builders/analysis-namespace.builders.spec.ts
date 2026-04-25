/**
 * Specs for analysis-namespace.builders (TASK_2026_100 P1.B5).
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
    ).toHaveBeenCalledWith('src/a.ts', 'typescript');
    expect(out.content).toBe('// ok');
  });

  it('enrichFile swallows errors and returns an error-mode result', async () => {
    const deps = makeMocks();
    deps._contextEnrichment.generateStructuralSummary.mockRejectedValue(
      new Error('bad'),
    );

    const out = await buildContextNamespace(deps).enrichFile('src/a.ts');
    expect(out.content).toMatch(/Error generating structural summary: bad/);
    expect(out.tokenCount).toBe(0);
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
