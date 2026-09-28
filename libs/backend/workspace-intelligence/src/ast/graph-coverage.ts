/**
 * Graph coverage accounting — what one dependency-graph build analysed, what
 * it could not, and how its imports resolved (TASK_2026_559
 * implementation-plan-languages.md, "Dependency graphs" → "Bounds" and
 * "Coverage contract" → "Multi-root merge").
 *
 * Pure helpers: `DependencyGraphService` selects the files it parses with
 * {@link selectGraphFiles}, tallies parse outcomes and import resolution while
 * it builds, and publishes {@link buildGraphCoverage}'s result together with
 * the graph. {@link mergeGraphCoverages} combines the coverage of several
 * roots.
 */
import * as path from 'path';
import {
  COVERAGE_COUNT_MAX,
  LANGUAGE_IDS,
  MAX_UNSUPPORTED_LANGUAGE_KEYS,
  limitApproximations,
  withCoverageVerdict,
  type Approximation,
  type Count,
  type CoverageCensus,
  type CoverageChecks,
  type CoverageResolution,
  type CoverageState,
  type FailureReason,
  type LanguageCoverage,
  type LanguageId,
  type RecognisedLanguageId,
} from '@ptah-extension/platform-core';
import {
  classifyFileForCoverage,
  languageForExtension,
  supportedLanguagesFor,
} from './language-registry';

/** Most graph-capable files one build parses (plan "Bounds": parse cap). */
export const GRAPH_PARSE_CAP = 5_000;

/** Most distinct edges one build links; past it linking stops (`edgeCapHit`). */
export const GRAPH_EDGE_CAP = 250_000;

/** Keys of `unsupportedByLanguage`. */
export type UnsupportedLanguageKey =
  LanguageId | RecognisedLanguageId | 'other';

type LanguageCounts = Partial<Record<UnsupportedLanguageKey, number>>;
type ReasonCounts = Partial<Record<FailureReason, number>>;

/** How {@link selectGraphFiles} split the files given to one build. */
export interface GraphFileSelection {
  /** Graph-capable files to parse, in the order they were given. */
  readonly selected: readonly string[];
  /** Graph-capable files dropped by the parse cap. */
  readonly omittedByCap: number;
  /** Recognised source files whose language has no graph edges. */
  readonly unsupported: number;
  /** Files no registry language claims (see `classifyFileForCoverage`). */
  readonly unrecognised: number;
  /** Documented non-source files. */
  readonly nonSource: number;
  /** `unsupported`, per language (top keys plus `other`; no zero counts). */
  readonly unsupportedByLanguage: Readonly<LanguageCounts>;
}

/** Per-import resolution tally of one build. */
export interface GraphResolutionCounts {
  /** Imports of a package or module outside the workspace. */
  readonly external: number;
  /** Imports meant for a workspace file that no graphed file matched. */
  readonly unresolvedInternal: number;
  /** Imports whose targets were cut at the per-import expansion limit. */
  readonly truncatedImports: number;
  /** The aggregate edge cap stopped linking. */
  readonly edgeCapHit: boolean;
  /**
   * `partial` when the resolver lacked context that could change an answer:
   * the build's `ResolverContext` could not read every manifest within its
   * bounds or found a mapping it does not model (workspace packages), or an
   * import was external only as far as that context knows (a TS/JS bare
   * specifier that is neither a builtin nor a declared package).
   */
  readonly context: 'complete' | 'partial';
  /**
   * Some import resolved only through a unique case-insensitive match (the
   * `case-folded` approximation). Absent: every edge matched exactly.
   */
  readonly caseFolded?: boolean;
  /**
   * Approximations of linked edges the resolvers declared (a Go import
   * linked to every file of its package: `go:package-edges`), each once.
   */
  readonly edgeApproximations?: readonly Approximation[];
}

/** Everything {@link buildGraphCoverage} needs about one build. */
export interface GraphCoverageInput {
  readonly selection: GraphFileSelection;
  /** Selected files parsed into graph nodes. */
  readonly analyzed: number;
  /** Selected files whose read or parse failed, by reason. */
  readonly failedByReason: Readonly<ReasonCounts>;
  readonly resolution: GraphResolutionCounts;
  /**
   * Files the caller discovered but dropped before handing its list to the
   * build (a caller-side file cap); counted as `omittedByCap`.
   */
  readonly omittedUpstream: number;
  /**
   * Set when the caller's discovery stopped at this many files, so files past
   * it were never observed: the census is `truncated`.
   */
  readonly censusLimit?: number;
  /**
   * Set when the caller's discovery could not read part of the tree: the
   * census is `unknown` (never clean), whatever `censusLimit` says.
   */
  readonly censusUnknown?: boolean;
}

function saturate(value: number): number {
  return Math.min(Math.max(value, 0), COVERAGE_COUNT_MAX);
}

/** Sum of counts, saturating at `COVERAGE_COUNT_MAX`; any `null` makes it `null`. */
export function saturatingSum(values: readonly Count[]): Count {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total = saturate(total + value);
  }
  return total;
}

function isLanguageId(key: UnsupportedLanguageKey): key is LanguageId {
  return (LANGUAGE_IDS as readonly string[]).includes(key);
}

function compareCodeUnits(a: string, b: string): number {
  // Code-unit order, not localeCompare: results must not vary by host locale.
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Keep the `MAX_UNSUPPORTED_LANGUAGE_KEYS` largest named counts (ties by key)
 * and fold the rest into `other`. Zero counts are dropped; values saturate.
 */
export function limitLanguageCounts(
  counts: Readonly<LanguageCounts>,
): LanguageCounts {
  const named = (Object.keys(counts) as UnsupportedLanguageKey[])
    .filter((key) => key !== 'other' && (counts[key] ?? 0) > 0)
    .sort(
      (a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || compareCodeUnits(a, b),
    );
  const limited: LanguageCounts = {};
  let other = counts.other ?? 0;
  named.forEach((key, index) => {
    if (index < MAX_UNSUPPORTED_LANGUAGE_KEYS) {
      limited[key] = saturate(counts[key] ?? 0);
    } else {
      other += counts[key] ?? 0;
    }
  });
  if (other > 0) limited.other = saturate(other);
  return limited;
}

/**
 * Split the files given to one build into the census buckets and choose the
 * graph-capable files to parse. A path listed twice (either separator) counts
 * once. When more than `cap` files are graph-capable, the cap is shared
 * round-robin across their languages — each language takes its files in
 * code-unit path order — so one large language cannot starve another; the
 * rest are `omittedByCap`. The selection keeps the order the files were given.
 */
export function selectGraphFiles(
  filePaths: readonly string[],
  cap: number = GRAPH_PARSE_CAP,
): GraphFileSelection {
  const seen = new Set<string>();
  const eligibleByLanguage = new Map<LanguageId, string[]>();
  const unsupportedByLanguage: LanguageCounts = {};
  let unsupported = 0;
  let unrecognised = 0;
  let nonSource = 0;
  let eligible = 0;

  for (const filePath of filePaths) {
    const normalized = filePath.replace(/\\/g, '/');
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const fileClass = classifyFileForCoverage(normalized, 'graphEdges');
    if (fileClass === 'unrecognised') {
      unrecognised++;
      continue;
    }
    if (fileClass === 'nonSource') {
      nonSource++;
      continue;
    }
    // Eligible and unsupported files always have a registry language.
    const language =
      languageForExtension(path.posix.extname(normalized)) ?? 'other';
    if (fileClass === 'unsupported' || !isLanguageId(language)) {
      unsupported++;
      unsupportedByLanguage[language] =
        (unsupportedByLanguage[language] ?? 0) + 1;
      continue;
    }
    eligible++;
    const group = eligibleByLanguage.get(language);
    if (group) group.push(normalized);
    else eligibleByLanguage.set(language, [normalized]);
  }

  const limit = Math.max(0, Math.floor(cap));
  const chosen = new Set<string>();
  const groups = LANGUAGE_IDS.flatMap((id) => {
    const group = eligibleByLanguage.get(id);
    return group ? [group.sort(compareCodeUnits)] : [];
  });
  for (let round = 0; chosen.size < Math.min(limit, eligible); round++) {
    for (const group of groups) {
      if (round < group.length) chosen.add(group[round]);
      if (chosen.size === limit) break;
    }
  }

  const selected: string[] = [];
  for (const filePath of filePaths) {
    const normalized = filePath.replace(/\\/g, '/');
    // delete: a duplicate entry is selected once.
    if (chosen.delete(normalized)) selected.push(filePath);
  }

  return {
    selected,
    omittedByCap: eligible - selected.length,
    unsupported,
    unrecognised,
    nonSource,
    unsupportedByLanguage: limitLanguageCounts(unsupportedByLanguage),
  };
}

function saturateReasons(reasons: Readonly<ReasonCounts>): ReasonCounts {
  const result: ReasonCounts = {};
  for (const reason of Object.keys(reasons) as FailureReason[]) {
    const count = reasons[reason] ?? 0;
    if (count > 0) result[reason] = saturate(count);
  }
  return result;
}

/**
 * The `LanguageCoverage` of one build. `excluded` is `null`: vendor and
 * generated trees are excluded inside the caller's discovery, so the graph
 * never observes them. `unchecked` is 0: the graph analyses every file it
 * selects.
 */
export function buildGraphCoverage(
  input: GraphCoverageInput,
): LanguageCoverage {
  const { selection, resolution } = input;
  const failedByReason = saturateReasons(input.failedByReason);
  const failed = saturatingSum(Object.values(failedByReason)) ?? 0;
  const approximations: Approximation[] = [
    ...(resolution.context === 'partial'
      ? (['resolver-context-partial'] as const)
      : []),
    ...(resolution.caseFolded === true ? (['case-folded'] as const) : []),
    ...(resolution.edgeApproximations ?? []),
  ];
  const truncated = input.censusLimit !== undefined;
  return withCoverageVerdict({
    supportedLanguages: supportedLanguagesFor('graphEdges'),
    census:
      input.censusUnknown === true
        ? 'unknown'
        : truncated
          ? 'truncated'
          : 'complete',
    ...(truncated ? { censusLimit: input.censusLimit } : {}),
    analyzed: saturate(input.analyzed),
    unchecked: 0,
    failed,
    unsupported: saturate(selection.unsupported),
    unrecognised: saturate(selection.unrecognised),
    nonSource: saturate(selection.nonSource),
    excluded: null,
    omittedByCap: saturate(selection.omittedByCap + input.omittedUpstream),
    ...(selection.unsupported > 0
      ? {
          unsupportedByLanguage: limitLanguageCounts(
            selection.unsupportedByLanguage,
          ),
        }
      : {}),
    ...(failed > 0 ? { failedByReason } : {}),
    resolution: {
      external: saturate(resolution.external),
      unresolvedInternal: saturate(resolution.unresolvedInternal),
      truncatedImports: saturate(resolution.truncatedImports),
      edgeCapHit: resolution.edgeCapHit,
      context: resolution.context,
    },
    ...limitApproximations(approximations),
  });
}

/**
 * Coverage after one file of a published graph was invalidated (its node and
 * edges removed): a file that was analysed moves to `unchecked`, and the
 * resolution context becomes `partial` because the graph no longer holds
 * that file's edges, nor the edges of files importing it. The file buckets
 * stay disjoint: a path that was not an analysed node changes no count.
 */
export function invalidatedCoverage(
  coverage: LanguageCoverage,
  wasAnalyzed: boolean,
): LanguageCoverage {
  const moved =
    wasAnalyzed && coverage.analyzed !== null && coverage.analyzed > 0;
  return withCoverageVerdict({
    ...coverage,
    ...(moved
      ? {
          analyzed: (coverage.analyzed as number) - 1,
          unchecked: saturatingSum([coverage.unchecked, 1]),
        }
      : {}),
    resolution: {
      external: coverage.resolution?.external ?? null,
      unresolvedInternal: coverage.resolution?.unresolvedInternal ?? null,
      truncatedImports: coverage.resolution?.truncatedImports ?? null,
      edgeCapHit: coverage.resolution?.edgeCapHit ?? false,
      context: 'partial',
    },
  });
}

/**
 * Coverage of a graph whose root's real path could not be resolved (the
 * lookup failed, e.g. EIO): an edit named through a link alias of the root
 * may never reach the graph, so how many analysed files are stale is
 * unknown. `unchecked` becomes `null`, which is never clean (`unchecked?`).
 */
export function identityUnavailableCoverage(
  coverage: LanguageCoverage,
): LanguageCoverage {
  return withCoverageVerdict({ ...coverage, unchecked: null });
}

const CENSUS_RANK: Readonly<Record<CoverageCensus, number>> = {
  complete: 0,
  truncated: 1,
  unknown: 2,
};
const STATE_RANK: Readonly<Record<CoverageState, number>> = {
  current: 0,
  updating: 1,
  incomplete: 2,
};

function worst<T extends string>(
  values: readonly (T | undefined)[],
  rank: Readonly<Record<T, number>>,
): T | undefined {
  let result: T | undefined;
  for (const value of values) {
    if (
      value !== undefined &&
      (result === undefined || rank[value] > rank[result])
    ) {
      result = value;
    }
  }
  return result;
}

function sumKeyed<K extends string>(
  records: readonly (Readonly<Partial<Record<K, number>>> | undefined)[],
): Partial<Record<K, number>> | undefined {
  let total: Partial<Record<K, number>> | undefined;
  for (const record of records) {
    if (record === undefined) continue;
    total ??= {};
    for (const key of Object.keys(record) as K[]) {
      total[key] = saturate((total[key] ?? 0) + (record[key] ?? 0));
    }
  }
  return total;
}

/**
 * A root without `resolution` contributes unknown counts (`null`) and a
 * partial context, so a merged answer never reads cleaner than its roots.
 */
function mergeResolution(
  coverages: readonly LanguageCoverage[],
): CoverageResolution | undefined {
  if (coverages.every((coverage) => coverage.resolution === undefined)) {
    return undefined;
  }
  const parts = coverages.map((coverage) => coverage.resolution);
  return {
    external: saturatingSum(parts.map((part) => part?.external ?? null)),
    unresolvedInternal: saturatingSum(
      parts.map((part) => part?.unresolvedInternal ?? null),
    ),
    truncatedImports: saturatingSum(
      parts.map((part) => part?.truncatedImports ?? null),
    ),
    edgeCapHit: parts.some((part) => part?.edgeCapHit === true),
    context: parts.every((part) => part?.context === 'complete')
      ? 'complete'
      : 'partial',
  };
}

function mergeChecks(
  coverages: readonly LanguageCoverage[],
): CoverageChecks | undefined {
  const kinds = new Set(
    coverages.flatMap((coverage) => (coverage.checks ? [coverage.checks] : [])),
  );
  if (kinds.size === 0) return undefined;
  return kinds.size === 1 ? [...kinds][0] : 'mixed';
}

/**
 * Multi-root merge: counts are summed, saturating, and any `null` makes the
 * sum `null`; `census` and `state` take the worst value; `supportedLanguages`
 * and `approximations` are unions (approximations under the priority rule,
 * with every root's undisclosed count carried over); `edgeCapHit` is an OR
 * and `context` is `partial` when any root's is. `undefined` for no roots.
 */
export function mergeGraphCoverages(
  coverages: readonly LanguageCoverage[],
): LanguageCoverage | undefined {
  if (coverages.length === 0) return undefined;
  if (coverages.length === 1) return coverages[0];

  const supported = new Set(
    coverages.flatMap((coverage) => coverage.supportedLanguages),
  );
  const census =
    worst(
      coverages.map((coverage) => coverage.census),
      CENSUS_RANK,
    ) ?? 'unknown';
  const limits = coverages.flatMap((coverage) =>
    coverage.censusLimit === undefined ? [] : [coverage.censusLimit],
  );
  const state = worst(
    coverages.map((coverage) => coverage.state),
    STATE_RANK,
  );
  const sum = (pick: (coverage: LanguageCoverage) => Count): Count =>
    saturatingSum(coverages.map(pick));
  const unsupportedByLanguage = sumKeyed(
    coverages.map((coverage) => coverage.unsupportedByLanguage),
  );
  const failedByReason = sumKeyed(
    coverages.map((coverage) => coverage.failedByReason),
  );
  const resolution = mergeResolution(coverages);
  const approximations = limitApproximations(
    coverages.flatMap((coverage) => coverage.approximations ?? []),
  );
  const carriedOmitted = coverages.reduce(
    (total, coverage) => total + (coverage.approximationsOmitted ?? 0),
    0,
  );
  const omitted = saturate(
    (approximations.approximationsOmitted ?? 0) + carriedOmitted,
  );
  const checks = mergeChecks(coverages);

  return withCoverageVerdict({
    supportedLanguages: LANGUAGE_IDS.filter((id) => supported.has(id)),
    census,
    ...(limits.length > 0 ? { censusLimit: Math.max(...limits) } : {}),
    ...(state === undefined ? {} : { state }),
    analyzed: sum((coverage) => coverage.analyzed),
    unchecked: sum((coverage) => coverage.unchecked),
    failed: sum((coverage) => coverage.failed),
    unsupported: sum((coverage) => coverage.unsupported),
    unrecognised: sum((coverage) => coverage.unrecognised),
    nonSource: sum((coverage) => coverage.nonSource),
    excluded: sum((coverage) => coverage.excluded),
    omittedByCap: sum((coverage) => coverage.omittedByCap),
    ...(unsupportedByLanguage === undefined
      ? {}
      : { unsupportedByLanguage: limitLanguageCounts(unsupportedByLanguage) }),
    ...(failedByReason === undefined ? {} : { failedByReason }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(approximations.approximations === undefined
      ? {}
      : { approximations: approximations.approximations }),
    ...(omitted > 0 ? { approximationsOmitted: omitted } : {}),
    ...(checks === undefined ? {} : { checks }),
  });
}
