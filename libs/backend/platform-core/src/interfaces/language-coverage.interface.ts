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
 *   bounded (measured worst case under 1,000 characters, pinned by
 *   `language-registry.spec.ts` in workspace-intelligence).
 * - Responses place `coverage` after the Batch 9 status fields (`count`,
 *   `incomplete`, `graphedFiles`, `discoveredFiles`) and before `file`, lists
 *   and hits, so a budget cut never drops it.
 *
 * Type-only apart from the closed-vocabulary constants and two pure helpers
 * (`isCleanAnswer`, `limitApproximations`): platform-core is
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

/**
 * Why a supported file failed analysis (keys of `failedByReason`).
 * `unsupported-syntax`: the file parsed, but it uses a form the extractor
 * cannot represent (e.g. `exports[key] = v`), so the answer may be incomplete.
 */
export const FAILURE_REASONS = [
  'read',
  'parse',
  'grammar-unavailable',
  'too-large',
  'timeout',
  'unsupported-syntax',
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

/** Every count in a coverage object saturates here (multi-root sums too). */
export const COVERAGE_COUNT_MAX = 9_999_999;

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

export interface LanguageCoverage {
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
export function isCleanAnswer(coverage: LanguageCoverage): boolean {
  if (coverage.census !== 'complete') {
    return false;
  }
  if (
    coverage.unchecked !== 0 ||
    coverage.failed !== 0 ||
    coverage.unsupported !== 0 ||
    coverage.unrecognised !== 0 ||
    coverage.omittedByCap !== 0
  ) {
    return false;
  }
  if (coverage.excluded !== 0 && coverage.excluded !== null) {
    return false;
  }
  const resolution = coverage.resolution;
  if (
    resolution !== undefined &&
    (resolution.unresolvedInternal !== 0 ||
      resolution.truncatedImports !== 0 ||
      resolution.edgeCapHit ||
      resolution.context !== 'complete')
  ) {
    return false;
  }
  return coverage.state === undefined || coverage.state === 'current';
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
): Pick<LanguageCoverage, 'approximations' | 'approximationsOmitted'> {
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
