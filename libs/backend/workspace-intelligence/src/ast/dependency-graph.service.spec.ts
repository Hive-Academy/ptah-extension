/**
 * Specs for DependencyGraphService multi-workspace behavior.
 *
 * Covers:
 *   - single-workspace build + queries (dependents / dependencies / symbols)
 *   - multiple workspaces held simultaneously, isolated by root
 *   - per-file query routing by longest-prefix root match
 *   - workspace-root normalization (slashes / trailing slash)
 *   - eviction: evict(root) / retainOnly(roots) / clear()
 *   - builds in flight, governor yielding, edge linking (Batch 9b)
 *   - language coverage published with the graph (Batch 23a)
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Result } from '@ptah-extension/shared';
import {
  isCleanAnswer,
  type LanguageCoverage,
} from '@ptah-extension/platform-core';
import type {
  BackgroundWorkAdmission,
  Logger,
} from '@ptah-extension/vscode-core';
import {
  DependencyGraphService,
  graphPathIdentity,
  type DependencyGraph,
} from './dependency-graph.service';
import type { AstAnalysisService } from './ast-analysis.service';
import { TS_JS_IMPORT_RESOLVER } from './import-resolution/ts-js-import-resolver';
import type { FileSystemService } from '../services/file-system.service';
import type {
  ExportInfo,
  ImportInfo,
  CodeInsights,
} from './ast-analysis.interfaces';

// ---------------------------------------------------------------------------
// Fixtures — two independent workspaces.
//   D:/ws-a:  a.ts imports './b';  b.ts exports `B`
//   D:/ws-b:  c.ts exports `C`
// ---------------------------------------------------------------------------

function imp(source: string): ImportInfo {
  return { source, importedSymbols: [] } as unknown as ImportInfo;
}
function exp(name: string): ExportInfo {
  return { name } as unknown as ExportInfo;
}
function insights(imports: ImportInfo[], exports: ExportInfo[]): CodeInsights {
  return { imports, exports, functions: [], classes: [] } as CodeInsights;
}

const INSIGHTS: Record<string, CodeInsights> = {
  'D:/ws-a/a.ts': insights([imp('./b')], []),
  'D:/ws-a/b.ts': insights([], [exp('B')]),
  'D:/ws-b/c.ts': insights([], [exp('C')]),
};

function makeServiceWith(
  insightMap: Record<string, CodeInsights>,
): DependencyGraphService {
  const astAnalysis = {
    analyzeSource: jest.fn(async (_content, _lang, normalizedPath: string) =>
      Result.ok(insightMap[normalizedPath] ?? insights([], [])),
    ),
  } as unknown as AstAnalysisService;
  const fileSystem = {
    readFile: jest.fn(async () => 'source'),
  } as unknown as FileSystemService;
  const logger = {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  } as unknown as Logger;

  return new DependencyGraphService(astAnalysis, fileSystem, logger);
}

function makeService(): DependencyGraphService {
  return makeServiceWith(INSIGHTS);
}

const WS_A = 'D:/ws-a';
const WS_B = 'D:/ws-b';
const A_FILES = ['D:/ws-a/a.ts', 'D:/ws-a/b.ts'];
const B_FILES = ['D:/ws-b/c.ts'];

describe('DependencyGraphService — single workspace', () => {
  it('resolves dependents and dependencies from imports', async () => {
    const svc = makeService();
    await svc.buildGraph(A_FILES, WS_A);

    expect(svc.getDependents('D:/ws-a/b.ts')).toEqual(['D:/ws-a/a.ts']);
    expect(svc.getDependencies('D:/ws-a/a.ts')).toEqual(['D:/ws-a/b.ts']);
  });

  it('builds a symbol index from exports', async () => {
    const svc = makeService();
    await svc.buildGraph(A_FILES, WS_A);

    const index = svc.getSymbolIndex();
    expect(index.get('D:/ws-a/b.ts')?.map((e) => e.name)).toEqual(['B']);
  });

  it('reports isBuilt with and without a workspace root', async () => {
    const svc = makeService();
    expect(svc.isBuilt()).toBe(false);
    await svc.buildGraph(A_FILES, WS_A);
    expect(svc.isBuilt()).toBe(true);
    expect(svc.isBuilt(WS_A)).toBe(true);
    expect(svc.isBuilt(WS_B)).toBe(false);
  });

  it('normalizes the root — trailing slash and backslashes match', async () => {
    const svc = makeService();
    await svc.buildGraph(A_FILES, 'D:/ws-a/');
    expect(svc.isBuilt('D:\\ws-a')).toBe(true);
    expect(svc.isBuilt('D:/ws-a')).toBe(true);
  });
});

describe('DependencyGraphService — multiple workspaces', () => {
  it('keeps each workspace graph isolated and routes queries by root', async () => {
    const svc = makeService();
    await svc.buildGraph(A_FILES, WS_A);
    await svc.buildGraph(B_FILES, WS_B);

    expect(svc.isBuilt(WS_A)).toBe(true);
    expect(svc.isBuilt(WS_B)).toBe(true);

    // A file in ws-a routes to ws-a's graph; ws-b file has no dependents.
    expect(svc.getDependents('D:/ws-a/b.ts')).toEqual(['D:/ws-a/a.ts']);
    expect(svc.getDependents('D:/ws-b/c.ts')).toEqual([]);
  });

  it('scopes getSymbolIndex(root) to one workspace and merges when omitted', async () => {
    const svc = makeService();
    await svc.buildGraph(A_FILES, WS_A);
    await svc.buildGraph(B_FILES, WS_B);

    expect([...svc.getSymbolIndex(WS_B).keys()]).toEqual(['D:/ws-b/c.ts']);

    const merged = svc.getSymbolIndex();
    expect(merged.has('D:/ws-a/b.ts')).toBe(true);
    expect(merged.has('D:/ws-b/c.ts')).toBe(true);
  });
});

describe('DependencyGraphService — transitive dependencies', () => {
  // a -> b -> c -> a (a cycle) exercises the depth-limited traversal and the
  // cycle-detection guard in collectDependencies.
  const CHAIN: Record<string, CodeInsights> = {
    'D:/ws-a/a.ts': insights([imp('./b')], []),
    'D:/ws-a/b.ts': insights([imp('./c')], []),
    'D:/ws-a/c.ts': insights([imp('./a')], []),
  };
  const CHAIN_FILES = ['D:/ws-a/a.ts', 'D:/ws-a/b.ts', 'D:/ws-a/c.ts'];

  it('returns only direct dependencies at depth 1', async () => {
    const svc = makeServiceWith(CHAIN);
    await svc.buildGraph(CHAIN_FILES, WS_A);
    expect(svc.getDependencies('D:/ws-a/a.ts')).toEqual(['D:/ws-a/b.ts']);
  });

  it('walks transitively up to the requested depth, breaking cycles', async () => {
    const svc = makeServiceWith(CHAIN);
    await svc.buildGraph(CHAIN_FILES, WS_A);
    // depth 3: a -> b -> c -> (a already visited, skipped)
    const deps = svc.getDependencies('D:/ws-a/a.ts', 3);
    expect(deps).toEqual(['D:/ws-a/b.ts', 'D:/ws-a/c.ts']);
  });

  it('returns [] for a file with no outgoing edges', async () => {
    const svc = makeServiceWith(CHAIN);
    await svc.buildGraph(CHAIN_FILES, WS_A);
    // Unknown file routes to the sole graph but has no edge entry.
    expect(svc.getDependencies('D:/ws-a/missing.ts', 2)).toEqual([]);
  });
});

describe('DependencyGraphService — tsconfig path aliases', () => {
  // a.ts imports '@app/util', resolved via tsconfig paths to src/util.ts.
  const ALIAS: Record<string, CodeInsights> = {
    'D:/ws-a/a.ts': insights([imp('@app/util')], []),
    'D:/ws-a/src/util.ts': insights([], [exp('util')]),
  };
  const ALIAS_FILES = ['D:/ws-a/a.ts', 'D:/ws-a/src/util.ts'];

  it('resolves an alias import to a workspace file', async () => {
    const svc = makeServiceWith(ALIAS);
    await svc.buildGraph(ALIAS_FILES, WS_A, { '@app/*': ['src/*'] });
    expect(svc.getDependents('D:/ws-a/src/util.ts')).toEqual(['D:/ws-a/a.ts']);
  });

  it('leaves an import unresolved when no alias matches', async () => {
    const svc = makeServiceWith(ALIAS);
    await svc.buildGraph(ALIAS_FILES, WS_A, { '@other/*': ['lib/*'] });
    expect(svc.getDependents('D:/ws-a/src/util.ts')).toEqual([]);
  });
});

describe('DependencyGraphService — invalidateFile', () => {
  it('drops a file node and unlinks it from both edge directions', async () => {
    const svc = makeService();
    await svc.buildGraph(A_FILES, WS_A);

    expect(svc.getDependents('D:/ws-a/b.ts')).toEqual(['D:/ws-a/a.ts']);

    svc.invalidateFile('D:/ws-a/a.ts');

    // a.ts is gone, so b.ts no longer has a dependent.
    expect(svc.getDependents('D:/ws-a/b.ts')).toEqual([]);
    expect(svc.getDependencies('D:/ws-a/a.ts')).toEqual([]);
  });

  it('is a no-op for a file that belongs to no graph', async () => {
    const svc = makeService();
    await svc.buildGraph(A_FILES, WS_A);
    expect(() => svc.invalidateFile('D:/ws-a/nope.ts')).not.toThrow();
  });
});

describe('DependencyGraphService — eviction', () => {
  it('evict(root) drops one workspace and leaves the others', async () => {
    const svc = makeService();
    await svc.buildGraph(A_FILES, WS_A);
    await svc.buildGraph(B_FILES, WS_B);

    svc.evict(WS_A);

    expect(svc.isBuilt(WS_A)).toBe(false);
    expect(svc.isBuilt(WS_B)).toBe(true);
    expect(svc.getDependents('D:/ws-a/b.ts')).toEqual([]);
  });

  it('retainOnly keeps listed roots and evicts the rest', async () => {
    const svc = makeService();
    await svc.buildGraph(A_FILES, WS_A);
    await svc.buildGraph(B_FILES, WS_B);

    svc.retainOnly([WS_B]);

    expect(svc.isBuilt(WS_A)).toBe(false);
    expect(svc.isBuilt(WS_B)).toBe(true);
  });

  it('retainOnly([]) evicts everything; clear() empties the cache', async () => {
    const svc = makeService();
    await svc.buildGraph(A_FILES, WS_A);
    await svc.buildGraph(B_FILES, WS_B);

    svc.retainOnly([]);
    expect(svc.isBuilt()).toBe(false);

    await svc.buildGraph(A_FILES, WS_A);
    expect(svc.isBuilt()).toBe(true);
    svc.clear();
    expect(svc.isBuilt()).toBe(false);
  });
});

describe('DependencyGraphService — coverage (TASK_2026_559 Batch 9)', () => {
  it('reports no coverage before a graph is built', () => {
    const svc = makeService();
    expect(svc.getCoverage()).toBeUndefined();
    expect(svc.getCoverage(WS_A)).toBeUndefined();
  });

  it('reports a complete graph when no discovered count is passed', async () => {
    const svc = makeService();
    await svc.buildGraph(A_FILES, WS_A);
    expect(svc.getCoverage(WS_A)).toEqual({
      graphedFiles: 2,
      discoveredFiles: 2,
    });
  });

  it('keeps the uncapped discovered count a capping caller passes', async () => {
    const svc = makeService();
    await svc.buildGraph(A_FILES, 'D:\\ws-a\\', undefined, 7);
    expect(svc.getCoverage('D:/ws-a')).toEqual({
      graphedFiles: 2,
      discoveredFiles: 7,
    });
  });

  it.each([
    ['below the graphed count', 1],
    ['fractional', 2.5],
    ['NaN', Number.NaN],
  ])(
    'never reports fewer discovered than graphed files (%s)',
    async (_label, discovered) => {
      const svc = makeService();
      await svc.buildGraph(A_FILES, WS_A, undefined, discovered);
      expect(svc.getCoverage(WS_A)).toEqual({
        graphedFiles: 2,
        discoveredFiles: 2,
      });
    },
  );

  it('sums every graph when no root is given, and drops coverage on eviction', async () => {
    const svc = makeService();
    await svc.buildGraph(A_FILES, WS_A, undefined, 10);
    await svc.buildGraph(B_FILES, WS_B);
    expect(svc.getCoverage()).toEqual({ graphedFiles: 3, discoveredFiles: 11 });

    svc.evict(WS_A);
    expect(svc.getCoverage(WS_A)).toBeUndefined();
    expect(svc.getCoverage()).toEqual({ graphedFiles: 1, discoveredFiles: 1 });

    svc.retainOnly([]);
    expect(svc.getCoverage()).toBeUndefined();

    await svc.buildGraph(A_FILES, WS_A, undefined, 5);
    svc.clear();
    expect(svc.getCoverage(WS_A)).toBeUndefined();
  });

  // Round 2 review R2-B1: coverage follows the graph that answers the file.
  it('reports the coverage of the graph a file query is routed to, in both directions', async () => {
    const svc = makeService();
    await svc.buildGraph(A_FILES, WS_A);
    await svc.buildGraph(B_FILES, WS_B, undefined, 5_001);

    expect(svc.getCoverageForFile('D:/ws-b/c.ts')).toEqual({
      graphedFiles: 1,
      discoveredFiles: 5_001,
    });
    expect(svc.getCoverageForFile('D:\\ws-a\\a.ts')).toEqual({
      graphedFiles: 2,
      discoveredFiles: 2,
    });
    expect(svc.getCoverageForFile('E:/elsewhere/x.ts')).toBeUndefined();
  });

  it('reports the nested graph coverage for a file under a nested root', async () => {
    const svc = makeService();
    await svc.buildGraph(A_FILES, WS_A);
    await svc.buildGraph(['D:/ws-a/pkg/x.ts'], 'D:/ws-a/pkg', undefined, 9);

    expect(svc.getCoverageForFile('D:/ws-a/pkg/x.ts')).toEqual({
      graphedFiles: 1,
      discoveredFiles: 9,
    });
    expect(svc.getCoverageForFile('D:/ws-a/a.ts')).toEqual({
      graphedFiles: 2,
      discoveredFiles: 2,
    });
    expect(svc.getCoverageForFile('D:/ws-a/pkgx/y.ts')).toEqual({
      graphedFiles: 2,
      discoveredFiles: 2,
    });
    svc.evict('D:/ws-a/pkg');
    expect(svc.getCoverageForFile('D:/ws-a/pkg/x.ts')).toEqual({
      graphedFiles: 2,
      discoveredFiles: 2,
    });
  });
});

// TASK_2026_559 Batch 9b: a build in flight never publishes over a newer state.
describe('DependencyGraphService — builds in flight', () => {
  /** A service whose file reads wait until `release()` is called. */
  function gatedService(governor?: BackgroundWorkAdmission) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let gated = true;
    const astAnalysis = {
      analyzeSource: jest.fn(async (_content, _lang, normalizedPath: string) =>
        Result.ok(INSIGHTS[normalizedPath] ?? insights([], [])),
      ),
    } as unknown as AstAnalysisService;
    const fileSystem = {
      readFile: jest.fn(async () => {
        if (gated) await gate;
        return 'source';
      }),
    } as unknown as FileSystemService;
    const logger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    const svc = new DependencyGraphService(
      astAnalysis,
      fileSystem,
      logger as unknown as Logger,
      governor ?? null,
    );
    return {
      svc,
      logger,
      release(): void {
        gated = false;
        release();
      },
    };
  }

  it.each([
    ['evict(root)', (svc: DependencyGraphService) => svc.evict(WS_A)],
    [
      'retainOnly without it',
      (svc: DependencyGraphService) => svc.retainOnly([WS_B]),
    ],
    ['clear()', (svc: DependencyGraphService) => svc.clear()],
  ])(
    'does not publish a build whose root was dropped by %s mid-build',
    async (_label, drop) => {
      const { svc, release } = gatedService();
      const build = svc.buildGraph(A_FILES, WS_A);
      drop(svc);
      release();
      await build;

      expect(svc.isBuilt(WS_A)).toBe(false);
      expect(svc.getCoverage(WS_A)).toBeUndefined();
      // A later build of the same root publishes as usual.
      await svc.buildGraph(A_FILES, WS_A);
      expect(svc.isBuilt(WS_A)).toBe(true);
    },
  );

  // FB (batch 23a): the graph and its language coverage publish together or
  // not at all; a superseded build leaves neither behind.
  it('superseded build publishes neither graph nor coverage', async () => {
    const { svc, release } = gatedService();
    const earlier = svc.buildGraph(
      [...A_FILES, 'D:/ws-a/tool.py'],
      WS_A,
      undefined,
      50,
    );
    const later = svc.buildGraph(['D:/ws-a/b.ts'], WS_A);
    release();
    const [earlierGraph] = await Promise.all([earlier, later]);

    expect(earlierGraph.nodes.size).toBe(2); // built, but not published
    const report = svc.getCoverageReport(WS_A);
    expect(report?.files).toEqual({ graphedFiles: 1, discoveredFiles: 1 });
    expect(report?.languages).toMatchObject({
      analyzed: 1,
      unsupported: 0,
      omittedByCap: 0,
    });
    expect(svc.getDependents('D:/ws-a/b.ts')).toEqual([]);

    // An eviction mid-build: no graph and no coverage at all.
    const { svc: evicted, release: releaseEvicted } = gatedService();
    const build = evicted.buildGraph(A_FILES, WS_A, undefined, undefined, {
      yieldToForeground: true,
      generation: evicted.reserveBuild(WS_A),
    });
    evicted.evict(WS_A);
    releaseEvicted();
    await build;
    expect(evicted.isBuilt(WS_A)).toBe(false);
    expect(evicted.getCoverageReport(WS_A)).toBeUndefined();
    expect(evicted.getCoverageReport()).toBeUndefined();
  });

  it('keeps the later-started build when an earlier one finishes after it', async () => {
    const { svc, release } = gatedService();
    const earlier = svc.buildGraph(A_FILES, WS_A, undefined, 50);
    const later = svc.buildGraph(['D:/ws-a/b.ts'], WS_A);
    release();
    await Promise.all([earlier, later]);

    expect(svc.getCoverage(WS_A)).toEqual({
      graphedFiles: 1,
      discoveredFiles: 1,
    });
  });

  it('waits on the governor before each chunk only when asked to yield', async () => {
    const governor = {
      isClear: jest.fn(() => false),
      whenClear: jest.fn(async () => 'clear' as const),
    };
    const { svc, release } = gatedService(governor);
    release();

    await svc.buildGraph(A_FILES, WS_A);
    expect(governor.whenClear).not.toHaveBeenCalled();

    await svc.buildGraph(A_FILES, WS_A, undefined, undefined, {
      yieldToForeground: true,
    });
    expect(governor.whenClear).toHaveBeenCalledTimes(1);
    expect(governor.whenClear).toHaveBeenCalledWith({
      lane: 'dependency-graph',
      maxDeferMs: 1_000,
    });
    expect(svc.isBuilt(WS_A)).toBe(true);
  });

  it('stops a governed build when the governor aborts (host shutdown)', async () => {
    const abort = new Error('disposed');
    abort.name = 'AbortError';
    const governor = {
      isClear: jest.fn(() => false),
      whenClear: jest.fn(async () => {
        throw abort;
      }),
    };
    const { svc, release } = gatedService(governor);
    release();

    await expect(
      svc.buildGraph(A_FILES, WS_A, undefined, undefined, {
        yieldToForeground: true,
      }),
    ).rejects.toBe(abort);
    expect(svc.isBuilt(WS_A)).toBe(false);
  });

  it('builds anyway, warning once with fixed text, when the governor wait fails', async () => {
    const governor = {
      isClear: jest.fn(() => false),
      whenClear: jest.fn(async () => {
        throw new Error('defect at D:/ws-a');
      }),
    };
    const { svc, logger, release } = gatedService(governor);
    release();
    const files = Array.from({ length: 45 }, (_, i) => `D:/ws-a/f${i}.ts`);

    await svc.buildGraph(files, WS_A, undefined, undefined, {
      yieldToForeground: true,
    });

    expect(svc.isBuilt(WS_A)).toBe(true);
    expect(governor.whenClear).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('D:/ws-a');
  });
});

describe('DependencyGraphService — reserved generations and host yielding (TASK_2026_559 Batch 9b r1)', () => {
  function serviceWithParser(analyze: (normalizedPath: string) => void) {
    const astAnalysis = {
      analyzeSource: jest.fn(
        async (_content, _lang, normalizedPath: string) => {
          analyze(normalizedPath);
          return Result.ok(INSIGHTS[normalizedPath] ?? insights([], []));
        },
      ),
    } as unknown as AstAnalysisService & { analyzeSource: jest.Mock };
    const fileSystem = {
      readFile: jest.fn(async () => 'source'),
    } as unknown as FileSystemService;
    const logger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as Logger;
    return {
      svc: new DependencyGraphService(astAnalysis, fileSystem, logger),
      analyzeSource: astAnalysis.analyzeSource,
    };
  }

  const BACKGROUND = { yieldToForeground: true };

  it('publishes a build run under its still-current reservation', async () => {
    const { svc } = serviceWithParser(() => undefined);
    const generation = svc.reserveBuild(WS_A);
    expect(svc.getBuildState(WS_A)).toEqual({ generation, building: false });

    await svc.buildGraph(A_FILES, WS_A, undefined, undefined, {
      ...BACKGROUND,
      generation,
    });

    expect(svc.isBuilt(WS_A)).toBe(true);
    expect(svc.getBuildState(WS_A)).toEqual({ generation, building: false });
  });

  it.each([
    [
      'a build started after the reservation',
      async (svc: DependencyGraphService) => {
        await svc.buildGraph(['D:/ws-a/b.ts'], WS_A);
      },
    ],
    [
      'an eviction after the reservation',
      async (svc: DependencyGraphService) => {
        svc.evict(WS_A);
      },
    ],
  ])('never publishes a reservation superseded by %s', async (_label, act) => {
    const { svc } = serviceWithParser(() => undefined);
    const generation = svc.reserveBuild(WS_A);
    await act(svc);

    await svc.buildGraph(A_FILES, WS_A, undefined, undefined, {
      ...BACKGROUND,
      generation,
    });

    // Either the later explicit graph (one file) or nothing at all.
    const coverage = svc.getCoverage(WS_A);
    expect(coverage === undefined || coverage.graphedFiles === 1).toBe(true);
  });

  it('reports a running build of the current generation', async () => {
    let observed: unknown;
    const holder: { svc?: DependencyGraphService } = {};
    const { svc } = serviceWithParser(() => {
      observed ??= holder.svc?.getBuildState(WS_A);
    });
    holder.svc = svc;

    await svc.buildGraph(A_FILES, WS_A);

    expect(observed).toEqual({
      generation: expect.any(Number),
      building: true,
    });
    expect(svc.getBuildState(WS_A).building).toBe(false);
  });

  it('stops parsing a background build once it is superseded', async () => {
    const files = Array.from({ length: 10 }, (_, i) => `D:/ws-a/f${i}.ts`);
    const holder: { svc?: DependencyGraphService } = {};
    const { svc, analyzeSource } = serviceWithParser(() => {
      // An eviction while the first file is parsed.
      holder.svc?.evict(WS_A);
    });
    holder.svc = svc;

    await svc.buildGraph(files, WS_A, undefined, undefined, BACKGROUND);

    expect(analyzeSource).toHaveBeenCalledTimes(1);
    expect(svc.isBuilt(WS_A)).toBe(false);
  });

  it('lets host timers run between the files of a background build', async () => {
    const PARSE_COST_MS = 20;
    const order: string[] = [];
    const { svc } = serviceWithParser(() => {
      const end = Date.now() + PARSE_COST_MS;
      while (Date.now() < end) {
        // Synchronous CPU, as a real parse.
      }
      order.push('parse');
    });
    const files = Array.from({ length: 8 }, (_, i) => `D:/ws-a/f${i}.ts`);
    const ticker = setInterval(() => order.push('tick'), 1);
    try {
      await svc.buildGraph(files, WS_A, undefined, undefined, BACKGROUND);
    } finally {
      clearInterval(ticker);
    }

    // Never more than two parses without a timer between them (a macrotask
    // yield before every file); an unyielding build would run all eight.
    let run = 0;
    let longestRun = 0;
    for (const entry of order) {
      run = entry === 'parse' ? run + 1 : 0;
      longestRun = Math.max(longestRun, run);
    }
    expect(order.filter((entry) => entry === 'parse')).toHaveLength(8);
    expect(longestRun).toBeLessThanOrEqual(2);
  });
});

describe('DependencyGraphService — edge linking inside one node (TASK_2026_559 Batch 9b r2)', () => {
  const IMPORT_COUNT = 1_000;
  const HEAVY_FILE = 'D:/ws-a/heavy.ts';

  /**
   * One node importing IMPORT_COUNT missing relative modules: each import is
   * unresolved and logged, so the debug log records the linking order. The
   * clock advances 1 ms per read, so the 10 ms edge slice ends every few
   * imports without any real CPU cost.
   */
  function heavyNodeSetup() {
    const order: string[] = [];
    const heavy = insights(
      Array.from({ length: IMPORT_COUNT }, (_, i) => imp(`./missing-${i}`)),
      [],
    );
    const astAnalysis = {
      analyzeSource: jest.fn(async () => Result.ok(heavy)),
    } as unknown as AstAnalysisService;
    const fileSystem = {
      readFile: jest.fn(async () => 'source'),
    } as unknown as FileSystemService;
    const logger = {
      info: jest.fn(),
      debug: jest.fn((message: string) => {
        if (message.includes('Unresolved import')) order.push('import');
      }),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as Logger;
    let clock = 0;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => ++clock);
    return {
      svc: new DependencyGraphService(astAnalysis, fileSystem, logger),
      order,
      restoreClock: () => now.mockRestore(),
    };
  }

  /** A macrotask heartbeat: `beat` runs once per event-loop turn. */
  function startHeartbeat(beat: () => void): () => void {
    let handle: ReturnType<typeof setImmediate> | undefined;
    const tick = (): void => {
      beat();
      handle = setImmediate(tick);
    };
    handle = setImmediate(tick);
    return () => {
      if (handle !== undefined) clearImmediate(handle);
    };
  }

  it('lets host timers run while one import-heavy node is linked', async () => {
    const { svc, order, restoreClock } = heavyNodeSetup();
    const stop = startHeartbeat(() => order.push('tick'));
    try {
      await svc.buildGraph([HEAVY_FILE], WS_A, undefined, undefined, {
        yieldToForeground: true,
      });
    } finally {
      stop();
      restoreClock();
    }

    const first = order.indexOf('import');
    const last = order.lastIndexOf('import');
    expect(order.filter((entry) => entry === 'import')).toHaveLength(
      IMPORT_COUNT,
    );
    // A tick between the node's first and last import: the timer ran during
    // that node's linking, not only before or after it.
    expect(order.slice(first, last).includes('tick')).toBe(true);
    expect(svc.isBuilt(WS_A)).toBe(true);
  });

  it('stops linking a superseded background build mid-node', async () => {
    const { svc, order, restoreClock } = heavyNodeSetup();
    const stop = startHeartbeat(() => {
      // Evict once linking of the node is under way.
      if (order.includes('import') && svc.getBuildState(WS_A).building) {
        svc.evict(WS_A);
      }
    });
    try {
      await svc.buildGraph([HEAVY_FILE], WS_A, undefined, undefined, {
        yieldToForeground: true,
      });
    } finally {
      stop();
      restoreClock();
    }

    const linked = order.filter((entry) => entry === 'import').length;
    expect(linked).toBeGreaterThan(0);
    expect(linked).toBeLessThan(IMPORT_COUNT);
    expect(svc.isBuilt(WS_A)).toBe(false);
  });
});

describe('DependencyGraphService — language coverage (TASK_2026_559 Batch 23a)', () => {
  /** A service whose reads and parses fail for chosen paths. */
  function serviceWith(
    insightMap: Record<string, CodeInsights>,
    failures: {
      read?: readonly string[];
      parseError?: readonly string[];
      parseThrow?: readonly string[];
    } = {},
  ) {
    const astAnalysis = {
      analyzeSource: jest.fn(
        async (_content, _lang, normalizedPath: string) => {
          if (failures.parseThrow?.includes(normalizedPath)) {
            throw new Error('parser crashed');
          }
          if (failures.parseError?.includes(normalizedPath)) {
            return Result.err(new Error('syntax'));
          }
          return Result.ok(insightMap[normalizedPath] ?? insights([], []));
        },
      ),
    } as unknown as AstAnalysisService & { analyzeSource: jest.Mock };
    const fileSystem = {
      readFile: jest.fn(async (filePath: string) => {
        if (failures.read?.includes(filePath)) throw new Error('EACCES');
        return 'source';
      }),
    } as unknown as FileSystemService;
    const logger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as Logger;
    return {
      svc: new DependencyGraphService(astAnalysis, fileSystem, logger),
      analyzeSource: astAnalysis.analyzeSource,
    };
  }

  it('publishes a clean coverage for a fully resolved TS graph', async () => {
    const { svc } = serviceWith(INSIGHTS);
    await svc.buildGraph(A_FILES, WS_A, {});

    const report = svc.getCoverageReport(WS_A);
    expect(report?.files).toEqual(svc.getCoverage(WS_A));
    expect(report?.languages).toEqual({
      clean: true,
      reasons: [],
      supportedLanguages: ['typescript', 'javascript', 'tsx'],
      census: 'complete',
      analyzed: 2,
      unchecked: 0,
      failed: 0,
      unsupported: 0,
      unrecognised: 0,
      nonSource: 0,
      excluded: null,
      omittedByCap: 0,
      resolution: {
        external: 0,
        unresolvedInternal: 0,
        truncatedImports: 0,
        edgeCapHit: false,
        context: 'complete',
      },
    });
    expect(isCleanAnswer(report!.languages)).toBe(true);
  });

  it('counts parse failures by reason and leaves those files out', async () => {
    const files = [
      'D:/ws-a/a.ts',
      'D:/ws-a/b.ts',
      'D:/ws-a/unreadable.ts',
      'D:/ws-a/broken.ts',
      'D:/ws-a/crash.ts',
    ];
    const { svc } = serviceWith(INSIGHTS, {
      read: ['D:/ws-a/unreadable.ts'],
      parseError: ['D:/ws-a/broken.ts'],
      parseThrow: ['D:/ws-a/crash.ts'],
    });

    const graph = await svc.buildGraph(files, WS_A, {});

    expect([...graph.nodes.keys()].sort()).toEqual(A_FILES);
    const languages = svc.getCoverageReport(WS_A)?.languages;
    expect(languages?.analyzed).toBe(2);
    expect(languages?.failed).toBe(3);
    expect(languages?.failedByReason).toEqual({ read: 1, parse: 2 });
    expect(isCleanAnswer(languages!)).toBe(false);
  });

  it('counts external and unresolved internal imports per import', async () => {
    const map: Record<string, CodeInsights> = {
      'D:/ws-a/a.ts': insights(
        [
          imp('./b'),
          imp('./missing'),
          imp('lodash'),
          imp('@app/gone'),
          imp('@app/util'),
        ],
        [],
      ),
      'D:/ws-a/b.ts': insights([], []),
      'D:/ws-a/src/util.ts': insights([], []),
    };
    const files = ['D:/ws-a/a.ts', 'D:/ws-a/b.ts', 'D:/ws-a/src/util.ts'];
    const { svc } = serviceWith(map);

    await svc.buildGraph(files, WS_A, { '@app/*': ['src/*'] });
    // `lodash` is most likely a package, but nothing proves it (r1 B2).
    expect(svc.getCoverageReport(WS_A)?.languages.resolution).toEqual({
      external: 1,
      unresolvedInternal: 2,
      truncatedImports: 0,
      edgeCapHit: false,
      context: 'partial',
    });

    // Without tsconfig paths the alias imports read as packages: the
    // context is partial and says so.
    await svc.buildGraph(files, WS_A);
    const languages = svc.getCoverageReport(WS_A)?.languages;
    expect(languages?.resolution).toEqual({
      external: 3,
      unresolvedInternal: 1,
      truncatedImports: 0,
      edgeCapHit: false,
      context: 'partial',
    });
    expect(languages?.approximations).toEqual(['resolver-context-partial']);
  });

  // r1 B2 (FB): a supplied `paths` object does not prove there is no other
  // alias mechanism, so unresolved `#`/bare specifiers never read as clean.
  it.each([
    ['an empty paths object and a package # import', {}, '#b', 'internal'],
    [
      'an unrelated paths mapping and a baseUrl-style import',
      { '@other/*': ['lib/*'] },
      'utils/b',
      'context-dependent',
    ],
  ])(
    'a supplied paths object never certifies resolution (%s)',
    async (_label, paths, specifier, kind) => {
      const map: Record<string, CodeInsights> = {
        'D:/ws-a/a.ts': insights([imp(specifier)], []),
        'D:/ws-a/utils/b.ts': insights([], []),
      };
      const { svc } = serviceWith(map);
      await svc.buildGraph(['D:/ws-a/a.ts', 'D:/ws-a/utils/b.ts'], WS_A, paths);

      const languages = svc.getCoverageReport(WS_A)!.languages;
      expect(svc.getDependents('D:/ws-a/utils/b.ts')).toEqual([]);
      expect(languages.resolution).toMatchObject(
        kind === 'internal'
          ? { unresolvedInternal: 1, external: 0 }
          : { unresolvedInternal: 0, external: 1, context: 'partial' },
      );
      expect(isCleanAnswer(languages)).toBe(false);
    },
  );

  // r1 M1 (FB): a `node:` builtin is proven external without any context.
  it('does not qualify a graph whose only unresolved import is a node: builtin', async () => {
    const map: Record<string, CodeInsights> = {
      'D:/ws-a/a.ts': insights([imp('./b'), imp('node:fs')], []),
      'D:/ws-a/b.ts': insights([], []),
    };
    const { svc } = serviceWith(map);
    await svc.buildGraph(A_FILES, WS_A);

    const languages = svc.getCoverageReport(WS_A)!.languages;
    expect(languages.resolution).toEqual({
      external: 1,
      unresolvedInternal: 0,
      truncatedImports: 0,
      edgeCapHit: false,
      context: 'complete',
    });
    expect(languages.approximations).toBeUndefined();
    expect(isCleanAnswer(languages)).toBe(true);
  });

  // r1 B1 (FB): invalidation revokes the clean answer in the same step.
  it('an invalidated file makes the coverage unclean with the graph change', async () => {
    const { svc } = serviceWith(INSIGHTS);
    await svc.buildGraph(A_FILES, WS_A, {});
    expect(isCleanAnswer(svc.getCoverageReport(WS_A)!.languages)).toBe(true);

    svc.invalidateFile('D:\\ws-a\\a.ts');

    expect(svc.getDependents('D:/ws-a/b.ts')).toEqual([]);
    const languages = svc.getCoverageReport(WS_A)!.languages;
    expect(languages).toMatchObject({ analyzed: 1, unchecked: 1 });
    expect(languages.resolution?.context).toBe('partial');
    expect(isCleanAnswer(languages)).toBe(false);
    expect(svc.getCoverage(WS_A)).toEqual({
      graphedFiles: 2,
      discoveredFiles: 2,
    });

    // Invalidating it again (no node left) moves no count.
    svc.invalidateFile('D:/ws-a/a.ts');
    expect(svc.getCoverageReport(WS_A)!.languages).toMatchObject({
      analyzed: 1,
      unchecked: 1,
    });

    // The next build publishes a fresh, clean report.
    await svc.buildGraph(A_FILES, WS_A, {});
    expect(isCleanAnswer(svc.getCoverageReport(WS_A)!.languages)).toBe(true);
  });

  it('an unknown file invalidated under a graph qualifies it without moving counts', async () => {
    const { svc } = serviceWith(INSIGHTS);
    await svc.buildGraph(A_FILES, WS_A, {});

    svc.invalidateFile('D:/ws-a/new.ts');

    const languages = svc.getCoverageReport(WS_A)!.languages;
    expect(languages).toMatchObject({ analyzed: 2, unchecked: 0 });
    expect(languages.resolution?.context).toBe('partial');
    expect(isCleanAnswer(languages)).toBe(false);
  });

  // r2 B1 (FB): parent and nested roots both hold a nested file; the parent
  // must not read clean once the nested root is dropped.
  describe('overlapping parent and nested roots (r2 B1)', () => {
    const PARENT = 'D:/repo';
    const CHILD = 'D:/repo/pkg';
    const PKG_FILES = ['D:/repo/pkg/a.ts', 'D:/repo/pkg/b.ts'];

    async function builtParentAndChild() {
      // a.ts has no imports when both graphs are built (it gains './b' later).
      const map: Record<string, CodeInsights> = {
        'D:/repo/pkg/a.ts': insights([], []),
        'D:/repo/pkg/b.ts': insights([], []),
      };
      const { svc } = serviceWith(map);
      await svc.buildGraph(PKG_FILES, PARENT, {});
      await svc.buildGraph(PKG_FILES, CHILD, {});
      expect(isCleanAnswer(svc.getCoverageReport(PARENT)!.languages)).toBe(
        true,
      );
      return svc;
    }

    it.each([
      ['evict(child)', (svc: DependencyGraphService) => svc.evict(CHILD)],
      [
        'retainOnly([parent])',
        (svc: DependencyGraphService) => svc.retainOnly([PARENT]),
      ],
    ])(
      'the reviewer probe: invalidate a nested file, then %s',
      async (_label, dropChild) => {
        const svc = await builtParentAndChild();

        svc.invalidateFile('D:/repo/pkg/a.ts');
        expect(isCleanAnswer(svc.getCoverageReport(CHILD)!.languages)).toBe(
          false,
        );
        expect(isCleanAnswer(svc.getCoverageReport(PARENT)!.languages)).toBe(
          false,
        );

        dropChild(svc);
        expect(svc.getDependents('D:/repo/pkg/b.ts')).toEqual([]);
        const parent = svc.getCoverageReportForFile('D:/repo/pkg/b.ts')!;
        expect(parent.languages).toMatchObject({ analyzed: 1, unchecked: 1 });
        expect(parent.languages.resolution?.context).toBe('partial');
        expect(isCleanAnswer(parent.languages)).toBe(false);
      },
    );

    it('qualifies both roots for a new nested file absent from both graphs', async () => {
      const svc = await builtParentAndChild();

      svc.invalidateFile('D:/repo/pkg/new.ts');

      for (const root of [PARENT, CHILD]) {
        const languages = svc.getCoverageReport(root)!.languages;
        expect(languages).toMatchObject({ analyzed: 2, unchecked: 0 });
        expect(isCleanAnswer(languages)).toBe(false);
      }
    });

    it('leaves a sibling root that does not contain the file clean', async () => {
      const svc = await builtParentAndChild();
      await svc.buildGraph(B_FILES, WS_B, {});

      svc.invalidateFile('D:/repo/pkg/a.ts');

      expect(isCleanAnswer(svc.getCoverageReport(WS_B)!.languages)).toBe(true);
    });
  });

  // r3 B1 (FB): one platform-aware path identity for roots, nodes and
  // containment — case variants on win32, and junction/symlink aliases.
  describe('path identity (r3 B1)', () => {
    const onWin32 = process.platform === 'win32';
    // Case folding applies only where paths are case-insensitive (win32).
    const itOnWin32 = onWin32 ? it : it.skip;

    async function parentAndChild(parent: string, child: string) {
      const files = [`${child}/a.ts`, `${child}/b.ts`];
      const { svc } = serviceWith({});
      await svc.buildGraph(files, parent, {});
      await svc.buildGraph(files, child, {});
      expect(isCleanAnswer(svc.getCoverageReport(parent)!.languages)).toBe(
        true,
      );
      return svc;
    }

    it('graphPathIdentity folds case only when asked, and normalizes the rest', () => {
      expect(graphPathIdentity('D:\\Repo\\Pkg\\', true)).toBe('d:/repo/pkg');
      expect(graphPathIdentity('D:\\Repo\\Pkg\\', false)).toBe('D:/Repo/Pkg');
      expect(graphPathIdentity('\\\\?\\D:\\Repo', true)).toBe('d:/repo');
      expect(graphPathIdentity('/srv/Repo//', false)).toBe('/srv/Repo');
    });

    itOnWin32(
      'the reviewer probe: a case-variant invalidation qualifies parent and child, and the parent after the child is evicted',
      async () => {
        const svc = await parentAndChild('D:/Repo', 'D:/Repo/pkg');

        svc.invalidateFile('d:\\repo\\PKG\\a.ts');

        for (const root of ['D:/Repo', 'D:/Repo/pkg']) {
          const languages = svc.getCoverageReport(root)!.languages;
          expect(languages).toMatchObject({ analyzed: 1, unchecked: 1 });
          expect(isCleanAnswer(languages)).toBe(false);
        }
        svc.evict('d:/REPO/pkg/');
        expect(svc.getCoverageReport('D:/Repo/pkg')).toBeUndefined();
        expect(svc.getDependents('D:/Repo/pkg/b.ts')).toEqual([]);
        expect(
          isCleanAnswer(
            svc.getCoverageReportForFile('D:/Repo/pkg/b.ts')!.languages,
          ),
        ).toBe(false);
      },
    );

    itOnWin32(
      'a case-variant invalidation during a cold build reaches the graph it publishes',
      async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const svc = new DependencyGraphService(
          {
            analyzeSource: jest.fn(async () => Result.ok(insights([], []))),
          } as unknown as AstAnalysisService,
          {
            readFile: jest.fn(async () => {
              await gate;
              return 'source';
            }),
          } as unknown as FileSystemService,
          {
            info: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          } as unknown as Logger,
        );

        const build = svc.buildGraph(
          ['D:/Repo/pkg/a.ts', 'D:/Repo/pkg/b.ts'],
          'D:/Repo',
          {},
        );
        svc.invalidateFile('d:/REPO/Pkg/A.TS');
        release();
        await build;

        const languages = svc.getCoverageReport('D:/Repo')!.languages;
        expect(languages).toMatchObject({ analyzed: 1, unchecked: 1 });
        expect(isCleanAnswer(languages)).toBe(false);
      },
    );

    it('keeps a trailing-separator/backslash spelling and a sibling boundary apart', async () => {
      const svc = await parentAndChild('D:/Repo', 'D:/Repo/pkg');
      await svc.buildGraph(['D:/Repo2/x.ts'], 'D:/Repo2', {});

      svc.invalidateFile('D:\\Repo\\pkg\\a.ts');

      expect(isCleanAnswer(svc.getCoverageReport('D:/Repo/')!.languages)).toBe(
        false,
      );
      expect(isCleanAnswer(svc.getCoverageReport('D:/Repo2')!.languages)).toBe(
        true,
      );
    });

    describe('a junction/symlink alias root (real filesystem fixture)', () => {
      // Built while the suite is collected, so a host that cannot create a
      // directory link skips the spec by name instead of passing it.
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ptah-graph-alias-'),
      );
      const realRoot = path.join(tempDir, 'real');
      const aliasRoot = path.join(tempDir, 'alias');
      fs.mkdirSync(path.join(realRoot, 'pkg'), { recursive: true });
      for (const name of ['a.ts', 'b.ts']) {
        fs.writeFileSync(path.join(realRoot, 'pkg', name), '');
      }
      let linked = true;
      try {
        // A junction needs no privilege on Windows; elsewhere a dir symlink.
        fs.symlinkSync(realRoot, aliasRoot, onWin32 ? 'junction' : 'dir');
      } catch (error: unknown) {
        linked = false;
        console.warn(
          `[r3 B1] junction spec skipped: cannot create a directory link (${String(error)})`,
        );
      }

      afterAll(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      (linked ? it : it.skip)(
        'invalidating through the real path qualifies both alias roots, and the parent after the child is evicted',
        async () => {
          const alias = aliasRoot.replace(/\\/g, '/');
          expect(
            fs.realpathSync.native(path.join(aliasRoot, 'pkg', 'a.ts')),
          ).toBe(fs.realpathSync.native(path.join(realRoot, 'pkg', 'a.ts')));
          const svc = await parentAndChild(alias, `${alias}/pkg`);

          svc.invalidateFile(path.join(realRoot, 'pkg', 'a.ts'));

          for (const root of [alias, `${alias}/pkg`]) {
            const languages = svc.getCoverageReport(root)!.languages;
            expect(languages).toMatchObject({ analyzed: 1, unchecked: 1 });
            expect(isCleanAnswer(languages)).toBe(false);
          }
          svc.evict(`${alias}/pkg`);
          expect(svc.getDependents(`${alias}/pkg/b.ts`)).toEqual([]);
          expect(isCleanAnswer(svc.getCoverageReport(alias)!.languages)).toBe(
            false,
          );
        },
      );
    });
  });

  it('applies an invalidation made during a running build to the graph it publishes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const astAnalysis = {
      analyzeSource: jest.fn(async (_content, _lang, p: string) =>
        Result.ok(INSIGHTS[p] ?? insights([], [])),
      ),
    } as unknown as AstAnalysisService;
    const fileSystem = {
      readFile: jest.fn(async () => {
        await gate;
        return 'source';
      }),
    } as unknown as FileSystemService;
    const logger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as Logger;
    const svc = new DependencyGraphService(astAnalysis, fileSystem, logger);

    const build = svc.buildGraph(A_FILES, WS_A, {});
    svc.invalidateFile('D:/ws-a/a.ts'); // no graph published yet
    svc.invalidateFile('D:/ws-b/c.ts'); // another root: not this build's
    release();
    await build;

    expect(svc.isBuilt(WS_A)).toBe(true);
    expect(svc.getDependencies('D:/ws-a/a.ts')).toEqual([]);
    const languages = svc.getCoverageReport(WS_A)!.languages;
    expect(languages).toMatchObject({ analyzed: 1, unchecked: 1 });
    expect(isCleanAnswer(languages)).toBe(false);

    // The latch is per build: a later build is not affected.
    await svc.buildGraph(A_FILES, WS_A, {});
    expect(isCleanAnswer(svc.getCoverageReport(WS_A)!.languages)).toBe(true);
  });

  // FB (batch 23a): the aggregate edge cap stops linking and is disclosed.
  it('edge cap is disclosed', async () => {
    const FILE_COUNT = 501; // 501 files x 500 imports = 250,500 edges
    const files = Array.from(
      { length: FILE_COUNT },
      (_, i) => `D:/ws-a/f${i}.ts`,
    );
    const map: Record<string, CodeInsights> = {};
    files.forEach((file, i) => {
      map[file] = insights(
        files.flatMap((_, j) => (j === i ? [] : [imp(`./f${j}`)])),
        [],
      );
    });
    const { svc } = serviceWith(map);

    const graph = await svc.buildGraph(files, WS_A, {});

    let edgeCount = 0;
    for (const set of graph.edges.values()) edgeCount += set.size;
    expect(edgeCount).toBe(250_000);
    const languages = svc.getCoverageReport(WS_A)?.languages;
    expect(languages?.resolution?.edgeCapHit).toBe(true);
    expect(isCleanAnswer(languages!)).toBe(false);
    expect(svc.isBuilt(WS_A)).toBe(true);
  });

  it('parses only graph-capable files and counts the rest', async () => {
    const { svc, analyzeSource } = serviceWith(INSIGHTS);
    await svc.buildGraph(
      [...A_FILES, 'D:/ws-a/tool.py', 'D:/ws-a/build.zig', 'D:/ws-a/README.md'],
      WS_A,
      {},
    );

    expect(analyzeSource).toHaveBeenCalledTimes(2);
    const report = svc.getCoverageReport(WS_A);
    // Batch 9 meaning unchanged: the list the graph was built from.
    expect(report?.files).toEqual({ graphedFiles: 5, discoveredFiles: 5 });
    expect(report?.languages).toMatchObject({
      analyzed: 2,
      unsupported: 1,
      unsupportedByLanguage: { python: 1 },
      unrecognised: 1,
      nonSource: 1,
    });
  });

  it('caps parsing at 5,000 graph-capable files, fairly across languages', async () => {
    const ts = Array.from({ length: 5_010 }, (_, i) => `D:/ws-a/t${i}.ts`);
    const { svc, analyzeSource } = serviceWith({});

    await svc.buildGraph([...ts, 'D:/ws-a/late.js'], WS_A, {});

    expect(analyzeSource).toHaveBeenCalledTimes(5_000);
    expect(
      analyzeSource.mock.calls.some(([, , p]) => p === 'D:/ws-a/late.js'),
    ).toBe(true);
    const report = svc.getCoverageReport(WS_A);
    expect(report?.files).toEqual({
      graphedFiles: 5_000,
      discoveredFiles: 5_011,
    });
    expect(report?.languages.omittedByCap).toBe(11);
  });

  it('counts files a caller dropped before the build, and a truncated census', async () => {
    const { svc } = serviceWith(INSIGHTS);
    await svc.buildGraph(A_FILES, WS_A, {}, 7, { censusLimit: 50_001 });

    const languages = svc.getCoverageReport(WS_A)?.languages;
    expect(languages?.omittedByCap).toBe(5);
    expect(languages?.census).toBe('truncated');
    expect(languages?.censusLimit).toBe(50_001);
  });

  it('merges every root when none is given, and routes a file to its root', async () => {
    const { svc } = serviceWith(INSIGHTS);
    await svc.buildGraph([...A_FILES, 'D:/ws-a/x.py'], WS_A, {});
    await svc.buildGraph(B_FILES, WS_B, {}, 4);

    const merged = svc.getCoverageReport();
    expect(merged?.files).toEqual({ graphedFiles: 4, discoveredFiles: 7 });
    expect(merged?.languages).toMatchObject({
      analyzed: 3,
      unsupported: 1,
      omittedByCap: 3,
    });
    expect(svc.getCoverageReportForFile('D:\\ws-b\\c.ts')?.languages).toBe(
      svc.getCoverageReport(WS_B)?.languages,
    );
    expect(svc.getCoverageReportForFile('E:/elsewhere/x.ts')).toBeUndefined();

    svc.evict(WS_B);
    expect(svc.getCoverageReport(WS_B)).toBeUndefined();
    expect(svc.getCoverageReport()?.languages.analyzed).toBe(2);
  });

  // Batch 23b carried criteria (User Decision 20), reviewer probes of
  // reviews/batch-23a-code-logic-review-r4-postcap.md.
  describe('query path identity and root identity failures (r4)', () => {
    const onWin32 = process.platform === 'win32';
    const itOnWin32 = onWin32 ? it : it.skip;
    const itOffWin32 = onWin32 ? it.skip : it;
    const REPO = 'D:/Repo';
    const A = 'D:/Repo/Pkg/A.ts';
    const B = 'D:/Repo/Pkg/B.ts';
    const C = 'D:/Repo/Pkg/C.ts';

    /** A.ts imports ./B, B.ts imports ./C (depth > 1 reaches C). */
    async function caseGraph() {
      const { svc } = serviceWith({
        [A]: insights([imp('./B')], []),
        [B]: insights([imp('./C')], []),
      });
      await svc.buildGraph([A, B, C], REPO, {});
      expect(isCleanAnswer(svc.getCoverageReport(REPO)!.languages)).toBe(true);
      return svc;
    }

    it('the matching-case control answers with the stored spelling', async () => {
      const svc = await caseGraph();
      expect(svc.getDependencies(A)).toEqual([B]);
      expect(svc.getDependencies(A, 2)).toEqual([B, C]);
      expect(svc.getDependents(B)).toEqual([A]);
      expect(svc.resolveNodePath(A)).toBe(A);
    });

    // R4-B1 (FB): a case-variant spelling answered [] with clean coverage.
    itOnWin32.each([
      [
        'a relative-joined variant',
        'D:\\Repo\\pkg\\a.ts',
        'D:\\Repo\\pkg\\b.ts',
      ],
      ['an absolute variant', 'd:/repo/pkg/a.ts', 'd:/repo/pkg/b.ts'],
    ])(
      'R4-B1: %s resolves to the stored node (dependencies, depth 2, dependents)',
      async (_label, aVariant, bVariant) => {
        const svc = await caseGraph();
        expect(svc.getDependencies(aVariant)).toEqual([B]);
        expect(svc.getDependencies(aVariant, 2)).toEqual([B, C]);
        expect(svc.getDependents(bVariant)).toEqual([A]);
        expect(svc.resolveNodePath(aVariant)).toBe(A);
      },
    );

    itOffWin32(
      'a case variant is a different path where paths are case-sensitive',
      async () => {
        const svc = await caseGraph();
        expect(svc.getDependencies('D:/repo/pkg/a.ts')).toEqual([]);
        expect(svc.resolveNodePath('D:/repo/pkg/a.ts')).toBeUndefined();
      },
    );

    itOnWin32(
      'an ambiguous folded identity selects no node; an exact spelling still wins',
      async () => {
        const lower = 'D:/Repo/x.ts';
        const upper = 'D:/Repo/X.ts';
        const { svc } = serviceWith({
          [lower]: insights([imp('./Pkg/B')], []),
          [upper]: insights([imp('./Pkg/C')], []),
        });
        await svc.buildGraph([lower, upper, B, C], REPO, {});

        expect(svc.resolveNodePath('d:/repo/X.TS')).toBeUndefined();
        expect(svc.getDependencies('d:/repo/X.TS')).toEqual([]);
        expect(svc.getDependencies(upper)).toEqual([C]);
        expect(svc.getDependencies(lower)).toEqual([B]);
      },
    );

    // R4-M1 (FB): a failed root realpath dropped the alias identity silently.
    describe('root realpath failure', () => {
      afterEach(() => {
        jest.restoreAllMocks();
      });

      function failRealpath(code: string): jest.SpyInstance {
        return jest
          .spyOn(fs.promises, 'realpath')
          .mockRejectedValue(
            Object.assign(new Error(`${code}: realpath failed`), { code }),
          );
      }

      it('R4-M1: an EIO lookup is disclosed as unknown unchecked files, never clean', async () => {
        failRealpath('EIO');
        const { svc } = serviceWith(INSIGHTS);
        await svc.buildGraph(A_FILES, WS_A, {});

        const languages = svc.getCoverageReport(WS_A)!.languages;
        expect(languages.unchecked).toBeNull();
        expect(languages.clean).toBe(false);
        expect(languages.reasons[0]).toBe('unchecked?');
        // The graph itself still answers (lexical identity is kept).
        expect(svc.getDependents('D:/ws-a/b.ts')).toEqual(['D:/ws-a/a.ts']);
        // An invalidation keeps it unknown, not a number.
        svc.invalidateFile('D:/ws-a/a.ts');
        expect(svc.getCoverageReport(WS_A)!.languages.unchecked).toBeNull();
      });

      it('an absent root (ENOENT) proves no alias exists: coverage stays clean', async () => {
        failRealpath('ENOENT');
        const { svc } = serviceWith(INSIGHTS);
        await svc.buildGraph(A_FILES, WS_A, {});

        expect(isCleanAnswer(svc.getCoverageReport(WS_A)!.languages)).toBe(
          true,
        );
      });

      it('a later build whose lookup succeeds is clean again', async () => {
        const spy = failRealpath('EACCES');
        const { svc } = serviceWith(INSIGHTS);
        await svc.buildGraph(A_FILES, WS_A, {});
        expect(svc.getCoverageReport(WS_A)!.languages.clean).toBe(false);

        spy.mockRejectedValue(
          Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
        );
        await svc.buildGraph(A_FILES, WS_A, {});
        expect(svc.getCoverageReport(WS_A)!.languages.clean).toBe(true);
      });
    });

    describe('a junction/symlink alias root (real filesystem fixture)', () => {
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ptah-graph-r4-alias-'),
      );
      const realRoot = path.join(tempDir, 'real');
      const aliasRoot = path.join(tempDir, 'alias');
      fs.mkdirSync(path.join(realRoot, 'pkg'), { recursive: true });
      for (const name of ['a.ts', 'b.ts']) {
        fs.writeFileSync(path.join(realRoot, 'pkg', name), '');
      }
      let linked = true;
      try {
        fs.symlinkSync(realRoot, aliasRoot, onWin32 ? 'junction' : 'dir');
      } catch (error: unknown) {
        linked = false;
        console.warn(
          `[r4] junction spec skipped: cannot create a directory link (${String(error)})`,
        );
      }
      const alias = aliasRoot.replace(/\\/g, '/');

      afterAll(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      afterEach(() => {
        jest.restoreAllMocks();
      });

      (linked ? it : it.skip)(
        'a query spelt through the real path finds the node of the alias root',
        async () => {
          const { svc } = serviceWith({
            [`${alias}/pkg/a.ts`]: insights([imp('./b')], []),
          });
          await svc.buildGraph(
            [`${alias}/pkg/a.ts`, `${alias}/pkg/b.ts`],
            alias,
            {},
          );

          expect(svc.getDependents(path.join(realRoot, 'pkg', 'b.ts'))).toEqual(
            [`${alias}/pkg/a.ts`],
          );
          expect(svc.resolveNodePath(path.join(realRoot, 'pkg', 'a.ts'))).toBe(
            `${alias}/pkg/a.ts`,
          );
        },
      );

      // r1 B2 (FB): routing used lexical roots only, so a second cached root
      // made the real-path query unroutable.
      (linked ? it : it.skip).each([
        ['alias graph first', false],
        ['sibling graph first', true],
      ])(
        'r1 B2: a real-path query reaches the alias graph with an unrelated root cached (%s)',
        async (_label, siblingFirst) => {
          const { svc } = serviceWith({
            [`${alias}/pkg/a.ts`]: insights([imp('./b')], []),
          });
          const buildAlias = () =>
            svc.buildGraph(
              [`${alias}/pkg/a.ts`, `${alias}/pkg/b.ts`],
              alias,
              {},
            );
          const buildSibling = () =>
            svc.buildGraph(['D:/elsewhere/x.ts'], 'D:/elsewhere', {});
          if (siblingFirst) {
            await buildSibling();
            await buildAlias();
          } else {
            await buildAlias();
            await buildSibling();
          }

          const realB = path.join(realRoot, 'pkg', 'b.ts');
          expect(svc.getDependents(realB)).toEqual([`${alias}/pkg/a.ts`]);
          expect(
            isCleanAnswer(svc.getCoverageReportForFile(realB)!.languages),
          ).toBe(true);
        },
      );

      // r1 B2: a graph of the alias and a graph of its real target both
      // contain a real-path query at the same depth: the smaller key answers,
      // whatever order they were built in.
      (linked ? it : it.skip).each([[false], [true]])(
        'r1 B2: equally deep containing graphs are chosen deterministically (real graph first: %p)',
        async (realFirst) => {
          const { svc } = serviceWith({});
          const aliasFiles = [`${alias}/pkg/a.ts`];
          const realSlashed = realRoot.replace(/\\/g, '/');
          const realFiles = [`${realSlashed}/pkg/a.ts`];
          const builds = [
            () => svc.buildGraph(aliasFiles, alias, {}),
            () => svc.buildGraph(realFiles, realSlashed, {}),
          ];
          for (const build of realFirst ? builds.reverse() : builds) {
            await build();
          }
          const expected =
            graphPathIdentity(alias) < graphPathIdentity(realSlashed)
              ? `${alias}/pkg/a.ts`
              : `${realSlashed}/pkg/a.ts`;

          expect(svc.resolveNodePath(path.join(realRoot, 'pkg', 'a.ts'))).toBe(
            expected,
          );
        },
      );

      (linked ? it : it.skip)(
        'graphSpellingsOf re-roots a real-target prefix at the alias key, keeping a trailing slash',
        async () => {
          const { svc } = serviceWith({});
          await svc.buildGraph([`${alias}/pkg/a.ts`], alias, {});

          expect(
            svc.graphSpellingsOf(`${realRoot.replace(/\\/g, '/')}/pkg/`),
          ).toContain(`${graphPathIdentity(alias)}/pkg/`);
          expect(svc.graphSpellingsOf('D:/unrelated/pkg/')).toEqual([]);
        },
      );

      // r2 B1 (FB): a prefix ABOVE a root, in the root's real spelling,
      // selects that root's whole graph; a sibling name does not.
      (linked ? it : it.skip)(
        'r2 B1: graphSpellingsOf maps a real-spelled ancestor prefix to the alias/pkg root',
        async () => {
          const { svc } = serviceWith({});
          await svc.buildGraph([`${alias}/pkg/a.ts`], `${alias}/pkg`, {});
          const realSlashed = realRoot.replace(/\\/g, '/');
          const rootSpelling = `${graphPathIdentity(`${alias}/pkg`)}/`;

          expect(svc.graphSpellingsOf(`${realSlashed}/`)).toContain(
            rootSpelling,
          );
          expect(svc.graphSpellingsOf(realSlashed)).toContain(rootSpelling);
          expect(svc.graphSpellingsOf(`${alias}/`)).toContain(rootSpelling);
          expect(svc.graphSpellingsOf(`${realSlashed}x/`)).toEqual([]);
          expect(svc.graphSpellingsOf(`${realSlashed}/pk/`)).toEqual([]);
        },
      );

      // The reviewer's r4 probe: EIO injected during both builds, restored
      // before the invalidation through the real path.
      (linked ? it : it.skip)(
        'R4-M1 probe: parent and child alias roots built during EIO are not clean after a real-path invalidation',
        async () => {
          const files = [`${alias}/pkg/a.ts`, `${alias}/pkg/b.ts`];
          const { svc } = serviceWith({});
          const spy = jest
            .spyOn(fs.promises, 'realpath')
            .mockRejectedValue(
              Object.assign(new Error('EIO'), { code: 'EIO' }),
            );
          await svc.buildGraph(files, alias, {});
          await svc.buildGraph(files, `${alias}/pkg`, {});
          spy.mockRestore();

          svc.invalidateFile(path.join(realRoot, 'pkg', 'a.ts'));

          for (const root of [alias, `${alias}/pkg`]) {
            expect(svc.getCoverageReport(root)!.languages.clean).toBe(false);
          }
        },
      );
    });
  });
});

// Batch 24d R5-01: a file whose exports the extractor could not fully read
// (`unextractedExports`) is counted `failed` (`unsupported-syntax`), never
// cleanly analysed, keeps its edges and known symbols, and stays in the
// symbol index even with no extracted export.
describe('DependencyGraphService — partial export extraction (R5-01)', () => {
  const PARTIAL = 'D:/ws-p/partial.js';
  const MIXED = 'D:/ws-p/mixed.js';
  const CLEAN = 'D:/ws-p/clean.js';

  function partialInsights(): Record<string, CodeInsights> {
    return {
      [PARTIAL]: {
        ...insights([imp('./clean')], []),
        parseStatus: 'ok',
        unextractedExports: ['line 1: exports'],
      },
      [MIXED]: {
        ...insights([], [exp('known')]),
        parseStatus: 'ok',
        unextractedExports: ['line 2: exports'],
      },
      [CLEAN]: { ...insights([], [exp('C')]), parseStatus: 'ok' },
    };
  }

  it('counts an empty and a mixed partial file as failed, not analysed', async () => {
    const svc = makeServiceWith(partialInsights());
    await svc.buildGraph([PARTIAL, MIXED, CLEAN], 'D:/ws-p');

    const languages = svc.getCoverageReport('D:/ws-p')?.languages;
    expect(languages).toMatchObject({
      analyzed: 1,
      failed: 2,
      failedByReason: { 'unsupported-syntax': 2 },
    });
    expect(languages && isCleanAnswer(languages)).toBe(false);
    // The partial file's edge is kept.
    expect(svc.getDependents(CLEAN)).toEqual([PARTIAL]);
  });

  it('keeps partial files in the symbol index and names what was not extracted', async () => {
    const svc = makeServiceWith(partialInsights());
    await svc.buildGraph([PARTIAL, MIXED, CLEAN], 'D:/ws-p');

    const index = svc.getSymbolIndex('D:/ws-p');
    expect(index.get(PARTIAL)).toEqual([]);
    expect(index.get(MIXED)?.map((e) => e.name)).toEqual(['known']);
    expect(svc.getUnextractedExports(PARTIAL)).toEqual(['line 1: exports']);
    expect(svc.getUnextractedExports(MIXED)).toEqual(['line 2: exports']);
    expect(svc.getUnextractedExports(CLEAN)).toBeUndefined();
  });

  it('does not move a partial file to unchecked when it is invalidated', async () => {
    const svc = makeServiceWith(partialInsights());
    await svc.buildGraph([PARTIAL, CLEAN], 'D:/ws-p');

    svc.invalidateFile(PARTIAL);

    expect(svc.getCoverageReport('D:/ws-p')?.languages).toMatchObject({
      analyzed: 1,
      unchecked: 0,
      failed: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// TASK_2026_559 Batch 32b: resolver dispatch, resolver context, re-exports.
// ---------------------------------------------------------------------------

/** A throw-away workspace root on disk (real path, forward slashes). */
function tempRoot(files: Record<string, string>): string {
  const root = fs
    .realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-32b-')))
    .replace(/\\/g, '/');
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

/** The language coverage published for `root`; fails the test when none is. */
function languagesOf(
  svc: DependencyGraphService,
  root: string,
): LanguageCoverage {
  const languages = svc.getCoverageReport(root)?.languages;
  if (languages === undefined) throw new Error('no coverage published');
  return languages;
}

function reExport(name: string, source: string): ExportInfo {
  return {
    name,
    kind: name === '*' ? 'wildcard' : 'unknown',
    isReExport: true,
    source,
  };
}

describe('DependencyGraphService — resolver context (TASK_2026_559 Batch 32b)', () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  });

  // FB: the MCP namespace passes no tsconfig `paths` (`undefined`); on the
  // batch base an alias import then never resolved. The resolver context
  // now reads the root tsconfig itself (JSONC: comments, trailing commas),
  // and a package the root package.json declares is proven external.
  it('tsconfig alias resolves on the MCP path', async () => {
    const root = tempRoot({
      'package.json': '{ "dependencies": { "lodash": "^4.17.21" } }',
      'tsconfig.base.json': [
        '{',
        '  // Workspace aliases',
        '  "compilerOptions": {',
        '    /* resolved from the root */',
        '    "paths": { "@app/*": ["src/*"], },',
        '  },',
        '}',
      ].join('\n'),
    });
    roots.push(root);
    const a = `${root}/a.ts`;
    const util = `${root}/src/util.ts`;
    const svc = makeServiceWith({
      [a]: insights([imp('@app/util'), imp('lodash')], []),
      [util]: insights([], [exp('util')]),
    });

    await svc.buildGraph([a, util], root, undefined);

    expect(svc.getDependents(util)).toEqual([a]);
    const languages = languagesOf(svc, root);
    expect(languages.resolution).toEqual({
      external: 1,
      unresolvedInternal: 0,
      truncatedImports: 0,
      edgeCapHit: false,
      context: 'complete',
    });
    expect(isCleanAnswer(languages)).toBe(true);
  });

  it('resolves a bare specifier through the tsconfig baseUrl', async () => {
    const root = tempRoot({
      'tsconfig.json': '{ "compilerOptions": { "baseUrl": "./src" } }',
    });
    roots.push(root);
    const a = `${root}/a.ts`;
    const helper = `${root}/src/utils/helper.ts`;
    const svc = makeServiceWith({
      [a]: insights([imp('utils/helper')], []),
      [helper]: insights([], []),
    });

    await svc.buildGraph([a, helper], root);

    expect(svc.getDependents(helper)).toEqual([a]);
  });

  // Limits disclosed: a manifest over 256 KiB is not read, so the context is
  // partial and the coverage says so (never clean).
  it('discloses a manifest over the size limit as a partial context', async () => {
    const root = tempRoot({
      'tsconfig.json': `{ "compilerOptions": {} ${' '.repeat(256 * 1024)}}`,
    });
    roots.push(root);
    const a = `${root}/a.ts`;
    const b = `${root}/b.ts`;
    const svc = makeServiceWith({
      [a]: insights([imp('./b')], []),
      [b]: insights([], []),
    });

    await svc.buildGraph([a, b], root);

    const languages = languagesOf(svc, root);
    expect(languages.resolution?.context).toBe('partial');
    expect(languages.approximations).toEqual(['resolver-context-partial']);
    expect(isCleanAnswer(languages)).toBe(false);
    expect(svc.getDependents(b)).toEqual([a]);
  });

  // R32B-01 (review r1 scenario): a root tsconfig.json that extends the base
  // and overrides `paths` wins, as TypeScript's own resolver decides.
  it('resolves an alias through the overriding child tsconfig, not the base', async () => {
    const root = tempRoot({
      'tsconfig.base.json':
        '{ "compilerOptions": { "baseUrl": ".", "paths": { "@x": ["old.ts"] } } }',
      'tsconfig.json':
        '{ "extends": "./tsconfig.base.json", "compilerOptions": { "paths": { "@x": ["new.ts"] } } }',
    });
    roots.push(root);
    const main = `${root}/main.ts`;
    const oldFile = `${root}/old.ts`;
    const newFile = `${root}/new.ts`;
    const svc = makeServiceWith({
      [main]: insights([imp('@x')], []),
      [oldFile]: insights([], []),
      [newFile]: insights([], []),
    });

    await svc.buildGraph([main, oldFile, newFile], root);

    expect(svc.getDependencies(main)).toEqual([newFile]);
    expect(svc.getDependents(newFile)).toEqual([main]);
    expect(svc.getDependents(oldFile)).toEqual([]);
    expect(isCleanAnswer(languagesOf(svc, root))).toBe(true);
  });

  it('discloses independent root tsconfigs that map an alias differently', async () => {
    const root = tempRoot({
      'tsconfig.app.json':
        '{ "compilerOptions": { "paths": { "@x": ["a.ts"] } } }',
      'tsconfig.lib.json':
        '{ "compilerOptions": { "paths": { "@x": ["b.ts"] } } }',
    });
    roots.push(root);
    const main = `${root}/main.ts`;
    const svc = makeServiceWith({
      [main]: insights([imp('@x')], []),
      [`${root}/a.ts`]: insights([], []),
      [`${root}/b.ts`]: insights([], []),
    });

    await svc.buildGraph([main, `${root}/a.ts`, `${root}/b.ts`], root);

    expect(svc.getDependencies(main)).toEqual([]);
    const languages = languagesOf(svc, root);
    expect(languages.resolution?.context).toBe('partial');
    expect(isCleanAnswer(languages)).toBe(false);
  });

  // R32B-02 (review r1 scenario): a `file:` dependency is the workspace's own
  // package, linked to its entry file, never certified external.
  it('links a file: dependency to the local package, not to an external', async () => {
    const root = tempRoot({
      'package.json':
        '{ "dependencies": { "local": "file:./packages/local" } }',
    });
    roots.push(root);
    const main = `${root}/main.ts`;
    const entry = `${root}/packages/local/index.ts`;
    const svc = makeServiceWith({
      [main]: insights([imp('local')], []),
      [entry]: insights([], [exp('x')]),
    });

    await svc.buildGraph([main, entry], root);

    expect(svc.getDependents(entry)).toEqual([main]);
    expect(languagesOf(svc, root).resolution).toMatchObject({
      external: 0,
      unresolvedInternal: 0,
      context: 'complete',
    });
  });

  it('never reads a workspace: dependency it cannot locate as clean', async () => {
    const root = tempRoot({
      'package.json': '{ "dependencies": { "shared": "workspace:*" } }',
    });
    roots.push(root);
    const main = `${root}/main.ts`;
    const svc = makeServiceWith({ [main]: insights([imp('shared')], []) });

    await svc.buildGraph([main], root);

    const languages = languagesOf(svc, root);
    expect(languages.resolution).toMatchObject({
      external: 0,
      unresolvedInternal: 1,
    });
    expect(isCleanAnswer(languages)).toBe(false);
  });
});

describe('DependencyGraphService — multi-target expansion (TASK_2026_559 Batch 32b)', () => {
  const SOURCE = 'D:/ws-m/source.ts';
  const TARGETS = Array.from({ length: 500 }, (_, i) => `D:/ws-m/t${i}.ts`);
  const FILES = [SOURCE, ...TARGETS];

  /** The TS resolver answers `./package` with every target (a package edge). */
  function expandingResolver(onResolve: () => void = () => undefined) {
    return jest
      .spyOn(TS_JS_IMPORT_RESOLVER, 'resolve')
      .mockImplementation((imp, fromFile) => {
        if (imp.source !== './package') {
          throw new Error(`unexpected import ${imp.source} in ${fromFile}`);
        }
        onResolve();
        return { kind: 'package', targets: TARGETS };
      });
  }

  function expansionService() {
    return makeServiceWith({ [SOURCE]: insights([imp('./package')], []) });
  }

  afterEach(() => jest.restoreAllMocks());

  // Limits disclosed: one import expands to at most 200 targets.
  it('links at most 200 targets per import and counts the import truncated', async () => {
    expandingResolver();
    const svc = expansionService();

    await svc.buildGraph(FILES, 'D:/ws-m');

    expect(svc.getDependencies(SOURCE)).toEqual(TARGETS.slice(0, 200));
    const languages = languagesOf(svc, 'D:/ws-m');
    expect(languages.resolution).toMatchObject({
      truncatedImports: 1,
      unresolvedInternal: 0,
      external: 0,
    });
    expect(isCleanAnswer(languages)).toBe(false);
  });

  // Cancellation mid-expansion: a background build yields inside one
  // import's target list and stops there once it is superseded.
  it('stops a superseded background build in the middle of one expansion', async () => {
    let resolved = false;
    expandingResolver(() => {
      resolved = true;
    });
    const svc = expansionService();
    let clock = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => ++clock);
    let beatsAfterResolve = 0;
    let handle: ReturnType<typeof setImmediate> | undefined;
    const beat = (): void => {
      if (resolved && ++beatsAfterResolve === 2) svc.evict('D:/ws-m');
      handle = setImmediate(beat);
    };
    handle = setImmediate(beat);
    let graph: DependencyGraph | undefined;
    try {
      graph = await svc.buildGraph(FILES, 'D:/ws-m', undefined, undefined, {
        yieldToForeground: true,
      });
    } finally {
      if (handle !== undefined) clearImmediate(handle);
    }

    const linked = graph?.edges.get(SOURCE)?.size ?? 0;
    expect(linked).toBeGreaterThan(0);
    expect(linked).toBeLessThan(200);
    expect(svc.isBuilt('D:/ws-m')).toBe(false);
    expect(svc.getCoverageReport('D:/ws-m')).toBeUndefined();
  });
});

describe('DependencyGraphService — case rule (TASK_2026_559 Batch 32b)', () => {
  it('uses a unique case-folded match and discloses it', async () => {
    const svc = makeServiceWith({
      'D:/ws-a/a.ts': insights([imp('./Util')], []),
      'D:/ws-a/util.ts': insights([], []),
    });
    await svc.buildGraph(['D:/ws-a/a.ts', 'D:/ws-a/util.ts'], WS_A);

    expect(svc.getDependents('D:/ws-a/util.ts')).toEqual(['D:/ws-a/a.ts']);
    const languages = languagesOf(svc, WS_A);
    expect(languages.approximations).toEqual(['case-folded']);
  });

  it('prefers an exact match over case-folded ones', async () => {
    const svc = makeServiceWith({
      'D:/ws-a/a.ts': insights([imp('./util')], []),
      'D:/ws-a/util.ts': insights([], []),
      'D:/ws-a/Util.ts': insights([], []),
    });
    await svc.buildGraph(
      ['D:/ws-a/a.ts', 'D:/ws-a/util.ts', 'D:/ws-a/Util.ts'],
      WS_A,
    );

    expect(svc.getDependencies('D:/ws-a/a.ts')).toEqual(['D:/ws-a/util.ts']);
    expect(
      svc.getCoverageReport(WS_A)?.languages.approximations,
    ).toBeUndefined();
  });

  it('leaves an ambiguous case-folded match unresolved-internal', async () => {
    const svc = makeServiceWith({
      'D:/ws-a/a.ts': insights([imp('./UTIL')], []),
      'D:/ws-a/util.ts': insights([], []),
      'D:/ws-a/Util.ts': insights([], []),
    });
    await svc.buildGraph(
      ['D:/ws-a/a.ts', 'D:/ws-a/util.ts', 'D:/ws-a/Util.ts'],
      WS_A,
    );

    expect(svc.getDependencies('D:/ws-a/a.ts')).toEqual([]);
    expect(svc.getCoverageReport(WS_A)?.languages.resolution).toMatchObject({
      unresolvedInternal: 1,
      external: 0,
    });
  });
});

describe('DependencyGraphService — re-export edges (26b closing R26B-C-B1, 32a R32A-05)', () => {
  const LEAF = 'D:/ws-r/leaf.ts';
  const BARREL = 'D:/ws-r/lib/index.ts';
  const OUTER = 'D:/ws-r/outer.ts';
  const CONSUMER = 'D:/ws-r/consumer.ts';
  const FILES = [LEAF, BARREL, OUTER, CONSUMER];

  it.each([
    ['a named re-export', reExport('X', '../leaf')],
    ['a wildcard re-export', reExport('*', '../leaf')],
  ])(
    'lists the barrel and its consumers as dependents of the source (%s)',
    async (_label, barrelExport) => {
      const svc = makeServiceWith({
        [LEAF]: insights([], [exp('X')]),
        [BARREL]: insights([], [barrelExport]),
        // outer.ts re-exports the barrel: a chain of barrels.
        [OUTER]: insights([], [reExport('*', './lib')]),
        [CONSUMER]: insights([imp('./outer')], []),
      });
      await svc.buildGraph(FILES, 'D:/ws-r');

      expect(svc.getDependencies(BARREL)).toEqual([LEAF]);
      expect(svc.getDependents(LEAF).sort()).toEqual(
        [BARREL, CONSUMER, OUTER].sort(),
      );
      // A plain import does not pass a file's dependents on.
      expect(svc.getDependents(OUTER)).toEqual([CONSUMER]);
    },
  );

  it('drops the barrel consumers with the barrel when the barrel is invalidated', async () => {
    const svc = makeServiceWith({
      [LEAF]: insights([], [exp('X')]),
      [BARREL]: insights([], [reExport('X', '../leaf')]),
      [CONSUMER]: insights([imp('./lib')], []),
    });
    await svc.buildGraph([LEAF, BARREL, CONSUMER], 'D:/ws-r');
    expect(svc.getDependents(LEAF).sort()).toEqual([BARREL, CONSUMER].sort());

    svc.invalidateFile(BARREL);

    expect(svc.getDependents(LEAF)).toEqual([]);
  });

  // R32A-05: an empty clause (`export {}` + from) exports no name but still
  // loads its module; the analysis reports it in `reExportSources` (its
  // real-grammar extraction is pinned in `ast-analysis.service.spec.ts`).
  it('an empty re-export clause makes an edge and passes dependents on', async () => {
    const side = 'D:/ws-r/side.ts';
    const entry = 'D:/ws-r/entry.ts';
    const svc = makeServiceWith({
      [side]: insights([], [exp('s')]),
      [entry]: {
        ...insights([], []),
        reExportSources: ['./side'],
      } as CodeInsights,
      [CONSUMER]: insights([imp('./entry')], []),
    });
    await svc.buildGraph([side, entry, CONSUMER], 'D:/ws-r');

    expect(svc.getDependencies(entry)).toEqual([side]);
    expect(svc.getDependents(side).sort()).toEqual([CONSUMER, entry].sort());
    expect(svc.getCoverageReport('D:/ws-r')?.languages.resolution).toEqual({
      external: 0,
      unresolvedInternal: 0,
      truncatedImports: 0,
      edgeCapHit: false,
      context: 'complete',
    });
  });

  // R32B-05: both channels carry the decoded value, so one re-export
  // statement is one dependency, never an extra unresolved one.
  it('links a re-export reported by both channels once', async () => {
    const svc = makeServiceWith({
      [LEAF]: insights([], [exp('X')]),
      [BARREL]: {
        ...insights([], [reExport('X', '../leaf')]),
        reExportSources: ['../leaf'],
      },
    });
    await svc.buildGraph([LEAF, BARREL], 'D:/ws-r');

    expect(svc.getDependencies(BARREL)).toEqual([LEAF]);
    expect(languagesOf(svc, 'D:/ws-r').resolution).toMatchObject({
      external: 0,
      unresolvedInternal: 0,
    });
  });

  it('counts an unresolvable re-export source like an import', async () => {
    const svc = makeServiceWith({
      [BARREL]: insights([], [reExport('X', './gone'), reExport('*', 'pkg')]),
    });
    await svc.buildGraph([BARREL], 'D:/ws-r');

    expect(
      svc.getCoverageReport('D:/ws-r')?.languages.resolution,
    ).toMatchObject({ external: 1, unresolvedInternal: 1 });
  });
});
