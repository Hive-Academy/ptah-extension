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
  isCleanAnswer,
  limitApproximations,
  type Approximation,
  type LanguageCoverage,
} from './language-coverage.interface';

const CLEAN: LanguageCoverage = {
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
