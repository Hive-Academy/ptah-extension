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
import type { Logger } from '@ptah-extension/vscode-core';
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
