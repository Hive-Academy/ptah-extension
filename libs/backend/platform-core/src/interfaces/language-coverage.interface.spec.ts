/**
 * Pins the coverage contract's closed vocabularies, the clean answer rule and
 * the approximation overflow rule (TASK_2026_559 Batch 22, Task 22.1).
 *
 * Later batches (23b graph tools, 24b code index, 25b diagnostics, 26a/26b LSP)
 * decide "bare clean answer or qualified answer" through `isCleanAnswer`, so
 * each condition of the five-part rule has its own negative case here.
 */
import {
  APPROXIMATION_PRIORITY,
  FAILURE_REASONS,
  LANGUAGE_IDS,
  MAX_REPORTED_APPROXIMATIONS,
  RECOGNISED_LANGUAGE_IDS,
  COVERAGE_COUNT_MAX,
  COVERAGE_REASONS,
  MAX_COMPACT_FAILURE_REASONS,
  MAX_REPORTED_REASONS,
  compactCoverage,
  coverageReasons,
  isCleanAnswer,
  limitApproximations,
  withCoverageVerdict,
  type Approximation,
  type CoverageFields,
} from './language-coverage.interface';

const CLEAN: CoverageFields = {
  supportedLanguages: ['typescript', 'javascript'],
  census: 'complete',
  analyzed: 12,
  unchecked: 0,
  failed: 0,
  unsupported: 0,
  unrecognised: 0,
  nonSource: 0,
  excluded: 0,
  omittedByCap: 0,
};

describe('closed vocabularies', () => {
  it('has twelve language ids and no separate c id', () => {
    expect(LANGUAGE_IDS).toHaveLength(12);
    expect(LANGUAGE_IDS as readonly string[]).not.toContain('c');
    expect(new Set(LANGUAGE_IDS).size).toBe(LANGUAGE_IDS.length);
  });

  it('keeps recognised ids disjoint from capability ids, longest id 10 chars', () => {
    expect(RECOGNISED_LANGUAGE_IDS).toHaveLength(9);
    for (const id of RECOGNISED_LANGUAGE_IDS) {
      expect(LANGUAGE_IDS as readonly string[]).not.toContain(id);
    }
    const longest = Math.max(
      ...[...LANGUAGE_IDS, ...RECOGNISED_LANGUAGE_IDS].map((id) => id.length),
    );
    expect(longest).toBe(10);
  });

  it('has the six failure reasons', () => {
    expect([...FAILURE_REASONS]).toEqual([
      'read',
      'parse',
      'grammar-unavailable',
      'too-large',
      'timeout',
      'unsupported-syntax',
    ]);
  });
});

describe('isCleanAnswer', () => {
  it('accepts a complete census with empty qualifier buckets', () => {
    expect(isCleanAnswer(CLEAN)).toBe(true);
  });

  it('accepts analyzed null and excluded null (not observable)', () => {
    expect(isCleanAnswer({ ...CLEAN, analyzed: null, excluded: null })).toBe(
      true,
    );
  });

  it('accepts state current and a fully resolved graph', () => {
    expect(
      isCleanAnswer({
        ...CLEAN,
        state: 'current',
        resolution: {
          external: 40,
          unresolvedInternal: 0,
          truncatedImports: 0,
          edgeCapHit: false,
          context: 'complete',
        },
      }),
    ).toBe(true);
  });

  it.each(['truncated', 'unknown'] as const)('rejects census %s', (census) => {
    expect(isCleanAnswer({ ...CLEAN, census })).toBe(false);
  });

  it.each([
    'unchecked',
    'failed',
    'unsupported',
    'unrecognised',
    'omittedByCap',
  ] as const)('rejects %s > 0 and %s null', (bucket) => {
    expect(isCleanAnswer({ ...CLEAN, [bucket]: 1 })).toBe(false);
    expect(isCleanAnswer({ ...CLEAN, [bucket]: null })).toBe(false);
  });

  it('rejects observed exclusions', () => {
    expect(isCleanAnswer({ ...CLEAN, excluded: 3 })).toBe(false);
  });

  // r1 S1: a file no registry language claims must qualify the answer, not
  // vanish. Fails before r1 (no `unrecognised` bucket existed).
  it('rejects counted unrecognised files', () => {
    expect(isCleanAnswer({ ...CLEAN, unrecognised: 1 })).toBe(false);
  });

  // Orchestrator ruling: unknown never reads as clean. Fails before the
  // ruling (r1 accepted `unrecognised: null` like `excluded`).
  it('never treats unrecognised null as clean', () => {
    expect(isCleanAnswer({ ...CLEAN, unrecognised: null })).toBe(false);
  });

  it('never lets documented non-source files qualify the answer', () => {
    expect(isCleanAnswer({ ...CLEAN, nonSource: 250 })).toBe(true);
    expect(isCleanAnswer({ ...CLEAN, nonSource: null })).toBe(true);
  });

  it.each([
    { unresolvedInternal: 1 },
    { unresolvedInternal: null },
    { truncatedImports: 2 },
    { truncatedImports: null },
    { edgeCapHit: true },
    { context: 'partial' as const },
  ])('rejects resolution %p', (patch) => {
    const resolution = {
      external: 0,
      unresolvedInternal: 0,
      truncatedImports: 0,
      edgeCapHit: false,
      context: 'complete' as const,
      ...patch,
    };
    expect(isCleanAnswer({ ...CLEAN, resolution })).toBe(false);
  });

  it.each(['updating', 'incomplete'] as const)('rejects state %s', (state) => {
    expect(isCleanAnswer({ ...CLEAN, state })).toBe(false);
  });
});

/**
 * Batch 24r: every coverage object carries its verdict, first, so an agent
 * reading a reduced or cut answer never has to evaluate the rule itself.
 */
describe('withCoverageVerdict', () => {
  it('puts clean and reasons first, ahead of the fields', () => {
    const coverage = withCoverageVerdict({ ...CLEAN, unrecognised: null });
    expect(Object.keys(coverage).slice(0, 3)).toEqual([
      'clean',
      'reasons',
      'supportedLanguages',
    ]);
    expect(coverage.clean).toBe(false);
    expect(coverage.reasons).toEqual(['unrecognised?']);
  });

  it('is clean with no reasons exactly when isCleanAnswer holds', () => {
    const variants: CoverageFields[] = [
      CLEAN,
      { ...CLEAN, analyzed: null, excluded: null, nonSource: null },
      { ...CLEAN, census: 'truncated' },
      { ...CLEAN, state: 'updating' },
      { ...CLEAN, unrecognised: null },
      { ...CLEAN, failed: 2 },
      { ...CLEAN, excluded: 1 },
      {
        ...CLEAN,
        resolution: {
          external: 1,
          unresolvedInternal: 0,
          truncatedImports: 0,
          edgeCapHit: false,
          context: 'partial',
        },
      },
    ];
    for (const fields of variants) {
      const coverage = withCoverageVerdict(fields);
      expect(coverage.clean).toBe(isCleanAnswer(fields));
      expect(coverage.reasons.length === 0).toBe(coverage.clean);
    }
  });

  it('names unknowns before observed qualifiers, in COVERAGE_REASONS order, bounded', () => {
    const fields: CoverageFields = {
      ...CLEAN,
      census: 'truncated',
      failed: 4,
      unrecognised: null,
      omittedByCap: 9,
      unchecked: null,
    };
    expect(coverageReasons(fields)).toEqual([
      'truncated',
      'unchecked?',
      'unrecognised?',
      'failed',
      'omitted-by-cap',
    ]);
    expect(withCoverageVerdict(fields).reasons).toEqual([
      'truncated',
      'unchecked?',
      'unrecognised?',
    ]);
    expect(MAX_REPORTED_REASONS).toBe(3);
  });

  it('recomputes a stale verdict carried on the input', () => {
    const stale = { ...withCoverageVerdict(CLEAN), failed: 1 };
    const coverage = withCoverageVerdict(stale);
    expect(coverage.clean).toBe(false);
    expect(coverage.reasons).toEqual(['failed']);
  });

  it('gives every reason a code of at most 24 chars', () => {
    for (const reason of COVERAGE_REASONS) {
      expect(reason.length).toBeLessThanOrEqual(24);
    }
  });
});

/**
 * Batch 22c (User Decision 21): the coverage block a tool writes is compact.
 * Fails before 22c: `compactCoverage` did not exist, and every tool wrote the
 * full field set (all zero buckets included) into small answers.
 */
describe('compactCoverage', () => {
  const COUNT_KEYS = [
    'analyzed',
    'unchecked',
    'failed',
    'unsupported',
    'unrecognised',
    'nonSource',
    'excluded',
    'omittedByCap',
  ] as const;

  // Batch 31 r1 R31-01: a clean answer never hides its approximations.
  it('keeps approximations (and a non-zero omitted count) in a clean answer, which stays clean', () => {
    expect(
      compactCoverage({ ...CLEAN, approximations: ['c:parsed-as-cpp'] }),
    ).toEqual({
      clean: true,
      analyzed: 12,
      approximations: ['c:parsed-as-cpp'],
    });
    expect(
      compactCoverage({
        ...CLEAN,
        approximations: ['text-scan', 'case-folded', 'c:parsed-as-cpp'],
        approximationsOmitted: 2,
      }),
    ).toEqual({
      clean: true,
      analyzed: 12,
      approximations: ['text-scan', 'case-folded', 'c:parsed-as-cpp'],
      approximationsOmitted: 2,
    });
    expect(
      compactCoverage({
        ...CLEAN,
        approximations: [],
        approximationsOmitted: 0,
      }),
    ).toEqual({ clean: true, analyzed: 12 });
  });

  it('writes a clean answer as {clean: true, analyzed} and nothing else but its approximations', () => {
    expect(compactCoverage(CLEAN)).toEqual({ clean: true, analyzed: 12 });
    expect(Object.keys(compactCoverage(CLEAN))).toEqual(['clean', 'analyzed']);
    const busyButClean: CoverageFields = {
      ...CLEAN,
      state: 'current',
      nonSource: 250,
      excluded: null,
      resolution: {
        external: 40,
        unresolvedInternal: 0,
        truncatedImports: 0,
        edgeCapHit: false,
        context: 'complete',
      },
      approximations: ['text-scan'],
      checks: 'type-check',
    };
    // Only the approximation survives: it qualifies how, not whether, the
    // answer is complete (Batch 31 r1 R31-01; was dropped before).
    expect(compactCoverage(busyButClean)).toEqual({
      clean: true,
      analyzed: 12,
      approximations: ['text-scan'],
    });
    expect(compactCoverage({ ...CLEAN, analyzed: null })).toEqual({
      clean: true,
      analyzed: null,
    });
  });

  it('writes a qualified answer as verdict plus the non-zero buckets, in field order', () => {
    const compact = compactCoverage({
      ...CLEAN,
      failed: 2,
      failedByReason: { parse: 2, read: 0 },
      excluded: null,
    });
    expect(compact).toEqual({
      clean: false,
      reasons: ['failed'],
      analyzed: 12,
      failed: 2,
      excluded: null,
      failedByReason: { parse: 2 },
    });
    expect(Object.keys(compact)).toEqual([
      'clean',
      'reasons',
      'analyzed',
      'failed',
      'excluded',
      'failedByReason',
    ]);
  });

  it.each(COUNT_KEYS)('always keeps %s when it is null (unknown)', (key) => {
    const compact = compactCoverage({
      ...CLEAN,
      census: 'truncated',
      [key]: null,
    });
    expect(compact.clean).toBe(false);
    expect(compact).toHaveProperty(key, null);
  });

  it('lets a reader recover every count: left out = 0, null = unknown', () => {
    const fields: CoverageFields = {
      ...CLEAN,
      analyzed: 0,
      unchecked: null,
      failed: 3,
      unsupported: 0,
      unrecognised: null,
      nonSource: 7,
      excluded: 0,
      omittedByCap: 0,
    };
    const compact = compactCoverage(fields);
    for (const key of COUNT_KEYS) {
      const read = key in compact ? Reflect.get(compact, key) : 0;
      expect([key, read]).toEqual([key, fields[key]]);
    }
  });

  it('keeps supportedLanguages only when files were unsupported', () => {
    expect(compactCoverage({ ...CLEAN, failed: 1 })).not.toHaveProperty(
      'supportedLanguages',
    );
    expect(
      compactCoverage({
        ...CLEAN,
        unsupported: 3,
        unsupportedByLanguage: { python: 3 },
      }),
    ).toEqual({
      clean: false,
      reasons: ['unsupported'],
      supportedLanguages: ['typescript', 'javascript'],
      analyzed: 12,
      unsupported: 3,
      unsupportedByLanguage: { python: 3 },
    });
  });

  it('keeps census, censusLimit and state only off their clean values', () => {
    expect(
      compactCoverage({
        ...CLEAN,
        census: 'truncated',
        censusLimit: 50_000,
        state: 'updating',
      }),
    ).toEqual({
      clean: false,
      reasons: ['updating', 'truncated'],
      census: 'truncated',
      censusLimit: 50_000,
      state: 'updating',
      analyzed: 12,
    });
  });

  it('keeps only the non-clean part of resolution, nulls included', () => {
    const compact = compactCoverage({
      ...CLEAN,
      resolution: {
        external: 40,
        unresolvedInternal: null,
        truncatedImports: 0,
        edgeCapHit: false,
        context: 'partial',
      },
      approximations: ['resolver-context-partial'],
      approximationsOmitted: 0,
    });
    expect(compact).toEqual({
      clean: false,
      reasons: ['resolution?', 'resolver-context-partial'],
      analyzed: 12,
      resolution: {
        external: 40,
        unresolvedInternal: null,
        context: 'partial',
      },
      approximations: ['resolver-context-partial'],
    });
  });

  // Lane H merge, ruling R1: Batch 20.2q's sixth reason put the compact worst
  // case at 1,025 chars. Fails before the cap: all six reasons were named.
  it('names at most three failure reasons, largest first, and sums the rest into other', () => {
    expect(MAX_COMPACT_FAILURE_REASONS).toBe(3);
    const compact = compactCoverage({
      ...CLEAN,
      failed: 21,
      failedByReason: {
        read: 1,
        parse: 6,
        'grammar-unavailable': 0,
        'too-large': 2,
        timeout: 5,
        'unsupported-syntax': 7,
      },
    });
    expect(compact).toHaveProperty('failedByReason', {
      'unsupported-syntax': 7,
      parse: 6,
      timeout: 5,
      other: 3,
    });
  });

  it('keeps up to three non-zero reasons as they are, with no other key', () => {
    const failedByReason = { parse: 2, timeout: 1, 'too-large': 4, read: 0 };
    expect(
      compactCoverage({ ...CLEAN, failed: 7, failedByReason }),
    ).toHaveProperty('failedByReason', {
      parse: 2,
      timeout: 1,
      'too-large': 4,
    });
  });

  it('breaks count ties in FAILURE_REASONS order and saturates other', () => {
    const max = COVERAGE_COUNT_MAX;
    const compact = compactCoverage({
      ...CLEAN,
      failed: max,
      failedByReason: Object.fromEntries(
        FAILURE_REASONS.map((reason) => [reason, max]),
      ),
    });
    expect(compact).toHaveProperty('failedByReason', {
      read: max,
      parse: max,
      'grammar-unavailable': max,
      other: max,
    });
  });

  it('leaves the full shape with every failure reason', () => {
    const failedByReason = Object.fromEntries(
      FAILURE_REASONS.map((reason) => [reason, 1]),
    );
    expect(
      withCoverageVerdict({ ...CLEAN, failed: 6, failedByReason })
        .failedByReason,
    ).toEqual(failedByReason);
  });

  it('agrees with isCleanAnswer and recomputes a stale verdict', () => {
    const stale = { ...withCoverageVerdict(CLEAN), failed: 1 };
    expect(compactCoverage(stale).clean).toBe(false);
    for (const fields of [
      CLEAN,
      { ...CLEAN, excluded: 1 },
      { ...CLEAN, unrecognised: null },
      { ...CLEAN, nonSource: null, excluded: null },
    ]) {
      expect(compactCoverage(fields).clean).toBe(isCleanAnswer(fields));
    }
  });
});

describe('limitApproximations', () => {
  it('omits both fields when nothing is approximate', () => {
    expect(limitApproximations([])).toEqual({});
  });

  it('keeps up to four without an omitted count', () => {
    expect(limitApproximations(['text-scan', 'case-folded'])).toEqual({
      approximations: ['text-scan', 'case-folded'],
    });
  });

  it('orders by the exported priority array and de-duplicates', () => {
    const input: Approximation[] = [
      'java:package-wildcard',
      'go:package-edges',
      'text-scan',
      'python:syntax-only',
      'resolver-context-partial',
      'text-scan',
    ];
    expect(limitApproximations(input)).toEqual({
      approximations: [
        'resolver-context-partial',
        'python:syntax-only',
        'text-scan',
        'go:package-edges',
      ],
      approximationsOmitted: 1,
    });
  });

  it('lets syntax-only languages fill the slots and discloses the rest', () => {
    const input: Approximation[] = [
      'case-folded',
      'rust:syntax-only',
      'go:syntax-only',
      'python:syntax-only',
      'csharp:syntax-only',
      'java:syntax-only',
    ];
    const result = limitApproximations(input);
    expect(result.approximations).toEqual([
      'csharp:syntax-only',
      'go:syntax-only',
      'java:syntax-only',
      'python:syntax-only',
    ]);
    expect(result.approximationsOmitted).toBe(2);
  });

  it('ranks every approximation kind in the priority array', () => {
    const everyKind: Approximation[] = APPROXIMATION_PRIORITY.map((kind) =>
      kind === 'syntax-only' ? 'python:syntax-only' : kind,
    );
    const result = limitApproximations([...everyKind].reverse());
    expect(result.approximations).toEqual(
      everyKind.slice(0, MAX_REPORTED_APPROXIMATIONS),
    );
    expect(result.approximationsOmitted).toBe(
      everyKind.length - MAX_REPORTED_APPROXIMATIONS,
    );
  });
});
