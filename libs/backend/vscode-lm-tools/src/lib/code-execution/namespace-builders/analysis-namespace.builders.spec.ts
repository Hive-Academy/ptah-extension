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

import 'reflect-metadata';

// Real grammars for the Batch 29b real-dispatcher enrich specs at the end of
// this file: the lib-wide wasm-bundle-dir stub throws on purpose, and
// web-tree-sitter must load grammars from bytes (the shims
// `code-outliner.adapter.spec.ts` documents).
jest.mock('wasm-bundle-dir', () => {
  const nodePath = require('path');
  const grammarDir = nodePath.join(
    nodePath.dirname(require.resolve('@vscode/tree-sitter-wasm/package.json')),
    'wasm',
  );
  const runtimeDir = nodePath.dirname(require.resolve('web-tree-sitter'));
  return {
    BUNDLE_DIR: grammarDir,
    resolveWasmPath: (filename: string) =>
      filename.startsWith('web-tree-sitter')
        ? nodePath.join(runtimeDir, filename)
        : nodePath.join(grammarDir, filename),
  };
});

jest.mock('web-tree-sitter', () => {
  const actual =
    jest.requireActual<typeof import('web-tree-sitter')>('web-tree-sitter');
  const nodeFs = require('fs');
  const loadFromPathOrBuffer = actual.Language.load.bind(actual.Language);
  actual.Language.load = (input: string | Uint8Array) =>
    loadFromPathOrBuffer(
      typeof input === 'string'
        ? new Uint8Array(nodeFs.readFileSync(input))
        : input,
    );
  return actual;
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_WORKSPACE_EXCLUDES,
  DependencyGraphService,
  ContextEnrichmentService as RealContextEnrichmentService,
  TreeSitterParserService,
  type AstAnalysisService,
  type ContextSizeOptimizerService,
  type MonorepoDetectorService,
  type DependencyAnalyzerService,
  type FileRelevanceScorerService,
  type FileSystemService,
  type TokenCounterService,
  type WorkspaceIndexerService,
  type ProjectDetectorService,
  type WorkspaceAnalyzerService,
  type ContextEnrichmentService,
} from '@ptah-extension/workspace-intelligence';
import { Result } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  IncompleteFileSearchError,
  collectBounded,
  createFailureTally,
  walkGlobMatches,
  type IFileSystemProvider,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { MCPRequest, PtahAPI, SymbolIndexPage } from '../types';
import {
  handleMCPRequest,
  type ProtocolHandlerDependencies,
} from '../mcp-core/protocol-dispatcher';

import {
  GRAPH_CENSUS_LIMIT,
  GRAPH_VENDOR_EXCLUDES,
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

/**
 * `IFileSystemProvider.findFiles` exactly as the Electron adapter runs a
 * bounded call (`walkGlobMatches` stopped at `maxResults`), over a real
 * directory. This lib may not import the platform adapters (module
 * boundaries); their own specs pin that they honour the same glob form.
 */
async function fastGlobFindFiles(
  pattern: string,
  exclude: string[],
  maxResults: number,
  cwd: string,
): Promise<string[]> {
  const tally = createFailureTally();
  const matches = await collectBounded(
    walkGlobMatches(pattern, {
      exclude,
      cwd,
      dot: true,
      onFailure: tally.onFailure,
    }),
    maxResults,
  );
  const failures = tally.failures();
  if (failures !== undefined) {
    throw new IncompleteFileSearchError(matches, failures);
  }
  return matches;
}

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
    getUnextractedExports: jest.Mock;
    isBuilt: jest.Mock;
    getCoverageReport: jest.Mock;
    getCoverageReportForFile: jest.Mock;
    resolveNodePath: jest.Mock;
    graphSpellingsOf: jest.Mock;
    reserveBuild: jest.Mock;
    getBuildState: jest.Mock;
  };
  _workspaceProvider: { getWorkspaceRoot: jest.Mock };
  _fileSystemProvider: { findFiles: jest.Mock };
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
    // Every export read (Batch 24d): no entry carries `unextractedExports`.
    getUnextractedExports: jest.fn().mockReturnValue(undefined),
    isBuilt: jest.fn(),
    getCoverageReport: jest.fn(),
    getCoverageReportForFile: jest.fn(),
    resolveNodePath: jest.fn(),
    graphSpellingsOf: jest.fn().mockReturnValue([]),
    reserveBuild: jest.fn(),
    getBuildState: jest.fn(),
  };
  const _workspaceProvider = {
    getWorkspaceRoot: jest.fn().mockReturnValue('D:/ws'),
  };
  const _fileSystemProvider = { findFiles: jest.fn().mockResolvedValue([]) };

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
    fileSystemProvider: _fileSystemProvider as unknown as IFileSystemProvider,
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
    _fileSystemProvider,
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
      ['src/App.tsx', 'tsx'],
      ['src/App.TSX', 'tsx'],
    ])('infers %s → %s when no language is given', async (file, expected) => {
      await expect(forwardedLanguage(file)).resolves.toBe(expected);
    });

    it.each([
      ['src/a.py'],
      ['src/a.go'],
      ['src/a.cs'],
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

    it('forwards an explicit typescript for a .tsx file (the service then refuses a JSX parse)', async () => {
      await expect(
        forwardedLanguage('src/App.tsx', 'typescript'),
      ).resolves.toBe('typescript');
    });

    it('explicit tsx and the .tsx inference agree', async () => {
      await expect(forwardedLanguage('src/a.tsx', 'tsx')).resolves.toBe('tsx');
      await expect(forwardedLanguage('src/a.tsx')).resolves.toBe('tsx');
      // An explicit summary language wins over the extension, tsx included.
      await expect(forwardedLanguage('src/a.mts', 'tsx')).resolves.toBe('tsx');
    });

    it('ignores an unsupported explicit value and infers from the extension', async () => {
      await expect(forwardedLanguage('src/a.mts', 'python')).resolves.toBe(
        'typescript',
      );
      await expect(
        forwardedLanguage('src/a.tsx', 'typescriptreact'),
      ).resolves.toBe('tsx');
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
        mode: 'structural',
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
    const languages = { clean: true, reasons: [] };
    deps._dependencyGraph.getCoverageReport.mockReturnValue({
      files: { graphedFiles: 1, discoveredFiles: 9 },
      languages,
    });
    const ns = buildDependencyNamespace(deps);

    await ns.buildGraph(['a.ts'], 'D:/ws', 9);
    await ns.buildGraph(['a.ts'], 'D:/ws');

    const calls = deps._dependencyGraph.buildGraph.mock.calls;
    expect(calls[0].slice(2)).toEqual([9, { yieldToForeground: false }]);
    expect(calls[1].slice(2)).toEqual([
      undefined,
      { yieldToForeground: false },
    ]);
    await expect(ns.getGraphCoverage('D:/ws')).resolves.toEqual({
      graphedFiles: 1,
      discoveredFiles: 9,
      coverage: languages,
    });
    expect(deps._dependencyGraph.getCoverageReport).toHaveBeenCalledWith(
      'D:/ws',
    );
  });

  it('getGraphCoverage with no graph built is unknown, never clean', async () => {
    const deps = makeMocks();
    deps._dependencyGraph.getCoverageReport.mockReturnValue(undefined);

    const out = await buildDependencyNamespace(deps).getGraphCoverage();

    expect(out).not.toHaveProperty('graphedFiles');
    expect(out.coverage).toMatchObject({
      clean: false,
      census: 'unknown',
      analyzed: null,
      // Python and Go since Batch 33.
      supportedLanguages: [
        'typescript',
        'javascript',
        'tsx',
        'python',
        'go',
        'csharp',
      ],
    });
    expect(out.coverage.reasons[0]).toBe('census?');
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
    expect(calls[0][3]).toEqual({ yieldToForeground: true });
    expect(calls[1][3]).toEqual({ yieldToForeground: false });
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
    expect(deps._dependencyGraph.buildGraph.mock.calls[0][3]).toEqual({
      yieldToForeground: true,
      generation: 7,
    });
  });

  // Round 2 review R2-B1.
  it('getGraphCoverageForFile routes the path resolved as getDependents resolves it', async () => {
    const deps = makeMocks();
    const languages = { clean: true, reasons: [] };
    deps._dependencyGraph.getCoverageReportForFile.mockReturnValue({
      files: { graphedFiles: 1, discoveredFiles: 5_001 },
      languages,
    });
    deps._dependencyGraph.resolveNodePath.mockReturnValue('C:/b/b.ts');
    const ns = buildDependencyNamespace(deps);

    await expect(ns.getGraphCoverageForFile(' C:/b/b.ts ')).resolves.toEqual({
      graphedFiles: 1,
      discoveredFiles: 5_001,
      coverage: languages,
      nodePath: 'C:/b/b.ts',
    });
    expect(deps._dependencyGraph.getCoverageReportForFile).toHaveBeenCalledWith(
      'C:/b/b.ts',
    );
    expect(deps._dependencyGraph.resolveNodePath).toHaveBeenCalledWith(
      'C:/b/b.ts',
    );
    deps._dependencyGraph.resolveNodePath.mockReturnValue(undefined);
    await expect(
      ns.getGraphCoverageForFile('src/a.ts'),
    ).resolves.not.toHaveProperty('nodePath');
    expect(
      deps._dependencyGraph.getCoverageReportForFile,
    ).toHaveBeenLastCalledWith(path.join('D:/ws', 'src/a.ts'));

    deps._workspaceProvider.getWorkspaceRoot.mockReturnValue(undefined);
    const unknown = await ns.getGraphCoverageForFile('src/a.ts');
    expect(unknown).not.toHaveProperty('graphedFiles');
    expect(unknown.coverage).toMatchObject({ clean: false, census: 'unknown' });
  });

  describe('unsupportedGraphLanguage (TASK_2026_559 Batch 23b)', () => {
    it.each([
      ['src/a.ts'],
      ['src/view.tsx'],
      ['src/a.js'],
      ['src/a.jsx'],
      ['src/tool.py'],
      ['src/main.go'],
      ['src/Program.cs'],
    ])('%s is graph-capable: no answer', (file) => {
      expect(
        buildDependencyNamespace(makeMocks()).unsupportedGraphLanguage(file),
      ).toBeUndefined();
    });

    it.each([
      // Kotlin never gets graph edges (Decision 19); Java's graph (Task
      // 34.2) is deferred (User Decision 27).
      ['App.kt', 'kotlin', 'kotlin files (.kt)'],
      ['Main.java', 'java', 'java files (.java)'],
      ['esm.mjs', 'javascript', 'javascript files (.mjs)'],
      ['build.zig', '.zig', 'Files with extension ".zig"'],
      ['README.md', '.md', 'Files with extension ".md"'],
      ['Makefile', 'unknown', 'Files without an extension'],
    ])('%s answers unsupported-language (%s)', (file, language, subject) => {
      const answer = buildDependencyNamespace(
        makeMocks(),
      ).unsupportedGraphLanguage(` src/${file} `);
      expect(answer).toEqual({
        status: 'unsupported-language',
        language,
        supportedLanguages: [
          'typescript',
          'javascript',
          'tsx',
          'python',
          'go',
          'csharp',
        ],
        message: expect.stringContaining(subject),
      });
      expect(answer?.message).toContain(
        'Graph languages: typescript, javascript',
      );
    });
  });

  describe('discoverSourceFiles (TASK_2026_559 Batch 23b)', () => {
    it('asks for one past the census limit with the vendor excludes inside the walk', async () => {
      const deps = makeMocks();
      deps._fileSystemProvider.findFiles.mockResolvedValue([
        'D:/ws/src/a.ts',
        'src/b.py',
      ]);

      const out =
        await buildDependencyNamespace(deps).discoverSourceFiles('D:/ws');

      const [glob, excludes, maxResults, cwd] =
        deps._fileSystemProvider.findFiles.mock.calls[0];
      expect(maxResults).toBe(50_001);
      expect(cwd).toBe('D:/ws');
      expect(excludes).toEqual([
        ...DEFAULT_WORKSPACE_EXCLUDES,
        ...GRAPH_VENDOR_EXCLUDES,
      ]);
      expect(GRAPH_VENDOR_EXCLUDES).toEqual([
        '**/.venv/**',
        '**/venv/**',
        '**/site-packages/**',
        '**/__pycache__/**',
        '**/vendor/**',
        '**/obj/**',
        '**/bin/**',
        '**/.gradle/**',
        '**/Pods/**',
      ]);
      // Recognised-unsupported extensions come through the same call, each
      // in every letter case (r1 B1): `ts` as `[tT][sS]`, `c++` keeps `+`.
      for (const extension of [
        '[tT][sS]',
        '[tT][sS][xX]',
        '[jJ][sS]',
        '[pP][yY]',
        '[jJ][aA][vV][aA]',
        '[rR][sS]',
        '[kK][tT]',
        '[rR]',
        '[cC][+][+]',
      ]) {
        expect(
          glob.includes(`{${extension},`) ||
            glob.includes(`,${extension},`) ||
            glob.includes(`,${extension}}`),
        ).toBe(true);
      }
      expect(glob).not.toMatch(/[{,]ts[,}]/);
      expect(out).toEqual({
        files: ['D:/ws/src/a.ts', path.join('D:/ws', 'src/b.py')],
        truncated: false,
        limit: GRAPH_CENSUS_LIMIT,
      });
    });

    it('is truncated at limit + 1 files and returns only limit of them', async () => {
      const deps = makeMocks();
      deps._fileSystemProvider.findFiles.mockResolvedValue(
        Array.from({ length: 4 }, (_, i) => `D:/ws/f${i}.ts`),
      );

      const out = await buildDependencyNamespace(deps).discoverSourceFiles(
        'D:/ws',
        3,
      );

      expect(deps._fileSystemProvider.findFiles.mock.calls[0][2]).toBe(4);
      expect(out).toEqual({
        files: ['D:/ws/f0.ts', 'D:/ws/f1.ts', 'D:/ws/f2.ts'],
        truncated: true,
        limit: 3,
      });
    });

    it.each([[0], [1.5], [50_001], [Number.NaN]])(
      'rejects limit %p without walking',
      async (limit) => {
        const deps = makeMocks();
        await expect(
          buildDependencyNamespace(deps).discoverSourceFiles('D:/ws', limit),
        ).rejects.toThrow(RangeError);
        expect(deps._fileSystemProvider.findFiles).not.toHaveBeenCalled();
      },
    );

    // FB "vendor tree does not exhaust discovery": a vendor tree larger than
    // the census limit, walked before the project's code, through the same
    // fast-glob call the Electron and CLI providers make.
    it('a vendor tree larger than the limit does not exhaust discovery', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-b23b-vendor-'));
      try {
        for (const vendor of ['vendor/lib', '.venv/site', 'bin', 'obj']) {
          fs.mkdirSync(path.join(root, vendor), { recursive: true });
          for (let i = 0; i < 8; i++) {
            fs.writeFileSync(path.join(root, vendor, `v${i}.ts`), '');
          }
        }
        fs.mkdirSync(path.join(root, 'src'));
        fs.writeFileSync(path.join(root, 'src', 'app.ts'), '');
        fs.writeFileSync(path.join(root, 'src', 'tool.py'), '');
        const deps = makeMocks();
        deps._fileSystemProvider.findFiles.mockImplementation(
          fastGlobFindFiles,
        );

        const out = await buildDependencyNamespace(deps).discoverSourceFiles(
          root,
          5,
        );

        expect(out.truncated).toBe(false);
        expect(out.files.map((f) => path.basename(f)).sort()).toEqual([
          'app.ts',
          'tool.py',
        ]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    // r1 B1 (FB): upper- and mixed-case extensions were never discovered, so
    // the graph published a clean complete census without them. The
    // provider is the Electron/CLI adapters' own fast-glob call.
    it('discovers and counts upper-case extensions (APP.TS, analysis.R)', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-b23b-case-'));
      try {
        fs.mkdirSync(path.join(root, 'src'));
        fs.writeFileSync(path.join(root, 'src', 'APP.TS'), '');
        fs.writeFileSync(path.join(root, 'src', 'analysis.R'), '');
        fs.writeFileSync(path.join(root, 'src', 'Lib.Js'), '');
        // r2: `.c++` (non-letter characters) was never matched either.
        fs.writeFileSync(path.join(root, 'src', 'engine.C++'), '');
        const deps = makeMocks();
        deps._fileSystemProvider.findFiles.mockImplementation(
          fastGlobFindFiles,
        );
        const graph = new DependencyGraphService(
          {
            analyzeSource: jest.fn(async () =>
              Result.ok({
                imports: [],
                exports: [],
                functions: [],
                classes: [],
              }),
            ),
          } as unknown as AstAnalysisService,
          {
            readFile: jest.fn(async () => 'source'),
          } as unknown as FileSystemService,
          {
            info: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          } as unknown as Logger,
        );
        const ns = buildDependencyNamespace({
          ...deps,
          dependencyGraph: graph,
        });

        const discovery = await ns.discoverSourceFiles(root);
        expect(discovery.files.map((f) => path.basename(f)).sort()).toEqual([
          'APP.TS',
          'Lib.Js',
          'analysis.R',
          'engine.C++',
        ]);
        await ns.buildGraph(discovery.files, root, discovery.files.length);

        const { coverage } = await ns.getGraphCoverage(root);
        expect(coverage).toMatchObject({
          clean: false,
          census: 'complete',
          analyzed: 2,
          unsupported: 2,
          unsupportedByLanguage: { cpp: 1, r: 1 },
        });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    // r3 B1 (FB): an unreadable directory made a clean, complete census.
    it.each([
      ['a subtree', 'locked'],
      ['the root', ''],
    ])(
      'an EIO opening %s is returned as unreadable and the graph census is unknown',
      async (_label, failing) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-b23b-eio-'));
        const opendir = fs.promises.opendir.bind(fs.promises);
        try {
          fs.mkdirSync(path.join(root, 'src'));
          fs.mkdirSync(path.join(root, 'locked'));
          fs.writeFileSync(path.join(root, 'src', 'APP.TS'), '');
          fs.writeFileSync(path.join(root, 'locked', 'hidden.ts'), '');
          const failingDir = path.resolve(root, failing);
          jest
            .spyOn(fs.promises, 'opendir')
            .mockImplementation(async (dir, options) => {
              if (path.resolve(String(dir)) === failingDir) {
                throw Object.assign(new Error('EIO'), { code: 'EIO' });
              }
              return opendir(dir, options);
            });
          const deps = makeMocks();
          deps._fileSystemProvider.findFiles.mockImplementation(
            fastGlobFindFiles,
          );
          const graph = new DependencyGraphService(
            {
              analyzeSource: jest.fn(async () =>
                Result.ok({
                  imports: [],
                  exports: [],
                  functions: [],
                  classes: [],
                }),
              ),
            } as unknown as AstAnalysisService,
            {
              readFile: jest.fn(async () => 'source'),
            } as unknown as FileSystemService,
            {
              info: jest.fn(),
              debug: jest.fn(),
              warn: jest.fn(),
              error: jest.fn(),
            } as unknown as Logger,
          );
          const ns = buildDependencyNamespace({
            ...deps,
            dependencyGraph: graph,
          });

          const discovery = await ns.discoverSourceFiles(root);
          expect(discovery.unreadable).toEqual({
            paths: 1,
            byCode: { EIO: 1 },
          });
          expect(discovery.files.map((f) => path.basename(f))).toEqual(
            failing === '' ? [] : ['APP.TS'],
          );
          await ns.buildGraph(discovery.files, root, discovery.files.length, {
            censusUnknown: true,
          });

          const { coverage } = await ns.getGraphCoverage(root);
          expect(coverage).toMatchObject({ clean: false, census: 'unknown' });
          expect(coverage.reasons[0]).toBe('census?');
        } finally {
          jest.restoreAllMocks();
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    );
  });

  // r1 B2 (FB): the reviewer's junction probes. The graph is built through a
  // junction alias; its real target spelling must answer the symbol-index
  // prefix and dependency queries alike, and keep answering them after an
  // unrelated second root is cached.
  describe('r1 B2 real-target spellings of a junction root', () => {
    const onWin32 = process.platform === 'win32';
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ptah-b23b-r1-alias-'),
    );
    const realRoot = path.join(tempDir, 'real');
    const aliasRoot = path.join(tempDir, 'alias');
    const otherRoot = path.join(tempDir, 'other');
    fs.mkdirSync(path.join(realRoot, 'pkg'), { recursive: true });
    fs.mkdirSync(otherRoot);
    for (const name of ['A.ts', 'B.ts']) {
      fs.writeFileSync(path.join(realRoot, 'pkg', name), '');
    }
    let linked = true;
    try {
      fs.symlinkSync(realRoot, aliasRoot, onWin32 ? 'junction' : 'dir');
    } catch (error: unknown) {
      linked = false;
      console.warn(
        `[r1 B2] junction spec skipped: cannot create a directory link (${String(error)})`,
      );
    }
    const alias = aliasRoot.replace(/\\/g, '/');
    const real = realRoot.replace(/\\/g, '/');
    const A = `${alias}/pkg/A.ts`;
    const B = `${alias}/pkg/B.ts`;
    const itLinked = linked ? it : it.skip;

    afterAll(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    /** The alias graph, but rooted at alias/pkg (the reviewer's r2 root). */
    async function pkgRootedGraph() {
      const { graph, ns, deps } = await aliasGraph();
      graph.evict(alias);
      await graph.buildGraph([A, B], `${alias}/pkg`, undefined, {});
      return { graph, ns, deps };
    }

    async function aliasGraph() {
      const graph = new DependencyGraphService(
        {
          analyzeSource: jest.fn(async (_c: string, _l: string, p: string) =>
            Result.ok({
              imports: p === A ? [{ source: './B', importedSymbols: [] }] : [],
              exports: [{ name: path.posix.basename(p, '.ts') }],
              functions: [],
              classes: [],
            }),
          ),
        } as unknown as AstAnalysisService,
        {
          readFile: jest.fn(async () => 'source'),
        } as unknown as FileSystemService,
        {
          info: jest.fn(),
          debug: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        } as unknown as Logger,
      );
      const deps = makeMocks();
      deps._workspaceProvider.getWorkspaceRoot.mockReturnValue(alias);
      const ns = buildDependencyNamespace({ ...deps, dependencyGraph: graph });
      await graph.buildGraph([A, B], alias, undefined, {});
      return { graph, ns, deps };
    }

    itLinked(
      'a real-target pathPrefix pages the same entries as the alias prefix',
      async () => {
        const { ns } = await aliasGraph();
        const viaAlias = await ns.getSymbolIndex(undefined, {
          pathPrefix: `${alias}/pkg/`,
        });
        const viaTarget = await ns.getSymbolIndex(undefined, {
          pathPrefix: `${real}/pkg/`,
        });
        expect(viaAlias.total).toBe(2);
        expect(viaTarget).toEqual(viaAlias);
        // A sibling-named directory is not under the prefix.
        const sibling = await ns.getSymbolIndex(undefined, {
          pathPrefix: `${real}/pk/`,
        });
        expect(sibling.total).toBe(0);
      },
    );

    // r2 B1 (FB): the reviewer's case. Graph and session rooted at
    // alias/pkg; a prefix above the root in its real spelling returned a
    // clean empty page while the alias ancestor returned both files.
    itLinked(
      'r2 B1: ancestor, equal and descendant prefixes select the alias/pkg graph in both spellings',
      async () => {
        const { graph, ns, deps } = await pkgRootedGraph();
        // An unrelated second graph must not leak into any prefix below.
        const other = otherRoot.replace(/\\/g, '/');
        await graph.buildGraph([`${other}/x.ts`], other, undefined, {});
        deps._workspaceProvider.getWorkspaceRoot.mockReturnValue(
          `${alias}/pkg`,
        );
        const page = (pathPrefix: string) =>
          ns.getSymbolIndex(undefined, { pathPrefix });
        const both = [A, B];
        for (const prefix of [
          `${real}`,
          `${real}/`,
          `${alias}`,
          `${alias}/`,
          `${real}/pkg`,
          `${real}/pkg/`,
          `${alias}/pkg/`,
          '.', // the session root itself
        ]) {
          const result = await page(prefix);
          expect({
            prefix,
            files: result.files.map((entry) => entry.file),
          }).toEqual({ prefix, files: both });
        }
        // A descendant (partial name) selects only its file, in either spelling.
        for (const prefix of [`${real}/pkg/A`, `${alias}/pkg/A`]) {
          expect((await page(prefix)).files.map((entry) => entry.file)).toEqual(
            [A],
          );
        }
        // A sibling path that is not above the root selects nothing.
        expect((await page(`${real}x/`)).total).toBe(0);
        expect((await page(`${real}/pk/`)).total).toBe(0);
      },
    );

    itLinked(
      'a real-target dependency query keeps answering after an unrelated root is cached',
      async () => {
        const { graph, ns } = await aliasGraph();
        const realA = `${real}/pkg/A.ts`;
        await expect(ns.getDependencies(realA)).resolves.toEqual([B]);

        await graph.buildGraph(
          [`${otherRoot.replace(/\\/g, '/')}/x.ts`],
          otherRoot,
          undefined,
          {},
        );

        await expect(ns.getDependencies(realA)).resolves.toEqual([B]);
        await expect(ns.getDependents(`${real}/pkg/B.ts`)).resolves.toEqual([
          A,
        ]);
        const covered = await ns.getGraphCoverageForFile(realA);
        expect(covered).toMatchObject({ nodePath: A });
        expect(covered.coverage).toMatchObject({
          clean: true,
          census: 'complete',
        });
      },
    );
  });

  // Batch 23b carried criterion R4-B1 (User Decision 20): the reviewer's
  // namespace probe, through the real namespace path resolution and the real
  // graph service (only reads and parses are stubbed).
  describe('R4-B1 case-variant query paths (real graph service)', () => {
    const onWin32 = process.platform === 'win32';
    const ROOT = 'D:/Repo';
    const A = 'D:/Repo/Pkg/A.ts';
    const B = 'D:/Repo/Pkg/B.ts';

    async function probe() {
      const graph = new DependencyGraphService(
        {
          analyzeSource: jest.fn(async (_c: string, _l: string, p: string) =>
            Result.ok({
              imports: p === A ? [{ source: './B', importedSymbols: [] }] : [],
              exports: [{ name: path.posix.basename(p, '.ts') }],
              functions: [],
              classes: [],
            }),
          ),
        } as unknown as AstAnalysisService,
        {
          readFile: jest.fn(async () => 'source'),
        } as unknown as FileSystemService,
        {
          info: jest.fn(),
          debug: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        } as unknown as Logger,
      );
      const deps = makeMocks();
      deps._workspaceProvider.getWorkspaceRoot.mockReturnValue(ROOT);
      const ns = buildDependencyNamespace({ ...deps, dependencyGraph: graph });
      await graph.buildGraph([A, B], ROOT, undefined, {});
      return ns;
    }

    it('the matching-case control returns the edge with its stored spelling', async () => {
      const ns = await probe();
      await expect(ns.getDependencies('Pkg/A.ts')).resolves.toEqual([B]);
      await expect(ns.getDependents(B)).resolves.toEqual([A]);
      const covered = await ns.getGraphCoverageForFile('Pkg/A.ts');
      expect(covered).toMatchObject({ nodePath: A });
      expect(covered.coverage.clean).toBe(true);
    });

    (onWin32 ? it.each : it.skip.each)([
      ['relative', 'pkg/a.ts', 'pkg/b.ts'],
      ['absolute', 'd:/repo/pkg/a.ts', 'd:/repo/pkg/b.ts'],
    ])(
      'a %s case variant returns the same edge, never [] with clean coverage',
      async (_label, aVariant, bVariant) => {
        const ns = await probe();
        await expect(ns.getDependencies(aVariant)).resolves.toEqual([B]);
        await expect(ns.getDependents(bVariant)).resolves.toEqual([A]);
        await expect(
          ns.getGraphCoverageForFile(aVariant),
        ).resolves.toMatchObject({ nodePath: A });
      },
    );

    it('a relative pathPrefix of another case pages the same entries on Windows paths', async () => {
      const ns = await probe();
      const exact = await ns.getSymbolIndex(ROOT, { pathPrefix: 'Pkg/' });
      const variant = await ns.getSymbolIndex(ROOT, { pathPrefix: 'pkg/' });
      const absolute = await ns.getSymbolIndex(ROOT, {
        pathPrefix: 'd:/repo/pkg/',
      });
      expect(exact.total).toBe(2);
      expect(variant).toEqual(exact);
      expect(absolute).toEqual(exact);
    });
  });

  // Batch 32c: the namespace passes no tsconfig `paths` to the service; the
  // service's resolver context reads the root tsconfig itself, so an alias
  // import still becomes an edge through the namespace path.
  it('buildGraph resolves a root tsconfig alias with no paths argument (real graph service)', async () => {
    const root = fs
      .realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-32c-')))
      .replace(/\\/g, '/');
    try {
      fs.writeFileSync(
        path.join(root, 'tsconfig.json'),
        '{ "compilerOptions": { "paths": { "@app/*": ["src/*"] } } }',
      );
      const consumer = `${root}/a.ts`;
      const util = `${root}/src/util.ts`;
      const graph = new DependencyGraphService(
        {
          analyzeSource: jest.fn(async (_c: string, _l: string, p: string) =>
            Result.ok({
              imports:
                p === consumer
                  ? [{ source: '@app/util', importedSymbols: [] }]
                  : [],
              exports: p === util ? [{ name: 'util' }] : [],
              functions: [],
              classes: [],
            }),
          ),
        } as unknown as AstAnalysisService,
        {
          readFile: jest.fn(async () => 'source'),
        } as unknown as FileSystemService,
        {
          info: jest.fn(),
          debug: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        } as unknown as Logger,
      );
      const deps = makeMocks();
      deps._workspaceProvider.getWorkspaceRoot.mockReturnValue(root);
      const ns = buildDependencyNamespace({ ...deps, dependencyGraph: graph });

      const out = await ns.buildGraph(['a.ts', 'src/util.ts'], root);

      expect(out).toMatchObject({ nodeCount: 2, edgeCount: 1 });
      await expect(ns.getDependents(util)).resolves.toEqual([consumer]);
      const { coverage } = await ns.getGraphCoverage(root);
      expect(coverage.resolution).toMatchObject({
        external: 0,
        unresolvedInternal: 0,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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

// ---------------------------------------------------------------------------
// Batch 29b: `ptah_context_enrich_file` on a `.tsx` file through the REAL
// dispatcher (`handleMCPRequest`), the real `buildContextNamespace`, the real
// `ContextEnrichmentService` and the real TSX grammar. Only the file read and
// the token counter are stubbed.
// ---------------------------------------------------------------------------

describe('ptah_context_enrich_file on .tsx through the real dispatcher (Batch 29b)', () => {
  const ROOT = 'D:/ws-29b';
  const LONG_BODY = Array.from(
    { length: 12 },
    (_, i) => `  const step${i} = props.count * ${i} + offset${i};`,
  ).join('\n');
  const FILES: Record<string, string> = {
    'src/Badge.tsx': [
      'export interface BadgeProps {',
      '  count: number;',
      '}',
      `export function Badge(props: BadgeProps) {\n${LONG_BODY}\n  return <span className="badge">{step11}</span>;\n}`,
      '',
    ].join('\n'),
    'src/main.tsx': [
      'export const root = <Badge count={1} />;',
      'mount(root);',
      '',
    ].join('\n'),
  };

  const silent = (): Logger =>
    ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }) as unknown as Logger;

  const parser = new TreeSitterParserService(silent());
  afterAll(() => parser.dispose());

  function dispatcherDeps(): ProtocolHandlerDependencies {
    const workspaceProvider = { getWorkspaceRoot: () => ROOT };
    const enrichment = new RealContextEnrichmentService(
      parser,
      {
        countTokens: async (text: string) => text.length,
      } as unknown as TokenCounterService,
      {
        readFile: async (file: string) => {
          const relative = path.relative(ROOT, file).split(path.sep).join('/');
          const content = FILES[relative];
          if (content === undefined) throw new Error('no such file');
          return content;
        },
      } as unknown as FileSystemService,
      silent(),
      workspaceProvider as unknown as IWorkspaceProvider,
    );
    const context = buildContextNamespace({
      ...makeMocks(),
      contextEnrichment: enrichment,
      workspaceProvider: workspaceProvider as unknown as IWorkspaceProvider,
    });
    return {
      ptahAPI: { context } as unknown as PtahAPI,
      permissionPromptService:
        {} as ProtocolHandlerDependencies['permissionPromptService'],
      logger: silent(),
    };
  }

  async function enrich(
    file: string,
    language?: string,
  ): Promise<Record<string, unknown>> {
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: `29b-${file}-${language ?? 'inferred'}`,
      method: 'tools/call',
      params: {
        name: 'ptah_context_enrich_file',
        arguments: language === undefined ? { file } : { file, language },
      },
    };
    const res = await handleMCPRequest(request, dispatcherDeps());
    const result = res.result as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    expect(result.isError).not.toBe(true);
    return JSON.parse(result.content[0].text) as Record<string, unknown>;
  }

  it('a TSX declaration file summarises (no unsupported-language refusal)', async () => {
    const out = await enrich('src/Badge.tsx');

    expect(out['mode']).toBe('structural');
    expect(out).not.toHaveProperty('reason');
    expect(out['content']).toContain('export interface BadgeProps {');
    expect(out['content']).toContain(
      'export function Badge(props: BadgeProps);',
    );
    expect(out['content']).not.toContain('<span');
  }, 60_000);

  it('explicit tsx and the inferred language give the same answer', async () => {
    const [inferred, explicit] = [
      await enrich('src/Badge.tsx'),
      await enrich('src/Badge.tsx', 'tsx'),
    ];
    expect(explicit).toEqual(inferred);
  }, 60_000);

  it('a TSX file that runs JSX at load time falls back with its reason', async () => {
    const out = await enrich('src/main.tsx');

    expect(out).toMatchObject({
      mode: 'full',
      reason: 'unsupported-declarations',
      content: FILES['src/main.tsx'],
    });
    const keys = Object.keys(out);
    expect(keys[keys.length - 1]).toBe('content');
  }, 60_000);
});
