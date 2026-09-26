/**
 * LanguageCoverage — what a language-bound tool analysed, and what it did not.
 *
 * Every language-bound MCP tool (dependency graph, symbol index, code index,
 * AST, diagnostics, LSP) attaches one of these to its answer so an agent can
 * tell "checked and found nothing" apart from "could not check". A tool that
 * cannot analyse a file must never present an empty list as a complete answer.
 *
 * Shape rules (TASK_2026_559 implementation-plan-languages.md, "Coverage
 * contract"):
 * - The buckets `analyzed`, `unchecked`, `failed`, `unsupported`,
 *   `unrecognised`, `nonSource`, `excluded` and `omittedByCap` are DISJOINT
 *   FILE COUNTS: a file in the call's scope lands in exactly one, so no file
 *   can disappear between "recognised" and "analysed". Import resolution is
 *   counted separately, per import, in `resolution`.
 * - A count the source cannot know is `null`, never a guessed 0.
 * - Counts saturate at {@link COVERAGE_COUNT_MAX} so the serialised object stays
 *   bounded: the enumerated worst case, verdict included, measures 1,000
 *   characters and is asserted at most 1,000 (`language-registry.spec.ts`
 *   in workspace-intelligence). A count equal to {@link COVERAGE_COUNT_MAX}
 *   means "at least this many".
 * - Every coverage a tool returns goes through {@link withCoverageVerdict}:
 *   `clean` and `reasons` come first, so the verdict survives reduction.
 * - Responses place `coverage` after the Batch 9 status fields (`count`,
 *   `incomplete`, `graphedFiles`, `discoveredFiles`) and before `file`, lists
 *   and hits, so a budget cut never drops it.
 *
 * Type-only apart from the closed-vocabulary constants and pure helpers
 * (`isCleanAnswer`, `coverageReasons`, `withCoverageVerdict`,
 * `limitApproximations`): platform-core is
 * `scope:shared,type:util`.
 */

/** A file count, or `null` when this source cannot know it. */
export type Count = number | null;

/**
 * Languages Ptah can hold a capability for. `c` is deliberately absent:
 * `.c`/`.h` files are parsed by the C++ grammar and reported as `cpp` with the
 * `c:parsed-as-cpp` approximation (User Decision 19).
 */
export const LANGUAGE_IDS = [
  'typescript',
  'javascript',
  'tsx',
  'python',
  'go',
  'csharp',
  'java',
  'kotlin',
  'rust',
  'php',
  'ruby',
  'cpp',
] as const;
export type LanguageId = (typeof LANGUAGE_IDS)[number];

/**
 * Source languages Ptah recognises but holds no capability for. They are the
 * extra keys allowed in `unsupportedByLanguage`; everything else is `other`.
 */
export const RECOGNISED_LANGUAGE_IDS = [
  'swift',
  'scala',
  'dart',
  'elixir',
  'lua',
  'haskell',
  'clojure',
  'objc',
  'r',
] as const;
export type RecognisedLanguageId = (typeof RECOGNISED_LANGUAGE_IDS)[number];

/** Why a supported file failed analysis (keys of `failedByReason`). */
export const FAILURE_REASONS = [
  'read',
  'parse',
  'grammar-unavailable',
  'too-large',
  'timeout',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

/**
 * Approximation kinds, highest priority first. `syntax-only` stands for the
 * per-language `<id>:syntax-only` family; every other entry is a literal
 * approximation. This array alone drives the overflow rule in
 * {@link limitApproximations}.
 */
export const APPROXIMATION_PRIORITY = [
  'resolver-context-partial',
  'syntax-only',
  'text-scan',
  'case-folded',
  'c:parsed-as-cpp',
  'go:package-edges',
  'csharp:namespace-edges',
  'java:package-wildcard',
] as const;

/** A disclosed approximation the answer rests on. */
export type Approximation =
  | Exclude<(typeof APPROXIMATION_PRIORITY)[number], 'syntax-only'>
  | `${LanguageId}:syntax-only`;

/** At most this many approximations are reported; the rest are counted. */
export const MAX_REPORTED_APPROXIMATIONS = 4;

/** `unsupportedByLanguage` carries at most this many named keys, plus `other`. */
export const MAX_UNSUPPORTED_LANGUAGE_KEYS = 8;

/**
 * Every count in a coverage object saturates here (multi-root sums too); a
 * count equal to it means "this many or more". 999,999 since Batch 24r (was
 * 9,999,999): the verdict needs the room within the 1,000-char bound.
 */
export const COVERAGE_COUNT_MAX = 999_999;

export type CoverageCensus = 'complete' | 'truncated' | 'unknown';

/** Live state of the code index (see Batch 24b); absent for other tools. */
export type CoverageState = 'current' | 'updating' | 'incomplete';

/** What kind of check a diagnostics answer made. */
export type CoverageChecks =
  'type-check' | 'syntax-only' | 'mixed' | 'provider-defined';

/** Per-import resolution accounting; graph tools only. */
export interface CoverageResolution {
  readonly external: Count;
  readonly unresolvedInternal: Count;
  readonly truncatedImports: Count;
  readonly edgeCapHit: boolean;
  readonly context: 'complete' | 'partial';
}

/**
 * The fields a producer measures. {@link withCoverageVerdict} turns them into
 * a {@link LanguageCoverage} by adding the verdict (`clean`, `reasons`).
 */
export interface CoverageFields {
  /** Capability claim of this tool on this host. */
  readonly supportedLanguages: readonly LanguageId[];
  readonly census: CoverageCensus;
  readonly censusLimit?: number;
  /** Code index only. */
  readonly state?: CoverageState;
  /** Analysed successfully. */
  readonly analyzed: Count;
  /** Supported, but this call did not analyse it (e.g. an unscoped syntax check). */
  readonly unchecked: Count;
  /** Supported, analysis failed. */
  readonly failed: Count;
  /**
   * Recognised source file this call cannot analyse: its language lacks the
   * capability, or its extension is a recognition-only variant of a supported
   * language (e.g. `.mjs` before the parser accepts it).
   */
  readonly unsupported: Count;
  /**
   * In scope, not documented non-source, and no registry language claims it:
   * code we cannot even name (`.zig`, `.vue`, `.sh`, `Dockerfile`) or an
   * unknown extension. Unknown defaults here, never to `nonSource`. A tool
   * that performs a census always sets a number; `null` means files were
   * not enumerated, so the answer is never clean.
   */
  readonly unrecognised: Count;
  /**
   * Documented non-source files (docs, data, config, lockfiles, media,
   * binaries; the workspace-intelligence registry's closed list). Out of a
   * code tool's reach by nature, so this count never qualifies an answer.
   */
  readonly nonSource: Count;
  /** Vendor/generated; `null` when excluded inside discovery (not observed). */
  readonly excluded: Count;
  /** Eligible, dropped by a file or request limit. */
  readonly omittedByCap: Count;
  /** Top {@link MAX_UNSUPPORTED_LANGUAGE_KEYS} languages plus `other`. */
  readonly unsupportedByLanguage?: Readonly<
    Partial<Record<LanguageId | RecognisedLanguageId | 'other', number>>
  >;
  readonly failedByReason?: Readonly<Partial<Record<FailureReason, number>>>;
  readonly resolution?: CoverageResolution;
  /** At most {@link MAX_REPORTED_APPROXIMATIONS}, by priority. */
  readonly approximations?: readonly Approximation[];
  /** How many approximations applied but were not listed. */
  readonly approximationsOmitted?: number;
  readonly checks?: CoverageChecks;
}

/**
 * Why a coverage object is not clean, one code per failed condition of the
 * clean answer rule, highest priority first. A code ending in `?` names a
 * count (or the census) the source could not know (`null`); unknowns come
 * before every observed qualifier, because an unknown is the one qualifier a
 * reader can miss. `stale` is the `incomplete` state. Codes are short on
 * purpose: the worst-case coverage, verdict included, must stay within
 * 1,000 characters.
 */
export const COVERAGE_REASONS = [
  'census?',
  'updating',
  'stale',
  'truncated',
  'unchecked?',
  'failed?',
  'unsupported?',
  'unrecognised?',
  'omitted?',
  'resolution?',
  'unchecked',
  'failed',
  'unsupported',
  'unrecognised',
  'omitted-by-cap',
  'excluded',
  'unresolved-internal',
  'truncated-imports',
  'edge-cap-hit',
  'resolver-context-partial',
] as const;
export type CoverageReason = (typeof COVERAGE_REASONS)[number];

/**
 * At most this many reasons are listed. The rest stay readable in the
 * fields themselves; the list only says, bounded, why the answer is not clean.
 */
export const MAX_REPORTED_REASONS = 3;

/**
 * What a language-bound tool analysed, and whether its answer may be read as
 * clean. `clean` and `reasons` come first in the serialised object, so a
 * reader (or a budget cut) meets the verdict before the counts.
 */
export interface LanguageCoverage extends CoverageFields {
  /** {@link isCleanAnswer} of the fields. */
  readonly clean: boolean;
  /** The first {@link MAX_REPORTED_REASONS} {@link coverageReasons}; empty when clean. */
  readonly reasons: readonly CoverageReason[];
}

/**
 * Single-file answer for a language that lacks the requested capability. A
 * success, not an error — except where a tool keeps its own honest contract
 * (`ptah_ast_analyze` errors; enrich returns full content with a reason).
 */
export interface UnsupportedLanguageAnswer {
  readonly status: 'unsupported-language';
  readonly language: string;
  readonly supportedLanguages: readonly LanguageId[];
  readonly message: string;
}

/**
 * Clean answer rule: a tool may present a bare clean or complete answer ("No
 * issues found", "no dependents") only when every condition holds.
 *
 * 1. `census` is `'complete'` (an `unknown` census is never clean);
 * 2. `unchecked`, `failed`, `unsupported`, `unrecognised` and `omittedByCap`
 *    are all exactly 0 (`null` is not 0: unknown never reads as clean;
 *    `analyzed` may be `null`; `nonSource` never qualifies);
 * 3. `excluded` is 0 or `null`;
 * 4. `resolution`, when present, has `unresolvedInternal` 0, `truncatedImports`
 *    0, `edgeCapHit` false and `context` `'complete'`;
 * 5. `state` is absent or `'current'`.
 *
 * Anything else is a qualified answer that must name its qualifier.
 */
export function isCleanAnswer(coverage: CoverageFields): boolean {
  return coverageReasons(coverage).length === 0;
}

/** Codes for one count: unknown () or observed (above 0). */
function countReason<
  Unknown extends CoverageReason,
  Seen extends CoverageReason,
>(count: Count, unknown: Unknown, seen: Seen): Unknown | Seen | undefined {
  if (count === null) return unknown;
  return count !== 0 ? seen : undefined;
}

/**
 * Every condition of the clean answer rule the fields fail, as codes in
 * {@link COVERAGE_REASONS} order. Empty exactly when the answer is clean.
 */
export function coverageReasons(coverage: CoverageFields): CoverageReason[] {
  const found = new Set<CoverageReason>();
  const add = (reason: CoverageReason | undefined): void => {
    if (reason !== undefined) found.add(reason);
  };
  if (coverage.census === 'unknown') add('census?');
  if (coverage.census === 'truncated') add('truncated');
  if (coverage.state === 'updating') add('updating');
  if (coverage.state === 'incomplete') add('stale');
  add(countReason(coverage.unchecked, 'unchecked?', 'unchecked'));
  add(countReason(coverage.failed, 'failed?', 'failed'));
  add(countReason(coverage.unsupported, 'unsupported?', 'unsupported'));
  add(countReason(coverage.unrecognised, 'unrecognised?', 'unrecognised'));
  add(countReason(coverage.omittedByCap, 'omitted?', 'omitted-by-cap'));
  // `excluded: null` is allowed: exclusion inside discovery is not observed.
  if (coverage.excluded !== null && coverage.excluded !== 0) add('excluded');
  const resolution = coverage.resolution;
  if (resolution !== undefined) {
    add(
      countReason(
        resolution.unresolvedInternal,
        'resolution?',
        'unresolved-internal',
      ),
    );
    add(
      countReason(
        resolution.truncatedImports,
        'resolution?',
        'truncated-imports',
      ),
    );
    if (resolution.edgeCapHit) add('edge-cap-hit');
    if (resolution.context !== 'complete') add('resolver-context-partial');
  }
  return COVERAGE_REASONS.filter((reason) => found.has(reason));
}

/**
 * The coverage a tool returns: the verdict first (`clean`, then at most
 * {@link MAX_REPORTED_REASONS} `reasons`), then the fields. A verdict already
 * present on the input is recomputed, so a merged or edited coverage never
 * carries a stale one.
 */
export function withCoverageVerdict(
  coverage: CoverageFields | LanguageCoverage,
): LanguageCoverage {
  const {
    clean: _staleClean,
    reasons: _staleReasons,
    ...fields
  }: CoverageFields &
    Partial<Pick<LanguageCoverage, 'clean' | 'reasons'>> = coverage;
  const reasons = coverageReasons(fields);
  return {
    clean: reasons.length === 0,
    reasons: reasons.slice(0, MAX_REPORTED_REASONS),
    ...fields,
  };
}

function approximationRank(approximation: Approximation): number {
  const kind = approximation.endsWith(':syntax-only')
    ? 'syntax-only'
    : approximation;
  return APPROXIMATION_PRIORITY.findIndex((entry) => entry === kind);
}

function compareApproximations(a: Approximation, b: Approximation): number {
  const byRank = approximationRank(a) - approximationRank(b);
  if (byRank !== 0) {
    return byRank;
  }
  // Code-unit order, not localeCompare: the result must not vary by host locale.
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Overflow rule: de-duplicate, keep the {@link MAX_REPORTED_APPROXIMATIONS}
 * highest-priority approximations (ties in the `<id>:syntax-only` family break
 * alphabetically, so the result is deterministic) and disclose the rest as a
 * count. Not every per-language qualifier survives: more than four syntax-only
 * languages can fill the four slots. No approximations yields `{}`, so an
 * exact answer carries neither field.
 */
export function limitApproximations(
  approximations: readonly Approximation[],
): Pick<CoverageFields, 'approximations' | 'approximationsOmitted'> {
  const unique = [...new Set(approximations)].sort(compareApproximations);
  if (unique.length === 0) {
    return {};
  }
  const kept = unique.slice(0, MAX_REPORTED_APPROXIMATIONS);
  const omitted = unique.length - kept.length;
  return omitted > 0
    ? { approximations: kept, approximationsOmitted: omitted }
    : { approximations: kept };
}
