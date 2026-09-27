/**
 * Specs for the graph coverage accounting (TASK_2026_559 Batch 23a):
 * eligible-only parse cap shared round-robin per language, census buckets,
 * resolution counts, saturation and the multi-root merge.
 */
import {
  COVERAGE_COUNT_MAX,
  isCleanAnswer,
  type LanguageCoverage,
} from '@ptah-extension/platform-core';
import {
  GRAPH_EDGE_CAP,
  GRAPH_PARSE_CAP,
  buildGraphCoverage,
  classifyUnresolvedSpecifier,
  invalidatedCoverage,
  limitLanguageCounts,
  mergeGraphCoverages,
  saturatingSum,
  selectGraphFiles,
  type GraphCoverageInput,
  type GraphResolutionCounts,
} from './graph-coverage';

const CLEAN_RESOLUTION: GraphResolutionCounts = {
  external: 0,
  unresolvedInternal: 0,
  truncatedImports: 0,
  edgeCapHit: false,
  context: 'complete',
};

function coverageOf(
  files: readonly string[],
  overrides: Partial<GraphCoverageInput> = {},
): LanguageCoverage {
  const selection = selectGraphFiles(files);
  return buildGraphCoverage({
    selection,
    analyzed: selection.selected.length,
    failedByReason: {},
    resolution: CLEAN_RESOLUTION,
    omittedUpstream: 0,
    ...overrides,
  });
}

describe('graph-coverage — limits', () => {
  it('pins the plan bounds', () => {
    expect(GRAPH_PARSE_CAP).toBe(5_000);
    expect(GRAPH_EDGE_CAP).toBe(250_000);
  });
});

describe('selectGraphFiles — parse cap', () => {
  // FB (batch 23a): the old caller cap took the first 5,000 discovered paths,
  // so a large TypeScript tree listed first left no room for JavaScript.
  it('cap does not starve the second language', () => {
    const ts = Array.from({ length: 6_000 }, (_, i) => `D:/ws/src/f${i}.ts`);
    const js = Array.from({ length: 10 }, (_, i) => `D:/ws/scripts/s${i}.js`);

    const selection = selectGraphFiles([...ts, ...js]);

    expect(selection.selected).toHaveLength(GRAPH_PARSE_CAP);
    expect(selection.selected.filter((f) => f.endsWith('.js'))).toHaveLength(
      10,
    );
    expect(selection.omittedByCap).toBe(6_010 - GRAPH_PARSE_CAP);
  });

  it('shares the cap round-robin, each language in code-unit path order', () => {
    const files = [
      'D:/ws/z.ts',
      'D:/ws/b.ts',
      'D:/ws/a.ts',
      'D:/ws/y.js',
      'D:/ws/x.js',
      'D:/ws/w.js',
    ];

    const selection = selectGraphFiles(files, 4);

    // typescript before javascript (registry order), two rounds of each.
    expect(new Set(selection.selected)).toEqual(
      new Set(['D:/ws/a.ts', 'D:/ws/b.ts', 'D:/ws/w.js', 'D:/ws/x.js']),
    );
    // The selection keeps the given order.
    expect(selection.selected).toEqual([
      'D:/ws/b.ts',
      'D:/ws/a.ts',
      'D:/ws/x.js',
      'D:/ws/w.js',
    ]);
    expect(selection.omittedByCap).toBe(2);
  });

  it('is independent of the order the files were given', () => {
    const files = Array.from({ length: 30 }, (_, i) =>
      i % 2 ? `D:/ws/m${i}.ts` : `D:/ws/n${i}.jsx`,
    );
    const forward = selectGraphFiles(files, 7).selected;
    const backward = selectGraphFiles([...files].reverse(), 7).selected;
    expect(new Set(backward)).toEqual(new Set(forward));
  });

  it('selects every graph-capable file under the cap, in the given order', () => {
    const files = ['D:/ws/b.tsx', 'D:/ws/a.jsx', 'D:/ws/c.js'];
    const selection = selectGraphFiles(files);
    expect(selection.selected).toEqual(files);
    expect(selection.omittedByCap).toBe(0);
  });

  it('counts only graph-capable files against the cap', () => {
    const py = Array.from({ length: 50 }, (_, i) => `D:/ws/p${i}.py`);
    const selection = selectGraphFiles([...py, 'D:/ws/a.ts', 'D:/ws/b.ts'], 2);
    expect(selection.selected).toEqual(['D:/ws/a.ts', 'D:/ws/b.ts']);
    expect(selection.omittedByCap).toBe(0);
    expect(selection.unsupported).toBe(50);
  });

  it('counts a path listed twice (either separator) once', () => {
    const selection = selectGraphFiles([
      'D:/ws/a.ts',
      'D:\\ws\\a.ts',
      'D:/ws/a.ts',
    ]);
    expect(selection.selected).toEqual(['D:/ws/a.ts']);
    expect(selection.omittedByCap).toBe(0);
  });
});

describe('selectGraphFiles — census buckets', () => {
  it('puts every file in exactly one bucket', () => {
    const selection = selectGraphFiles([
      'D:/ws/a.ts',
      'D:/ws/tool.py',
      'D:/ws/main.go',
      'D:/ws/App.java',
      'D:/ws/legacy.mjs',
      'D:/ws/ios/View.swift',
      'D:/ws/build.zig',
      'D:/ws/Dockerfile',
      'D:/ws/README.md',
      'D:/ws/package.json',
    ]);

    expect(selection.selected).toEqual(['D:/ws/a.ts']);
    expect(selection.unsupported).toBe(5);
    expect(selection.unsupportedByLanguage).toEqual({
      go: 1,
      java: 1,
      javascript: 1, // .mjs: recognised, not yet graphed
      python: 1,
      swift: 1,
    });
    expect(selection.unrecognised).toBe(2);
    expect(selection.nonSource).toBe(2);
  });

  it('keeps the eight largest languages and folds the rest into other', () => {
    expect(
      limitLanguageCounts({
        python: 9,
        go: 8,
        java: 7,
        rust: 6,
        php: 5,
        ruby: 4,
        cpp: 3,
        csharp: 2,
        kotlin: 1,
        swift: 1,
        other: 2,
      }),
    ).toEqual({
      python: 9,
      go: 8,
      java: 7,
      rust: 6,
      php: 5,
      ruby: 4,
      cpp: 3,
      csharp: 2,
      other: 4,
    });
  });
});

describe('buildGraphCoverage', () => {
  it('reads as clean for a fully graphed, fully resolved TS/JS tree', () => {
    const coverage = coverageOf([
      'D:/ws/a.ts',
      'D:/ws/b.js',
      'D:/ws/README.md',
    ]);
    expect(coverage).toEqual({
      clean: true,
      reasons: [],
      supportedLanguages: ['typescript', 'javascript', 'tsx'],
      census: 'complete',
      analyzed: 2,
      unchecked: 0,
      failed: 0,
      unsupported: 0,
      unrecognised: 0,
      nonSource: 1,
      excluded: null,
      omittedByCap: 0,
      resolution: CLEAN_RESOLUTION,
    });
    expect(isCleanAnswer(coverage)).toBe(true);
  });

  it('counts failures by reason and caller-side drops as omitted', () => {
    const coverage = coverageOf(['D:/ws/a.ts', 'D:/ws/b.ts', 'D:/ws/c.ts'], {
      analyzed: 1,
      failedByReason: { read: 1, parse: 1, timeout: 0 },
      omittedUpstream: 4,
    });
    expect(coverage.failed).toBe(2);
    expect(coverage.failedByReason).toEqual({ read: 1, parse: 1 });
    expect(coverage.omittedByCap).toBe(4);
    expect(isCleanAnswer(coverage)).toBe(false);
  });

  it('discloses the resolution counts, the edge cap and partial context', () => {
    const coverage = coverageOf(['D:/ws/a.ts'], {
      resolution: {
        external: 3,
        unresolvedInternal: 2,
        truncatedImports: 0,
        edgeCapHit: true,
        context: 'partial',
      },
    });
    expect(coverage.resolution).toEqual({
      external: 3,
      unresolvedInternal: 2,
      truncatedImports: 0,
      edgeCapHit: true,
      context: 'partial',
    });
    expect(coverage.approximations).toEqual(['resolver-context-partial']);
    expect(isCleanAnswer(coverage)).toBe(false);
  });

  it('marks a truncated discovery and saturates every count', () => {
    const coverage = buildGraphCoverage({
      selection: {
        selected: [],
        omittedByCap: COVERAGE_COUNT_MAX,
        unsupported: COVERAGE_COUNT_MAX + 5,
        unrecognised: 0,
        nonSource: 0,
        unsupportedByLanguage: { python: COVERAGE_COUNT_MAX + 5 },
      },
      analyzed: COVERAGE_COUNT_MAX + 1,
      failedByReason: { read: COVERAGE_COUNT_MAX, parse: COVERAGE_COUNT_MAX },
      resolution: { ...CLEAN_RESOLUTION, external: COVERAGE_COUNT_MAX * 2 },
      omittedUpstream: 10,
      censusLimit: 50_001,
    });
    expect(coverage.census).toBe('truncated');
    expect(coverage.censusLimit).toBe(50_001);
    expect(coverage.analyzed).toBe(COVERAGE_COUNT_MAX);
    expect(coverage.failed).toBe(COVERAGE_COUNT_MAX);
    expect(coverage.unsupported).toBe(COVERAGE_COUNT_MAX);
    expect(coverage.omittedByCap).toBe(COVERAGE_COUNT_MAX);
    expect(coverage.unsupportedByLanguage).toEqual({
      python: COVERAGE_COUNT_MAX,
    });
    expect(coverage.resolution?.external).toBe(COVERAGE_COUNT_MAX);
  });
});

describe('classifyUnresolvedSpecifier (r1 B2, M1)', () => {
  it.each([
    ['./missing', false, 'internal'],
    ['../up/x', false, 'internal'],
    ['/abs/x', false, 'internal'],
    ['#b', false, 'internal'],
    ['@app/gone', true, 'internal'],
    ['node:fs', false, 'external'],
    ['node:fs/promises', false, 'external'],
    ['fs', false, 'context-dependent'],
    ['lodash', false, 'context-dependent'],
    ['utils/b', false, 'context-dependent'],
    ['@scope/pkg', false, 'context-dependent'],
  ] as const)('%s (alias claim %s) is %s', (specifier, claimed, kind) => {
    expect(classifyUnresolvedSpecifier(specifier, claimed)).toBe(kind);
  });
});

describe('invalidatedCoverage (r1 B1)', () => {
  const clean = coverageOf(['D:/ws/a.ts', 'D:/ws/b.ts']);

  it('moves an analysed file to unchecked and makes the context partial', () => {
    const after = invalidatedCoverage(clean, true);
    expect(after).toMatchObject({ analyzed: 1, unchecked: 1 });
    expect(after.resolution).toEqual({
      ...CLEAN_RESOLUTION,
      context: 'partial',
    });
    expect(isCleanAnswer(after)).toBe(false);
    expect(isCleanAnswer(clean)).toBe(true); // input untouched
  });

  it('moves no count for a path that was not an analysed node', () => {
    const after = invalidatedCoverage(clean, false);
    expect(after).toMatchObject({ analyzed: 2, unchecked: 0 });
    expect(isCleanAnswer(after)).toBe(false);
  });
});

describe('saturatingSum', () => {
  it('sums, saturates and is poisoned by null', () => {
    expect(saturatingSum([1, 2, 3])).toBe(6);
    expect(saturatingSum([COVERAGE_COUNT_MAX, 1])).toBe(COVERAGE_COUNT_MAX);
    expect(saturatingSum([1, null, 2])).toBeNull();
    expect(saturatingSum([])).toBe(0);
  });
});

describe('mergeGraphCoverages — multi-root merge', () => {
  const base = coverageOf(['D:/a/x.ts', 'D:/a/y.py']);

  it('returns undefined for no roots and the root itself for one', () => {
    expect(mergeGraphCoverages([])).toBeUndefined();
    expect(mergeGraphCoverages([base])).toBe(base);
  });

  it('sums counts saturating, with null poisoning', () => {
    const merged = mergeGraphCoverages([
      base,
      { ...base, analyzed: COVERAGE_COUNT_MAX, excluded: 3 },
    ]);
    expect(merged?.analyzed).toBe(COVERAGE_COUNT_MAX);
    expect(merged?.unsupported).toBe(2);
    expect(merged?.excluded).toBeNull(); // null + 3
    expect(merged?.unsupportedByLanguage).toEqual({ python: 2 });
  });

  it('takes the worst census and state', () => {
    const merged = mergeGraphCoverages([
      { ...base, state: 'current' },
      { ...base, census: 'truncated', censusLimit: 50_001, state: 'updating' },
      { ...base, census: 'complete' },
    ]);
    expect(merged?.census).toBe('truncated');
    expect(merged?.censusLimit).toBe(50_001);
    expect(merged?.state).toBe('updating');
    expect(
      mergeGraphCoverages([{ ...base, census: 'unknown' }, base])?.census,
    ).toBe('unknown');
  });

  it('unions languages and approximations; ORs the edge cap; partial wins', () => {
    const merged = mergeGraphCoverages([
      { ...base, supportedLanguages: ['javascript'] },
      {
        ...base,
        supportedLanguages: ['python', 'typescript'],
        resolution: {
          external: 1,
          unresolvedInternal: 2,
          truncatedImports: 3,
          edgeCapHit: true,
          context: 'partial',
        },
        approximations: ['resolver-context-partial', 'go:package-edges'],
        approximationsOmitted: 2,
      },
    ]);
    expect(merged?.supportedLanguages).toEqual([
      'typescript',
      'javascript',
      'python',
    ]);
    expect(merged?.resolution).toEqual({
      external: 1,
      unresolvedInternal: 2,
      truncatedImports: 3,
      edgeCapHit: true,
      context: 'partial',
    });
    expect(merged?.approximations).toEqual([
      'resolver-context-partial',
      'go:package-edges',
    ]);
    expect(merged?.approximationsOmitted).toBe(2);
    expect(merged && isCleanAnswer(merged)).toBe(false);
  });

  it('treats a root without resolution as unknown and partial', () => {
    const withoutResolution: LanguageCoverage = {
      ...base,
      resolution: undefined,
    };
    const merged = mergeGraphCoverages([base, withoutResolution]);
    expect(merged?.resolution).toEqual({
      external: null,
      unresolvedInternal: null,
      truncatedImports: null,
      edgeCapHit: false,
      context: 'partial',
    });
  });

  it('sums failure reasons and reports mixed checks', () => {
    const merged = mergeGraphCoverages([
      { ...base, failedByReason: { read: 1 }, checks: 'type-check' },
      { ...base, failedByReason: { read: 2, parse: 1 }, checks: 'syntax-only' },
    ]);
    expect(merged?.failedByReason).toEqual({ read: 3, parse: 1 });
    expect(merged?.checks).toBe('mixed');
  });

  it('keeps two clean roots clean', () => {
    const clean = coverageOf(['D:/a/x.ts']);
    const merged = mergeGraphCoverages([clean, clean]);
    expect(merged && isCleanAnswer(merged)).toBe(true);
    expect(merged?.analyzed).toBe(2);
  });
});
