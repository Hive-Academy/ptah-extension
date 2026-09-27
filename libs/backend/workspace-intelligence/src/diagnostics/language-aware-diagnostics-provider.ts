/**
 * LanguageAwareDiagnosticsProvider — the Electron/CLI diagnostics provider
 * that answers for every language, not only TypeScript (TASK_2026_559 Batch
 * 25a, implementation-plan-languages.md "Diagnostics").
 *
 * It wraps the TypeScript compiler provider and never replaces it: TS/JS
 * files still go to that provider, with its scoped/unscoped worker lanes, its
 * cache and its 45 s budget untouched (Batches 1 and 19). Around it, it adds
 * what the TypeScript provider cannot say:
 *
 * - **Scoped call.** Requested TS/JS files are type-checked by the inner
 *   provider. Requested files of a language with a `syntaxDiagnostics`
 *   capability (Python, Go, C# today) get a syntax-only check with the
 *   bundled tree-sitter grammar: at most {@link SYNTAX_FILE_CAP} files per
 *   call (the rest `omittedByCap`), at most {@link SYNTAX_MAX_BYTES} per
 *   file, at most {@link SYNTAX_MAX_ERRORS} errors listed per file. Every
 *   other requested file is `unsupported` (or `unrecognised`) and named in
 *   `notChecked`.
 * - **Unscoped call.** The inner provider type-checks the workspace; nothing
 *   is syntax-checked (that would be a parse of every file). A census counts
 *   what was not checked: syntax-capable files are `unchecked` with the hint
 *   to pass `files`, other recognised languages `unsupported`.
 * - **Tier 0.** Nothing is spawned: the syntax check is an in-process parse
 *   (User Decision 19; `go vet` is a separate opt-in, Batch 37).
 *
 * Every answer carries `coverage` (Batch 22 contract, verdict first) and,
 * when files went unchecked, `notChecked`. A syntax-only check is never a
 * type-check claim: `checks` is `'syntax-only'` or `'mixed'` and each such
 * language is named `<id>:syntax-only` in `approximations` (the Batch 25a
 * floor-rule amendment in `diagnostics-provider.interface.ts`).
 *
 * The census for an unscoped call comes from one bounded discovery per root
 * ({@link CENSUS_LIMIT} files, vendor trees excluded inside the walk), shared
 * while it runs, cached for {@link CENSUS_TTL_MS} after it settles and
 * dropped by {@link invalidate}. It is not read
 * from the dependency graph's coverage: that report keys unsupported files
 * by language, not by extension, and folds all but eight languages into
 * `other`, so it cannot tell a `.py` file (syntax-checkable) from a `.pyi`
 * one (not) — a count built on it would be a guess.
 */

import * as path from 'path';
import {
  COVERAGE_COUNT_MAX,
  LANGUAGE_IDS,
  MAX_NOT_CHECKED_FILES_LISTED,
  isPathWithinRoots,
  limitApproximations,
  withCoverageVerdict,
} from '@ptah-extension/platform-core';
import type {
  Approximation,
  CoverageCensus,
  CoverageChecks,
  CoverageFields,
  DiagnosticEntry,
  DiagnosticsResult,
  DiagnosticsScope,
  FailureReason,
  FileDiagnostics,
  IDiagnosticsProvider,
  IFileSystemProvider,
  LanguageCoverage,
  LanguageId,
  NotCheckedFiles,
  RecognisedLanguageId,
} from '@ptah-extension/platform-core';
import { DEFAULT_WORKSPACE_EXCLUDES } from '../file-indexing/workspace-default-excludes';
import {
  LANGUAGE_REGISTRY,
  classifyFileForCoverage,
  hasCapability,
  languageForExtension,
  recognisedSourceExtensions,
} from '../ast/language-registry';
import { limitLanguageCounts } from '../ast/graph-coverage';
import { graphPathIdentity } from '../ast/dependency-graph.service';
import {
  EXTENSION_LANGUAGE_MAP,
  type SupportedLanguage,
} from '../ast/tree-sitter.config';
import type { TreeSitterParserService } from '../ast/tree-sitter-parser.service';

/** Most files one scoped call syntax-checks; file 51 on is `omittedByCap`. */
export const SYNTAX_FILE_CAP = 50;

/** Largest file the syntax check parses (1 MiB); larger is `too-large`. */
export const SYNTAX_MAX_BYTES = 1024 * 1024;

/** Most syntax errors (ERROR or MISSING nodes) listed for one file. */
export const SYNTAX_MAX_ERRORS = 20;

/** Most files one census lists; past it the census is `truncated`. */
export const CENSUS_LIMIT = 50_000;

/** How long a root's census is reused before it is taken again. */
const CENSUS_TTL_MS = 60_000;

/** Roots whose census is kept, least recently used evicted. */
const CENSUS_CACHE_MAX_ROOTS = 8;

/**
 * Most roots holding their own invalidation generation. Past it, the root
 * records roll over into one global generation (see `invalidate`).
 */
export const ROOT_GENERATIONS_MAX = 256;

/**
 * Longest an answer waits for the census. Past it the coverage says
 * `census: 'unknown'` (never clean) and the discovery keeps running, so the
 * next call reads its result. The type check keeps its own 45 s budget.
 */
const CENSUS_BUDGET_MS = 10_000;

/** Source of an answer made only by the syntax check. */
const SYNTAX_SOURCE = 'tree-sitter-syntax';

/**
 * Vendored and generated trees the census excludes inside its walk, the same
 * list graph discovery uses (`GRAPH_VENDOR_EXCLUDES` in vscode-lm-tools
 * `analysis-namespace.builders.ts`, which this lib cannot import). Excluded
 * inside discovery, they are never observed: the coverage reports
 * `excluded: null`.
 */
const CENSUS_VENDOR_EXCLUDES: readonly string[] = [
  '**/.venv/**',
  '**/venv/**',
  '**/site-packages/**',
  '**/__pycache__/**',
  '**/vendor/**',
  '**/obj/**',
  '**/bin/**',
  '**/.gradle/**',
  '**/Pods/**',
];

/** Languages whose files the inner TypeScript compiler provider checks. */
const TYPE_CHECKED_LANGUAGES: ReadonlySet<string> = new Set<LanguageId>([
  'typescript',
  'javascript',
  'tsx',
]);

/** The `supportedLanguages` claim of this provider, in `LANGUAGE_IDS` order. */
const DIAGNOSTICS_LANGUAGES: readonly LanguageId[] = LANGUAGE_IDS.filter(
  (id) =>
    (TYPE_CHECKED_LANGUAGES.has(id) &&
      LANGUAGE_REGISTRY[id].extensions.length > 0) ||
    hasCapability(id, 'syntaxDiagnostics'),
);

/** `ts` → `[tT][sS]`: every extension letter in either case (graph discovery rule). */
function anyCaseExtensionPattern(extension: string): string {
  return [...extension]
    .map((char) =>
      char.toLowerCase() === char.toUpperCase()
        ? `[${char}]`
        : `[${char.toLowerCase()}${char.toUpperCase()}]`,
    )
    .join('');
}

/** Every recognised source extension, any case: what a census must count. */
const CENSUS_GLOB = `**/*.{${recognisedSourceExtensions()
  .map((extension) => anyCaseExtensionPattern(extension.slice(1)))
  .join(',')}}`;

/** The parser calls the syntax check needs. */
export type SyntaxParser = Pick<
  TreeSitterParserService,
  'initialize' | 'queryMulti'
>;

/** Where one file lands for diagnostics. */
type DiagnosticsFileClass =
  | { readonly kind: 'type-check'; readonly language: LanguageId }
  | { readonly kind: 'syntax'; readonly language: SupportedLanguage }
  | {
      readonly kind: 'unsupported';
      readonly language: LanguageId | RecognisedLanguageId;
    }
  | { readonly kind: 'unrecognised' }
  | { readonly kind: 'nonSource' };

function isTypeChecked(
  language: LanguageId | RecognisedLanguageId | null,
): language is LanguageId {
  return language !== null && TYPE_CHECKED_LANGUAGES.has(language);
}

function classifyForDiagnostics(filePath: string): DiagnosticsFileClass {
  const extension = path.extname(filePath).toLowerCase();
  const language = languageForExtension(extension);
  if (isTypeChecked(language)) {
    return { kind: 'type-check', language };
  }
  const fileClass = classifyFileForCoverage(filePath, 'syntaxDiagnostics');
  if (fileClass === 'eligible') {
    return { kind: 'syntax', language: EXTENSION_LANGUAGE_MAP[extension] };
  }
  if (fileClass === 'unsupported' && language !== null) {
    return { kind: 'unsupported', language };
  }
  return fileClass === 'nonSource'
    ? { kind: 'nonSource' }
    : { kind: 'unrecognised' };
}

function saturate(count: number): number {
  return Math.min(count, COVERAGE_COUNT_MAX);
}

/** What one census of a root found, by diagnostics class. */
interface Census {
  readonly census: CoverageCensus;
  /** Files the TypeScript compiler provider checks, by language. */
  readonly typeChecked: ReadonlyMap<string, number>;
  /** Syntax-capable files by language. */
  readonly syntax: ReadonlyMap<string, number>;
  /** Recognised files no check covers, by language. */
  readonly unsupported: ReadonlyMap<string, number>;
}

/** Nothing counted: every map is empty and the coverage counts are `null`. */
const UNKNOWN_CENSUS: Census = {
  census: 'unknown',
  typeChecked: new Map(),
  syntax: new Map(),
  unsupported: new Map(),
};

/** A settled census, reused until {@link CENSUS_TTL_MS} after it settled. */
interface CachedCensus {
  readonly settledAt: number;
  readonly census: Census;
  /** The root's census generation its walk started under. */
  readonly generation: number;
}

/** A discovery still running, shared by every caller until it settles. */
interface PendingCensus {
  readonly census: Promise<Census>;
  /** The root's census generation it started under. */
  readonly generation: number;
}

/** A census with the generation it is valid for. */
interface ObtainedCensus {
  readonly census: Census;
  readonly generation: number;
}

/** One file the syntax check could not check, and why. */
interface SyntaxFailure {
  readonly file: string;
  readonly language: SupportedLanguage;
  readonly reason: FailureReason;
}

/** What the syntax check of one scoped call produced. */
interface SyntaxOutcome {
  readonly diagnostics: FileDiagnostics[];
  /** Files checked, by language. */
  readonly analyzed: Map<SupportedLanguage, number>;
  readonly failures: SyntaxFailure[];
  readonly errors: number;
}

const FAILURE_TEXT: Readonly<Record<FailureReason, string>> = {
  read: 'Could not be read, so no syntax check ran.',
  parse: 'The parser failed on it, so no syntax check ran.',
  'grammar-unavailable':
    'The grammar did not load on this host, so no syntax check ran.',
  'too-large': `Larger than ${SYNTAX_MAX_BYTES / (1024 * 1024)} MiB; the syntax check skips it.`,
  timeout: 'The syntax check ran out of time.',
};

const UNSCOPED_SYNTAX_TEXT =
  'The syntax check runs only on requested files: pass `files` to check them.';

const OMITTED_TEXT = `The syntax check covers at most ${SYNTAX_FILE_CAP} files per call: request these in another call.`;

const UNRECOGNISED_TEXT = 'No language Ptah recognises, so it was not checked.';

function unsupportedText(language: string): string {
  return `No diagnostics for ${language} on this host (no type check and no syntax check).`;
}

/** `notChecked`, as one sentence per group for a reason string. */
function describeNotChecked(groups: readonly NotCheckedFiles[]): string {
  if (groups.length === 0) return '';
  return (
    'Not checked: ' +
    groups
      .map(
        (group) =>
          `${group.count} ${group.language} file${group.count === 1 ? '' : 's'} (${group.reason})`,
      )
      .join('; ') +
    '.'
  );
}

/**
 * The groups other than the type-checked languages: an unavailable answer
 * already leads with the TypeScript reason, so its sentence is not repeated.
 */
function withoutTypeChecked(
  groups: readonly NotCheckedFiles[],
): NotCheckedFiles[] {
  return groups.filter((group) => !TYPE_CHECKED_LANGUAGES.has(group.language));
}

/** Group files by `language` + `reason`, listing at most the bound per group. */
function groupNotChecked(
  entries: ReadonlyArray<{
    readonly file?: string;
    readonly language: string;
    readonly reason: string;
    readonly count?: number;
  }>,
): NotCheckedFiles[] {
  const groups = new Map<
    string,
    { language: string; reason: string; count: number; files: string[] }
  >();
  for (const entry of entries) {
    const key = `${entry.language}\u0000${entry.reason}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        language: entry.language,
        reason: entry.reason,
        count: 0,
        files: [],
      };
      groups.set(key, group);
    }
    group.count += entry.count ?? 1;
    if (
      entry.file !== undefined &&
      group.files.length < MAX_NOT_CHECKED_FILES_LISTED
    ) {
      group.files.push(entry.file);
    }
  }
  return [...groups.values()].map((group) => ({
    language: group.language,
    count: saturate(group.count),
    ...(group.files.length > 0 ? { files: group.files } : {}),
    reason: group.reason,
  }));
}

function countsByKey(
  counts: ReadonlyMap<string, number>,
): Partial<Record<string, number>> {
  return Object.fromEntries(counts);
}

function sumOf(counts: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const count of counts.values()) total += count;
  return total;
}

function checksOf(
  typeChecked: boolean,
  syntaxChecked: boolean,
): CoverageChecks | undefined {
  if (typeChecked && syntaxChecked) return 'mixed';
  if (typeChecked) return 'type-check';
  return syntaxChecked ? 'syntax-only' : undefined;
}

function syntaxApproximations(
  languages: Iterable<SupportedLanguage>,
): Pick<CoverageFields, 'approximations' | 'approximationsOmitted'> {
  const approximations: Approximation[] = [];
  for (const language of languages) {
    approximations.push(`${language}:syntax-only`);
  }
  return limitApproximations(approximations);
}

/** Resolve on a later macrotask, so a long run of parses lets the loop breathe. */
function nextMacrotask(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function normalizeRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot).replace(/\\/g, '/');
}

export class LanguageAwareDiagnosticsProvider implements IDiagnosticsProvider {
  /** Settled censuses by root identity, least recently used first. */
  private readonly censusCache = new Map<string, CachedCensus>();

  /**
   * Discoveries in flight by root identity: at most one per root. Never
   * expired or evicted, so a walk that outlives the TTL is shared, not
   * repeated; it leaves this map when it settles.
   */
  private readonly censusInFlight = new Map<string, PendingCensus>();

  /**
   * The census validity fence. Every `invalidate` takes the next number;
   * a root's generation is the number of the last invalidate that covered it
   * (its own, or a global one). A census is valid for the generation its walk
   * started under, and an answer built after that generation moved on reports
   * the census `unknown`, never clean.
   */
  private invalidations = 0;
  private globalInvalidatedAt = 0;
  /**
   * Roots invalidated since the last global generation, by identity. Bounded
   * by {@link ROOT_GENERATIONS_MAX}: see `invalidate`.
   */
  private readonly rootInvalidatedAt = new Map<string, number>();

  /**
   * @param typeScript the TypeScript compiler provider; every TS/JS check,
   *   and every unscoped type check, is its answer.
   * @param fs file reads and the census discovery.
   * @param parser the tree-sitter parser the syntax check runs on.
   * @param platform Node platform string for the root containment rule, so a
   *   spec can drive the win32 case-fold on another OS. Hosts never pass it.
   */
  constructor(
    private readonly typeScript: IDiagnosticsProvider,
    private readonly fs: IFileSystemProvider,
    private readonly parser: SyntaxParser,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async getDiagnostics(
    workspaceRoot?: string,
    scope?: DiagnosticsScope,
  ): Promise<DiagnosticsResult> {
    if (!workspaceRoot) {
      return this.typeScript.getDiagnostics(workspaceRoot, scope);
    }
    if (scope?.files?.length) {
      return this.getScoped(workspaceRoot, scope.files);
    }
    return this.getUnscoped(workspaceRoot);
  }

  /**
   * Drop the inner provider's cached results and this root's settled census
   * (every root's when called with no argument), and move the root's census
   * generation on. Never re-runs or cancels anything: a discovery still in
   * flight stays the root's one walk until it settles, but it may have read
   * the tree before the change, so it is never cached, and every answer
   * assembled after this call from a census of an older generation (still
   * running, settled, or already awaiting the type check) reports the census
   * `unknown`, never clean. The first call after that walk settles walks
   * again. Starting a fresh walk instead would let a burst of invalidates run
   * parallel walks of one root.
   *
   * The per-root generations are bounded. A root's record cannot simply be
   * dropped: a reader may still hold the generation it replaced, and dropping
   * it would move the root back to that value and pass the fence. Instead,
   * when more than {@link ROOT_GENERATIONS_MAX} roots hold a record, every
   * root moves to one new global generation (this invalidate's number, which
   * is above every generation any reader holds) and every settled census is
   * dropped. The cost is conservative: answers already in flight for other
   * roots report the census `unknown` once, as after a global invalidate.
   * The inner provider's caches are not touched by the rollover.
   */
  invalidate(workspaceRoot?: string): void {
    this.typeScript.invalidate?.(workspaceRoot);
    this.invalidations++;
    if (workspaceRoot === undefined) {
      this.advanceGlobalGeneration();
      return;
    }
    const key = this.identity(normalizeRoot(workspaceRoot));
    this.censusCache.delete(key);
    this.rootInvalidatedAt.set(key, this.invalidations);
    if (this.rootInvalidatedAt.size > ROOT_GENERATIONS_MAX) {
      this.advanceGlobalGeneration();
    }
  }

  /** Every root to the current invalidation number; settled censuses dropped. */
  private advanceGlobalGeneration(): void {
    this.censusCache.clear();
    this.globalInvalidatedAt = this.invalidations;
    this.rootInvalidatedAt.clear();
  }

  /** The census generation of a root identity (see {@link invalidations}). */
  private generationOf(key: string): number {
    return Math.max(
      this.globalInvalidatedAt,
      this.rootInvalidatedAt.get(key) ?? 0,
    );
  }

  private censusKey(workspaceRoot: string): string {
    return this.identity(normalizeRoot(workspaceRoot));
  }

  /** The Batch 23a path identity, case-folded where this host folds case. */
  private identity(filePath: string): string {
    return graphPathIdentity(filePath, this.platform === 'win32');
  }

  private async getScoped(
    workspaceRoot: string,
    requested: readonly string[],
  ): Promise<DiagnosticsResult> {
    const normRoot = normalizeRoot(workspaceRoot);
    // One entry per file identity (a case-variant spelling of the same file
    // on win32 is one file), inside the root, in code-unit order.
    const byIdentity = new Map<string, string>();
    for (const file of requested) {
      const resolved = path.resolve(file).replace(/\\/g, '/');
      if (!isPathWithinRoots(resolved, [normRoot], this.platform)) continue;
      const identity = this.identity(resolved);
      if (!byIdentity.has(identity)) byIdentity.set(identity, resolved);
    }
    const files = [...byIdentity.values()].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    if (files.length === 0) {
      // Nothing inside the root: the inner provider owns that answer.
      return this.typeScript.getDiagnostics(workspaceRoot, {
        files: requested,
      });
    }

    const typeCheckFiles: Array<{ file: string; language: LanguageId }> = [];
    const syntaxFiles: Array<{ file: string; language: SupportedLanguage }> =
      [];
    const notChecked: Array<{
      file: string;
      language: string;
      reason: string;
    }> = [];
    const unsupportedByLanguage = new Map<string, number>();
    let unsupported = 0;
    let unrecognised = 0;
    let nonSource = 0;
    for (const file of files) {
      const fileClass = classifyForDiagnostics(file);
      switch (fileClass.kind) {
        case 'type-check':
          typeCheckFiles.push({ file, language: fileClass.language });
          break;
        case 'syntax':
          syntaxFiles.push({ file, language: fileClass.language });
          break;
        case 'unsupported':
          unsupported++;
          unsupportedByLanguage.set(
            fileClass.language,
            (unsupportedByLanguage.get(fileClass.language) ?? 0) + 1,
          );
          notChecked.push({
            file,
            language: fileClass.language,
            reason: unsupportedText(fileClass.language),
          });
          break;
        case 'unrecognised':
          unrecognised++;
          notChecked.push({
            file,
            language: 'other',
            reason: UNRECOGNISED_TEXT,
          });
          break;
        case 'nonSource':
          // Documented non-source never qualifies an answer (Batch 22).
          nonSource++;
          break;
      }
    }

    // The type check starts first and runs on its worker while this thread
    // parses; its lanes and its budget are the inner provider's.
    const typeCheck =
      typeCheckFiles.length > 0
        ? this.typeScript.getDiagnostics(workspaceRoot, {
            files: typeCheckFiles.map((entry) => entry.file),
          })
        : undefined;
    const checked = syntaxFiles.slice(0, SYNTAX_FILE_CAP);
    const omitted = syntaxFiles.slice(SYNTAX_FILE_CAP);
    // Both are observed from the start: a type check that rejects while the
    // parse runs (or after the parse rejects) is never an unhandled rejection.
    const [syntax, typed] = await Promise.all([
      this.syntaxCheck(checked),
      typeCheck,
    ]);

    const typeCheckRan = typed?.status === 'available';
    if (typed !== undefined && typed.status === 'unavailable') {
      for (const entry of typeCheckFiles) {
        notChecked.push({
          file: entry.file,
          language: entry.language,
          reason: `TypeScript check unavailable: ${typed.reason}`,
        });
      }
    }
    for (const failure of syntax.failures) {
      notChecked.push({
        file: failure.file,
        language: failure.language,
        reason: FAILURE_TEXT[failure.reason],
      });
    }
    for (const entry of omitted) {
      notChecked.push({
        file: entry.file,
        language: entry.language,
        reason: OMITTED_TEXT,
      });
    }

    const failedByReason: Partial<Record<FailureReason, number>> = {};
    for (const failure of syntax.failures) {
      failedByReason[failure.reason] =
        (failedByReason[failure.reason] ?? 0) + 1;
    }
    const syntaxAnalyzed = sumOf(syntax.analyzed);
    const coverage = withCoverageVerdict({
      supportedLanguages: DIAGNOSTICS_LANGUAGES,
      census: 'complete',
      // The type check may cover more than the requested files (the floor
      // rule) and does not count them: its share is unknown.
      analyzed: typeCheckRan ? null : saturate(syntaxAnalyzed),
      unchecked:
        typed !== undefined && typed.status === 'unavailable'
          ? saturate(typeCheckFiles.length)
          : 0,
      failed: saturate(syntax.failures.length),
      unsupported: saturate(unsupported),
      unrecognised: saturate(unrecognised),
      nonSource: saturate(nonSource),
      excluded: 0,
      omittedByCap: saturate(omitted.length),
      ...(unsupported > 0
        ? {
            unsupportedByLanguage: limitLanguageCounts(
              countsByKey(unsupportedByLanguage),
            ),
          }
        : {}),
      ...(syntax.failures.length > 0 ? { failedByReason } : {}),
      ...syntaxApproximations(syntax.analyzed.keys()),
      ...optionalChecks(checksOf(typeCheckRan, syntaxAnalyzed > 0)),
    });
    const groups = groupNotChecked(notChecked);

    if (typed !== undefined && typed.status === 'unavailable') {
      // A requested TS/JS file went unchecked: the answer is not available,
      // whatever the syntax check found (an `available` answer here would
      // read as "the TypeScript files are clean").
      const syntaxNote =
        syntaxAnalyzed > 0
          ? ` The syntax-only check of ${syntaxAnalyzed} other file(s) found ${syntax.errors} syntax error(s); request those files without the TypeScript ones to list them.`
          : '';
      return unavailableWith(
        typed.source,
        coverage,
        groups,
        `${typed.reason} ${describeNotChecked(withoutTypeChecked(groups))}${syntaxNote}`,
      );
    }
    if (!typeCheckRan && syntaxAnalyzed === 0) {
      // Nothing requested could be checked: never an empty `available`.
      return unavailableWith(
        SYNTAX_SOURCE,
        coverage,
        groups,
        `No requested file could be checked. ${describeNotChecked(groups)}`.trim(),
      );
    }
    return {
      status: 'available',
      source:
        typed === undefined
          ? SYNTAX_SOURCE
          : syntaxAnalyzed > 0
            ? `${typed.source}+${SYNTAX_SOURCE}`
            : typed.source,
      coverage,
      ...(groups.length > 0 ? { notChecked: groups } : {}),
      diagnostics: [
        ...(typed?.status === 'available' ? typed.diagnostics : []),
        ...syntax.diagnostics,
      ],
    };
  }

  private async getUnscoped(workspaceRoot: string): Promise<DiagnosticsResult> {
    const [typed, obtained] = await Promise.all([
      this.typeScript.getDiagnostics(workspaceRoot),
      this.censusWithinBudget(workspaceRoot),
    ]);
    // No await follows: the answer below is assembled under this check.
    const census = this.censusValidNow(workspaceRoot, obtained);
    const typeCheckRan = typed.status === 'available';
    const syntaxTotal = sumOf(census.syntax);
    const unsupportedTotal = sumOf(census.unsupported);
    const known = census.census !== 'unknown';

    // An unknown census counted nothing, so it names no group: the coverage
    // (`census: 'unknown'`, null counts) carries that instead.
    const notChecked: Array<{
      language: string;
      reason: string;
      count: number;
    }> = [];
    if (typed.status === 'unavailable') {
      for (const [language, count] of census.typeChecked) {
        notChecked.push({
          language,
          reason: `TypeScript check unavailable: ${typed.reason}`,
          count,
        });
      }
    }
    for (const [language, count] of census.syntax) {
      notChecked.push({ language, reason: UNSCOPED_SYNTAX_TEXT, count });
    }
    for (const [language, count] of census.unsupported) {
      notChecked.push({ language, reason: unsupportedText(language), count });
    }
    const groups = groupNotChecked(notChecked);

    const coverage: LanguageCoverage = withCoverageVerdict({
      supportedLanguages: DIAGNOSTICS_LANGUAGES,
      census: census.census,
      ...(census.census === 'truncated' ? { censusLimit: CENSUS_LIMIT } : {}),
      // The compiler does not count the files it checked.
      analyzed: typeCheckRan ? null : 0,
      unchecked: known
        ? saturate(syntaxTotal + (typeCheckRan ? 0 : sumOf(census.typeChecked)))
        : null,
      failed: known ? 0 : null,
      unsupported: known ? saturate(unsupportedTotal) : null,
      // The census lists recognised source extensions only.
      unrecognised: known ? 0 : null,
      nonSource: known ? 0 : null,
      // Vendor trees are excluded inside the walk, never observed.
      excluded: null,
      omittedByCap: known ? 0 : null,
      ...(known && unsupportedTotal > 0
        ? {
            unsupportedByLanguage: limitLanguageCounts(
              countsByKey(census.unsupported),
            ),
          }
        : {}),
      ...optionalChecks(typeCheckRan ? 'type-check' : undefined),
    });

    if (typed.status === 'unavailable') {
      return unavailableWith(
        typed.source,
        coverage,
        groups,
        `${typed.reason} ${describeNotChecked(withoutTypeChecked(groups))}`.trim(),
      );
    }
    return {
      status: 'available',
      source: typed.source,
      coverage,
      ...(groups.length > 0 ? { notChecked: groups } : {}),
      diagnostics: typed.diagnostics,
    };
  }

  /**
   * Syntax-check `files` one at a time, in order, yielding between files.
   * A file that cannot be read, is too large or fails to parse is a
   * failure by reason, never a clean file.
   */
  private async syntaxCheck(
    files: ReadonlyArray<{ file: string; language: SupportedLanguage }>,
  ): Promise<SyntaxOutcome> {
    const outcome: SyntaxOutcome = {
      diagnostics: [],
      analyzed: new Map(),
      failures: [],
      errors: 0,
    };
    if (files.length === 0) return outcome;
    const ready = await this.parser.initialize();
    if (ready.isErr()) {
      for (const entry of files) {
        outcome.failures.push({ ...entry, reason: 'grammar-unavailable' });
      }
      return outcome;
    }
    let errors = 0;
    for (const entry of files) {
      await nextMacrotask();
      const checked = await this.checkOneFile(entry.file, entry.language);
      if ('reason' in checked) {
        outcome.failures.push({ ...entry, reason: checked.reason });
        continue;
      }
      outcome.analyzed.set(
        entry.language,
        (outcome.analyzed.get(entry.language) ?? 0) + 1,
      );
      errors += checked.errors;
      if (checked.entries.length > 0) {
        outcome.diagnostics.push({
          file: entry.file,
          diagnostics: checked.entries,
        });
      }
    }
    return { ...outcome, errors };
  }

  private async checkOneFile(
    file: string,
    language: SupportedLanguage,
  ): Promise<
    | { readonly reason: FailureReason }
    | { readonly entries: DiagnosticEntry[]; readonly errors: number }
  > {
    let content: string;
    try {
      const stat = await this.fs.stat(file);
      if (stat.size > SYNTAX_MAX_BYTES) return { reason: 'too-large' };
      content = await this.fs.readFile(file);
    } catch (error: unknown) {
      // degradation-audit: reported — an unreadable requested file is a
      // `failed` (read) count in coverage and a `notChecked` entry naming it;
      // it is never counted as checked.
      void error;
      return { reason: 'read' };
    }
    // The file may have grown between the stat and the read.
    if (Buffer.byteLength(content, 'utf8') > SYNTAX_MAX_BYTES) {
      return { reason: 'too-large' };
    }

    const parsed = await this.parser.queryMulti(content, language, [
      { key: 'error', queryString: '(ERROR) @error' },
      { key: 'missing', queryString: '(MISSING) @missing' },
    ]);
    const results = parsed.isErr() ? undefined : parsed.value;
    if (!results) return { reason: 'parse' };

    const found = [
      ...(results.get('error') ?? []).flatMap((match) =>
        match.captures.map((capture) => ({
          row: capture.startPosition.row,
          column: capture.startPosition.column,
          message: `Syntax error (${language}; syntax-only check, not type-checked).`,
        })),
      ),
      ...(results.get('missing') ?? []).flatMap((match) =>
        match.captures.map((capture) => ({
          row: capture.startPosition.row,
          column: capture.startPosition.column,
          message: `Syntax error: missing ${JSON.stringify(capture.node.type)} (${language}; syntax-only check, not type-checked).`,
        })),
      ),
    ].sort((a, b) => a.row - b.row || a.column - b.column);

    const entries: DiagnosticEntry[] = found
      .slice(0, SYNTAX_MAX_ERRORS)
      .map((error) => ({
        message: error.message,
        line: error.row,
        severity: 'error',
        code: 'syntax',
      }));
    if (found.length === 0 && results.parseStatus === 'recovered') {
      // The parser recovered from an error it did not expose as a node.
      entries.push({
        message: `Syntax error at an unknown position (${language}; syntax-only check).`,
        line: 0,
        severity: 'error',
        code: 'syntax',
      });
    }
    if (found.length > SYNTAX_MAX_ERRORS || results.errorNodeCountCapped) {
      entries.push({
        message: `More syntax errors in this file are not listed (the syntax check lists at most ${SYNTAX_MAX_ERRORS}).`,
        line: 0,
        severity: 'info',
        code: 'syntax',
      });
    }
    return {
      entries,
      errors:
        found.length > 0
          ? found.length
          : results.parseStatus === 'recovered'
            ? 1
            : 0,
    };
  }

  /**
   * The root's census, or an unknown one when it is not ready within
   * {@link CENSUS_BUDGET_MS}, with the generation it is valid for. The
   * discovery is not cancelled: it lands in the cache for the next call.
   */
  private async censusWithinBudget(
    workspaceRoot: string,
  ): Promise<ObtainedCensus> {
    const { census, generation } = this.census(workspaceRoot);
    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<Census>((resolve) => {
      timer = setTimeout(() => resolve(UNKNOWN_CENSUS), CENSUS_BUDGET_MS);
      timer.unref?.();
    });
    try {
      return { census: await Promise.race([census, budget]), generation };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The root's census and the generation it is valid for: the discovery in
   * flight when there is one (whatever its generation: one walk per root),
   * else the settled census younger than {@link CENSUS_TTL_MS} (counted from
   * when it settled), else a new discovery shared by every caller until it
   * settles.
   */
  private census(workspaceRoot: string): {
    readonly census: Promise<Census>;
    readonly generation: number;
  } {
    const key = this.censusKey(workspaceRoot);
    const pending = this.censusInFlight.get(key);
    if (pending) return pending;
    const cached = this.censusCache.get(key);
    if (cached && Date.now() - cached.settledAt < CENSUS_TTL_MS) {
      // Refresh LRU recency.
      this.censusCache.delete(key);
      this.censusCache.set(key, cached);
      return {
        census: Promise.resolve(cached.census),
        generation: cached.generation,
      };
    }
    this.censusCache.delete(key);
    const generation = this.generationOf(key);
    const entry: PendingCensus = {
      generation,
      census: this.discoverCensus(workspaceRoot)
        .then((result) => {
          // An invalidate overtook this walk: it may have read the tree
          // before the change, so its count is never stored. (Answers are
          // fenced again at assembly: `censusValidNow`.)
          if (generation !== this.generationOf(key)) return UNKNOWN_CENSUS;
          // An unknown census reports a condition, not a count: never reused.
          if (result.census !== 'unknown') {
            this.cacheCensus(key, {
              settledAt: Date.now(),
              census: result,
              generation,
            });
          }
          return result;
        })
        .finally(() => {
          if (this.censusInFlight.get(key) === entry) {
            this.censusInFlight.delete(key);
          }
        }),
    };
    this.censusInFlight.set(key, entry);
    return entry;
  }

  /**
   * The census validity fence, applied after the last await of an answer: a
   * census whose generation an `invalidate` has since moved on may predate a
   * change, so it counts nothing (`unknown`, never clean).
   */
  private censusValidNow(
    workspaceRoot: string,
    obtained: ObtainedCensus,
  ): Census {
    return obtained.generation ===
      this.generationOf(this.censusKey(workspaceRoot))
      ? obtained.census
      : UNKNOWN_CENSUS;
  }

  /** Store a settled census, evicting the least recently used past the cap. */
  private cacheCensus(key: string, settled: CachedCensus): void {
    this.censusCache.delete(key);
    this.censusCache.set(key, settled);
    while (this.censusCache.size > CENSUS_CACHE_MAX_ROOTS) {
      const oldest = this.censusCache.keys().next();
      if (oldest.done) break;
      this.censusCache.delete(oldest.value);
    }
  }

  /** One bounded discovery of a root's recognised source files, counted. */
  private async discoverCensus(workspaceRoot: string): Promise<Census> {
    let found: string[];
    try {
      found = await this.fs.findFiles(
        CENSUS_GLOB,
        [...DEFAULT_WORKSPACE_EXCLUDES, ...CENSUS_VENDOR_EXCLUDES],
        CENSUS_LIMIT + 1,
        workspaceRoot,
      );
    } catch (error: unknown) {
      // degradation-audit: reported — a root or subtree that could not be
      // read (`IncompleteFileSearchError`) or any other discovery failure
      // makes the census `unknown`: the coverage is never clean and its
      // reasons say `census?`. The type-check answer itself is unaffected.
      void error;
      return UNKNOWN_CENSUS;
    }
    const typeChecked = new Map<string, number>();
    const syntax = new Map<string, number>();
    const unsupported = new Map<string, number>();
    const add = (counts: Map<string, number>, language: string): void => {
      counts.set(language, (counts.get(language) ?? 0) + 1);
    };
    for (const file of found.slice(0, CENSUS_LIMIT)) {
      const fileClass = classifyForDiagnostics(file);
      if (fileClass.kind === 'type-check') add(typeChecked, fileClass.language);
      else if (fileClass.kind === 'syntax') add(syntax, fileClass.language);
      else if (fileClass.kind === 'unsupported') {
        add(unsupported, fileClass.language);
      }
    }
    return {
      census: found.length > CENSUS_LIMIT ? 'truncated' : 'complete',
      typeChecked,
      syntax,
      unsupported,
    };
  }
}

function optionalChecks(
  checks: CoverageChecks | undefined,
): Pick<CoverageFields, 'checks'> {
  return checks === undefined ? {} : { checks };
}

function unavailableWith(
  source: string,
  coverage: LanguageCoverage,
  notChecked: readonly NotCheckedFiles[],
  reason: string,
): DiagnosticsResult {
  return {
    status: 'unavailable',
    source,
    coverage,
    ...(notChecked.length > 0 ? { notChecked } : {}),
    reason,
  };
}
