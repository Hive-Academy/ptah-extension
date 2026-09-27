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

// The SUT reads `EXTENSION_LANGUAGE_MAP` and `resolveEnrichLanguage` as
// values from `@ptah-extension/workspace-intelligence`, whose barrel
// transitively loads `vscode-core` → `vscode`. Replace the module at the
// boundary with the map's real entries and a same-algorithm reimplementation
// of `resolveEnrichLanguage` (the service classes are used as types only),
// the same pattern as `ast-namespace.builder.spec.ts`. A `require()` of the
// real module by relative path is not used here: `@nx/enforce-module-
// boundaries` treats that as a second, inconsistent import style for the
// same library across the project and fails every OTHER static import of
// `@ptah-extension/workspace-intelligence` in this project as a result. The
// authoritative "exercises the real production inference" guard for TASK_
// 2026_559 Batch 20 r1 defect 5 is the Task 20.2 bench
// (`mcp-contract.bench.spec.ts`, in workspace-intelligence), which imports
// the real, unmocked `resolveEnrichLanguage`. This copy only has to match the
// wiring/delegation this spec actually tests.
jest.mock('@ptah-extension/workspace-intelligence', () => {
  const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.go': 'go',
    '.cs': 'csharp',
    '.csx': 'csharp',
  };
  const MODULE_EXTENSION_BASE: Record<string, string> = {
    '.mts': '.ts',
    '.cts': '.ts',
    '.mjs': '.js',
    '.cjs': '.js',
  };
  const isEnrichLanguage = (v: unknown): v is 'typescript' | 'javascript' =>
    v === 'typescript' || v === 'javascript';
  const resolveEnrichLanguage = (
    filePath: string,
    language?: string,
  ): 'typescript' | 'javascript' | undefined => {
    if (isEnrichLanguage(language)) return language;
    const dot = filePath.lastIndexOf('.');
    const extension = (dot === -1 ? '' : filePath.slice(dot)).toLowerCase();
    if (extension === '.tsx') return undefined;
    const key = Object.hasOwn(MODULE_EXTENSION_BASE, extension)
      ? MODULE_EXTENSION_BASE[extension]
      : extension;
    const inferred = EXTENSION_LANGUAGE_MAP[key];
    return isEnrichLanguage(inferred) ? inferred : undefined;
  };
  // The real symbol-index naming: a type-only module, cheap to load for real.
  const { exportSymbolNames } = jest.requireActual<
    typeof import('@ptah-extension/workspace-intelligence')
  >('../../../../../workspace-intelligence/src/ast/export-extraction');
  return { EXTENSION_LANGUAGE_MAP, resolveEnrichLanguage, exportSymbolNames };
});

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
import type { SymbolIndexPage } from '../types';

import {
  buildContextNamespace,
  buildProjectNamespace,
  buildRelevanceNamespace,
  buildDependencyNamespace,
  type AnalysisNamespaceDependencies,
} from './analysis-namespace.builders';
import {
  SYMBOL_INDEX_DEFAULT_LIMIT,
  SYMBOL_INDEX_MAX_LIMIT,
} from './symbol-index-query';

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
    getCoverage: jest.Mock;
    getCoverageForFile: jest.Mock;
    reserveBuild: jest.Mock;
    getBuildState: jest.Mock;
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
    getCoverage: jest.fn(),
    getCoverageForFile: jest.fn(),
    reserveBuild: jest.fn(),
    getBuildState: jest.fn(),
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

  it('buildGraph forwards the discovered-file count; getGraphCoverage reads it back', async () => {
    const deps = makeMocks();
    deps._dependencyGraph.buildGraph.mockResolvedValue({
      nodes: new Map(),
      edges: new Map(),
      unresolvedCount: 0,
      builtAt: 1,
    });
    deps._dependencyGraph.getCoverage.mockReturnValue({
      graphedFiles: 1,
      discoveredFiles: 9,
    });
    const ns = buildDependencyNamespace(deps);

    await ns.buildGraph(['a.ts'], 'D:/ws', 9);
    await ns.buildGraph(['a.ts'], 'D:/ws');

    const calls = deps._dependencyGraph.buildGraph.mock.calls;
    expect(calls[0].slice(2)).toEqual([
      undefined,
      9,
      { yieldToForeground: false },
    ]);
    expect(calls[1].slice(2)).toEqual([
      undefined,
      undefined,
      { yieldToForeground: false },
    ]);
    await expect(ns.getGraphCoverage('D:/ws')).resolves.toEqual({
      graphedFiles: 1,
      discoveredFiles: 9,
    });
    expect(deps._dependencyGraph.getCoverage).toHaveBeenCalledWith('D:/ws');
  });

  // Batch 9b: only a build nobody awaits (the dependency tools' background
  // build) yields to the governor; an execute_code build awaits ungoverned.
  it('buildGraph asks the service to yield to the foreground only when told to', async () => {
    const deps = makeMocks();
    deps._dependencyGraph.buildGraph.mockResolvedValue({
      nodes: new Map(),
      edges: new Map(),
      unresolvedCount: 0,
      builtAt: 1,
    });
    const ns = buildDependencyNamespace(deps);

    await ns.buildGraph(['a.ts'], 'D:/ws', 3, { yieldToForeground: true });
    await ns.buildGraph(['a.ts'], 'D:/ws', 3, {});

    const calls = deps._dependencyGraph.buildGraph.mock.calls;
    expect(calls[0][4]).toEqual({ yieldToForeground: true });
    expect(calls[1][4]).toEqual({ yieldToForeground: false });
  });

  // Batch 9b review r1 F1: the background build reserves its generation
  // before discovery and builds under it.
  it('forwards a reserved generation, and reserves and reads build state from the service', async () => {
    const deps = makeMocks();
    deps._dependencyGraph.buildGraph.mockResolvedValue({
      nodes: new Map(),
      edges: new Map(),
      unresolvedCount: 0,
      builtAt: 1,
    });
    deps._dependencyGraph.reserveBuild.mockReturnValue(7);
    deps._dependencyGraph.getBuildState.mockReturnValue({
      generation: 7,
      building: false,
    });
    const ns = buildDependencyNamespace(deps);

    expect(ns.reserveGraphBuild('D:/ws')).toBe(7);
    expect(ns.getGraphBuildState('D:/ws')).toEqual({
      generation: 7,
      building: false,
    });
    await ns.buildGraph(['a.ts'], 'D:/ws', 3, {
      yieldToForeground: true,
      generation: 7,
    });

    expect(deps._dependencyGraph.reserveBuild).toHaveBeenCalledWith('D:/ws');
    expect(deps._dependencyGraph.getBuildState).toHaveBeenCalledWith('D:/ws');
    expect(deps._dependencyGraph.buildGraph.mock.calls[0][4]).toEqual({
      yieldToForeground: true,
      generation: 7,
    });
  });

  // Round 2 review R2-B1.
  it('getGraphCoverageForFile routes the path resolved as getDependents resolves it', async () => {
    const deps = makeMocks();
    deps._dependencyGraph.getCoverageForFile.mockReturnValue({
      graphedFiles: 1,
      discoveredFiles: 5_001,
    });
    const ns = buildDependencyNamespace(deps);

    await expect(ns.getGraphCoverageForFile(' C:/b/b.ts ')).resolves.toEqual({
      graphedFiles: 1,
      discoveredFiles: 5_001,
    });
    expect(deps._dependencyGraph.getCoverageForFile).toHaveBeenCalledWith(
      'C:/b/b.ts',
    );
    await ns.getGraphCoverageForFile('src/a.ts');
    expect(deps._dependencyGraph.getCoverageForFile).toHaveBeenLastCalledWith(
      path.join('D:/ws', 'src/a.ts'),
    );

    deps._workspaceProvider.getWorkspaceRoot.mockReturnValue(undefined);
    await expect(ns.getGraphCoverageForFile('src/a.ts')).resolves.toBe(
      undefined,
    );
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

  it('getSymbolIndex lists a merged name once and each wildcard re-export by source', async () => {
    const deps = makeMocks();
    deps._dependencyGraph.getSymbolIndex.mockReturnValue(
      new Map([
        [
          'index.ts',
          [
            { name: 'M', kind: 'interface' },
            { name: 'M', kind: 'namespace' },
            { name: '*', kind: 'wildcard', isReExport: true, source: './a' },
            { name: '*', kind: 'wildcard', isReExport: true, source: './b' },
          ],
        ],
      ]),
    );

    const out = await buildDependencyNamespace(deps).getSymbolIndex();
    expect(out).toEqual([
      { file: 'index.ts', symbols: ['M', '* from ./a', '* from ./b'] },
    ]);
  });

  describe('getSymbolIndex paging (TASK_2026_559 Batch 9)', () => {
    const LIBS = 10;
    const ENTRIES = 3_000;

    /** File i of the synthetic index: `D:/ws/libs/lib-<i % 10>/src/file-<i>.ts`. */
    function fileOf(i: number): string {
      return `D:/ws/libs/lib-${i % LIBS}/src/file-${String(i).padStart(4, '0')}.ts`;
    }

    /** A 3,000-entry index, inserted in reverse path order. */
    function syntheticIndex(): Map<string, Array<{ name: string }>> {
      const index = new Map<string, Array<{ name: string }>>();
      for (let i = ENTRIES - 1; i >= 0; i--) {
        index.set(fileOf(i), [{ name: `Export${i}` }]);
      }
      return index;
    }

    function namespaceOver(
      index: Map<string, Array<{ name: string }>> = syntheticIndex(),
      /** `null`: the provider knows no workspace root. */
      root: string | null = 'D:/ws',
    ) {
      const deps = makeMocks();
      deps._dependencyGraph.getSymbolIndex.mockReturnValue(index);
      deps._workspaceProvider.getWorkspaceRoot.mockReturnValue(
        root ?? undefined,
      );
      return { ns: buildDependencyNamespace(deps), deps };
    }

    const sortedFiles = Array.from({ length: ENTRIES }, (_, i) =>
      fileOf(i),
    ).sort();

    it('keeps the unpaged array, in index order, for callers passing only workspaceRoot', async () => {
      const { ns, deps } = namespaceOver();
      const out = await ns.getSymbolIndex('D:/ws');
      expect(Array.isArray(out)).toBe(true);
      expect(out).toHaveLength(ENTRIES);
      expect(out[0]).toEqual({
        file: fileOf(ENTRIES - 1),
        symbols: ['Export2999'],
      });
      expect(deps._dependencyGraph.getSymbolIndex).toHaveBeenCalledWith(
        'D:/ws',
      );
    });

    it('returns the default page, ordered by path, with nextOffset', async () => {
      const { ns } = namespaceOver();
      const page = await ns.getSymbolIndex(undefined, {});
      expect(page.count).toBe(SYMBOL_INDEX_DEFAULT_LIMIT);
      expect(page.total).toBe(ENTRIES);
      expect(page.offset).toBe(0);
      expect(page.nextOffset).toBe(SYMBOL_INDEX_DEFAULT_LIMIT);
      expect(page.files.map((f) => f.file)).toEqual(
        sortedFiles.slice(0, SYMBOL_INDEX_DEFAULT_LIMIT),
      );
    });

    it('filters by a workspace-relative prefix and counts total after the filter', async () => {
      const { ns } = namespaceOver();
      const page = await ns.getSymbolIndex(undefined, {
        pathPrefix: 'libs/lib-3/',
        limit: 1000,
      });
      expect(page.total).toBe(ENTRIES / LIBS);
      expect(page.count).toBe(ENTRIES / LIBS);
      expect(page.nextOffset).toBeUndefined();
      expect(
        page.files.every((f) => f.file.startsWith('D:/ws/libs/lib-3/')),
      ).toBe(true);
    });

    it('treats Windows separators, case and an absolute prefix as the same filter', async () => {
      const { ns } = namespaceOver();
      const relative = await ns.getSymbolIndex(undefined, {
        pathPrefix: 'libs/lib-3/',
      });
      for (const pathPrefix of [
        'LIBS\\Lib-3\\',
        '.\\libs\\lib-3\\',
        'd:\\WS\\libs\\lib-3\\',
        'D:/ws/libs//lib-3/',
      ]) {
        await expect(
          ns.getSymbolIndex(undefined, { pathPrefix }),
        ).resolves.toEqual(relative);
      }
    });

    it('matches a POSIX prefix case-sensitively and a UNC prefix case-insensitively', async () => {
      const { ns } = namespaceOver(
        new Map([
          ['/repo/src/Alpha.ts', [{ name: 'Alpha' }]],
          ['//srv/share/src/beta.ts', [{ name: 'beta' }]],
        ]),
        '/repo',
      );
      expect(
        (await ns.getSymbolIndex(undefined, { pathPrefix: '/repo/src/alpha' }))
          .total,
      ).toBe(0);
      expect(
        (await ns.getSymbolIndex(undefined, { pathPrefix: 'src/Alpha' })).total,
      ).toBe(1);
      expect(
        (await ns.getSymbolIndex(undefined, { pathPrefix: '\\\\SRV\\Share\\' }))
          .files,
      ).toEqual([{ file: '//srv/share/src/beta.ts', symbols: ['beta'] }]);
    });

    it('answers a prefix that matches nothing with an empty page and no nextOffset', async () => {
      const { ns } = namespaceOver();
      await expect(
        ns.getSymbolIndex(undefined, { pathPrefix: 'apps/' }),
      ).resolves.toEqual({ files: [], count: 0, total: 0, offset: 0 });
    });

    it('matches nothing with a relative prefix when no workspace root is known', async () => {
      const { ns } = namespaceOver(syntheticIndex(), null);
      await expect(
        ns.getSymbolIndex(undefined, { pathPrefix: 'libs/' }),
      ).resolves.toEqual({ files: [], count: 0, total: 0, offset: 0 });
    });

    it('continues with nextOffset until the last page, which has no nextOffset', async () => {
      const { ns } = namespaceOver();
      const seen: string[] = [];
      let offset: number | undefined = 0;
      let pages = 0;
      while (offset !== undefined) {
        const page: SymbolIndexPage = await ns.getSymbolIndex(undefined, {
          limit: 700,
          offset,
        });
        expect(page.offset).toBe(offset);
        seen.push(...page.files.map((f) => f.file));
        offset = page.nextOffset;
        pages++;
      }
      expect(pages).toBe(5);
      expect(seen).toEqual(sortedFiles);
    });

    it('returns a short last page without nextOffset, and an empty page past the end', async () => {
      const { ns } = namespaceOver();
      const last = await ns.getSymbolIndex(undefined, { offset: ENTRIES - 10 });
      expect(last.count).toBe(10);
      expect(last.nextOffset).toBeUndefined();
      expect(last.files.map((f) => f.file)).toEqual(sortedFiles.slice(-10));

      await expect(
        ns.getSymbolIndex(undefined, { offset: ENTRIES + 5 }),
      ).resolves.toEqual({
        files: [],
        count: 0,
        total: ENTRIES,
        offset: ENTRIES + 5,
      });
    });

    it.each([
      [{ limit: 0 }],
      [{ limit: SYMBOL_INDEX_MAX_LIMIT + 1 }],
      [{ limit: 1.5 }],
      [{ offset: -1 }],
      [{ pathPrefix: '../elsewhere' }],
      [{ pathPrefix: 'C:libs' }],
    ])('throws a RangeError for the invalid query %j', async (query) => {
      const { ns } = namespaceOver();
      await expect(ns.getSymbolIndex(undefined, query)).rejects.toBeInstanceOf(
        RangeError,
      );
    });
  });

  it('isBuilt swallows errors by returning false', async () => {
    const deps = makeMocks();
    deps._dependencyGraph.isBuilt.mockImplementation(() => {
      throw new Error('not ready');
    });
    await expect(buildDependencyNamespace(deps).isBuilt()).resolves.toBe(false);
  });
});
