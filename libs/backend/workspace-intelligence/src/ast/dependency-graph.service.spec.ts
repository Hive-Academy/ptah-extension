/**
 * Specs for DependencyGraphService multi-workspace behavior.
 *
 * Covers:
 *   - single-workspace build + queries (dependents / dependencies / symbols)
 *   - multiple workspaces held simultaneously, isolated by root
 *   - per-file query routing by longest-prefix root match
 *   - workspace-root normalization (slashes / trailing slash)
 *   - eviction: evict(root) / retainOnly(roots) / clear()
 */

import 'reflect-metadata';
import { Result } from '@ptah-extension/shared';
import type {
  BackgroundWorkAdmission,
  Logger,
} from '@ptah-extension/vscode-core';
import { DependencyGraphService } from './dependency-graph.service';
import type { AstAnalysisService } from './ast-analysis.service';
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
