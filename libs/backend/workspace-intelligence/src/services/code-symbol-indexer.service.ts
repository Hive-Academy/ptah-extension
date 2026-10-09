import { AsyncLocalStorage } from 'node:async_hooks';
import * as path from 'path';
import picomatch from 'picomatch';
import { inject, injectable } from 'tsyringe';
import {
  TOKENS,
  type BackgroundWorkAdmission,
  type Logger,
} from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  COVERAGE_COUNT_MAX,
  type CoverageCensus,
  type CoverageState,
  type FailureReason,
  type IFileSystemProvider,
  type LanguageCoverage,
  withCoverageVerdict,
} from '@ptah-extension/platform-core';
import {
  MEMORY_CONTRACT_TOKENS,
  type ISymbolSink,
  type SymbolChunkInsert,
} from '@ptah-extension/memory-contracts';
import { AstAnalysisService } from '../ast/ast-analysis.service';
import { parserFailureReason } from '../ast/parser-refusal';
import { WorkspaceIndexerService } from '../file-indexing/workspace-indexer.service';
import type { SupportedLanguage } from '../ast/ast.types';
import type { CodeInsights, ExportInfo } from '../ast/ast-analysis.interfaces';
import { exportRowRange } from '../ast/export-extraction';
import { EXTENSION_LANGUAGE_MAP } from '../ast/tree-sitter.config';
import { graphPathIdentity } from '../ast/dependency-graph.service';
import {
  limitLanguageCounts,
  type UnsupportedLanguageKey,
} from '../ast/graph-coverage';
import {
  classifyFileForCoverage,
  isCParsedAsCpp,
  languageForExtension,
  recognisedSourceExtensions,
  supportedLanguagesFor,
} from '../ast/language-registry';

export interface CodeSymbolIndexerOptions {
  /** Number of files to process per batch before yielding. Default: 20 */
  batchSize?: number;
  /**
   * Optional bound on eligible files after the skip filter. Omitted (the
   * default) indexes every eligible file. When set and the tree has more
   * eligible files, the run's census is `truncated` and `omittedByCap` is
   * the number of eligible files not selected.
   */
  maxFilesPerRun?: number;
  /**
   * Optional AbortSignal for cooperative cancellation.
   * Checked at batch boundaries — the current batch always completes before
   * the signal is honored (no partial DB writes).
   * When aborted, throws DOMException('Aborted', 'AbortError').
   * Existing callers that omit this field are unaffected.
   */
  signal?: AbortSignal;
  /**
   * Optional progress callback fired at every batch boundary so the UI can
   * surface incremental progress.
   */
  onProgress?: (progress: CodeSymbolIndexerProgress) => void;
  /**
   * A caller acting for the user or for a running agent turn (the
   * `ptah.code.reindex` tool) sets this, and the run never waits on the
   * background-work governor. Every other run is background work and yields
   * before each batch while the foreground is busy or the main loop lags
   * (TASK_2026_437 C14 b). Without it, a reindex requested from INSIDE a
   * generating turn would wait for that same turn to finish.
   */
  userInitiated?: boolean;
}

export interface CodeSymbolIndexerProgress {
  filesScanned: number;
  totalFiles: number;
  symbolsIndexed: number;
  currentFile: string;
}

export interface IndexingStats {
  filesScanned: number;
  symbolsIndexed: number;
  errors: number;
  durationMs: number;
}

/**
 * Discovery include globs: every extension a registry language claims, so a
 * run counts the recognised files it cannot index (`unsupported`) as well as
 * the ones whose language holds `codeIndex`. Which is which is decided per
 * file by `classifyFileForCoverage(path, 'codeIndex')`.
 */
const DISCOVERY_PATTERNS: readonly string[] = recognisedSourceExtensions().map(
  (extension) => `**/*${extension}`,
);
const DEFAULT_BATCH_SIZE = 20;
/** `whenClear` lane name; it only labels the governor's ceiling log line. */
const GOVERNOR_LANE = 'code-symbol-indexer';
/**
 * Paths indexed last so source trees fill the run (and any optional cap)
 * before workspace-local skills and agent files.
 */
const DEFERRED_DISCOVERY = /(?:^|\/)(?:\.ptah|\.github\/skills)(?:\/|$)/;
/**
 * A run never reads a file larger than this (the discovery stream's old
 * silent size limit, now counted as `failed` with reason `too-large`).
 */
const MAX_INDEXED_FILE_BYTES = 1024 * 1024;
/**
 * Distinct files a root's per-file record tracks between full runs. Past it
 * the record stops growing and the root's census reads `truncated`.
 */
const PER_FILE_RECORD_LIMIT = 2000;

const DEFAULT_SKIP_PATTERNS = [
  'jest.config.*',
  'jest.setup.*',
  'jest-setup.*',
  'vitest.config.*',
  'webpack.config.*',
  'rollup.config.*',
  'vite.config.*',
  'esbuild.config.*',
  'babel.config.*',
  '.eslintrc.*',
  'tsconfig*.ts',
  '*.d.ts',
  '*.spec.ts',
  '*.spec.tsx',
  '*.spec.js',
  '*.spec.jsx',
  '*.test.ts',
  '*.test.tsx',
  '*.test.js',
  '*.test.jsx',
  '*.module.ts',
  '*.module.js',
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'public-api.ts',
  '*_test.go',
  'test_*.py',
  '*_test.py',
  'conftest.py',
  '__init__.py',
  // C# generated output. Test files are deliberately NOT skipped here: the
  // conventions (`*Test.cs`, `*Tests.cs`) collide with ordinary words such as
  // `Latest.cs`, and wrongly dropping a source file loses symbols, while
  // indexing a test file only adds noise.
  '*.designer.cs',
  '*.g.cs',
  '*.generated.cs',
  'AssemblyInfo.cs',
  'GlobalUsings.cs',
];
const SKIP_MATCHER = picomatch(DEFAULT_SKIP_PATTERNS, { nocase: true });
function shouldSkipFile(absoluteFilePath: string): boolean {
  return SKIP_MATCHER(path.basename(absoluteFilePath));
}

function normalizeIndexPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/** Source files first; `.ptah/` and `.github/skills` last; then path order. */
function compareDiscoveryOrder(a: string, b: string): number {
  const deferredA = DEFERRED_DISCOVERY.test(a) ? 1 : 0;
  const deferredB = DEFERRED_DISCOVERY.test(b) ? 1 : 0;
  if (deferredA !== deferredB) return deferredA - deferredB;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Maps a file extension to the tree-sitter SupportedLanguage.
 *
 * Delegates to `EXTENSION_LANGUAGE_MAP` — this used to be a hand-maintained
 * switch that duplicated it, which meant every new language had to be added in
 * two places or the indexer silently skipped files the parser could handle.
 */
function extensionToLanguage(ext: string): SupportedLanguage | null {
  return EXTENSION_LANGUAGE_MAP[ext.toLowerCase()] ?? null;
}

/**
 * Yields control to the event loop so that long indexing runs do not stall
 * the Electron main process or VS Code extension host.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * How one file write ended, for coverage. `write` is a failure of the symbol
 * sink itself (clear or insert): it counts as `failed`, but no
 * `FailureReason` describes it, so `failedByReason` leaves it out.
 */
type FileOutcome =
  | { readonly kind: 'analyzed' }
  | { readonly kind: 'failed'; readonly reason: FailureReason | 'write' }
  /**
   * Written, but the parser could not say whether the tree is whole
   * (`parseStatus: 'unknown'`): counted `unchecked`, never `analyzed`.
   */
  | { readonly kind: 'unchecked' }
  /** The file's language has no `codeIndex`: nothing was written. */
  | { readonly kind: 'unsupported' };

interface FileStats {
  symbolsIndexed: number;
  errors: number;
  durationMs: number;
  outcome: FileOutcome;
  /** `replaceFileSymbols` finished. A failed read or parse does not set it. */
  wrote?: boolean;
  /** Census saw a deletion tombstone and did not replace. */
  skippedTombstone?: boolean;
}

/** A completed write of one file; `seq` orders writes across runs and per-file calls. */
interface RecordedWrite {
  readonly outcome: FileOutcome;
  readonly seq: number;
}

/** One full run's accounting. */
interface IndexRun {
  /**
   * Set when discovery finished: `complete`, or `truncated` when the run
   * stopped at `maxFilesPerRun` indexable files. `null` while discovering
   * (or when discovery failed): nothing was enumerated.
   */
  census: CoverageCensus | null;
  censusLimit?: number;
  /** Eligible files past `maxFilesPerRun`; 0 when the run was not capped. */
  omittedByCap: number;
  /** Path identities the run set out to index. */
  selected: string[];
  unsupported: number;
  unsupportedByLanguage: Partial<Record<UnsupportedLanguageKey, number>>;
  /** Writes this run made, by path identity. */
  readonly writes: Map<string, RecordedWrite>;
  /**
   * Store paths a non-census `reindexFile` wrote while this run was in
   * progress, keyed by the file-lock identity. Merged into the purge-present
   * set. Not a disk stat.
   */
  readonly keptPaths: Map<string, string>;
  /**
   * File-lock identities deleted while this run was in progress. A later
   * census replace of the same identity is skipped, and purge drops the
   * path even when discovery saw it. A successful non-census reindex clears
   * the entry.
   */
  readonly tombstones: Set<string>;
  /**
   * Another writer changed this root's rows while the run was in progress
   * (see {@link CodeSymbolIndexer.invalidateCoverage}): the run ends
   * `incomplete` even when it succeeds.
   */
  invalidated: boolean;
}

/**
 * What the indexer knows about one workspace root in this host session. No
 * record at all is a new session: the SQLite rows may exist, but nothing
 * here can say what they cover.
 */
interface RootRecord {
  /** The run currently writing this root. */
  active: IndexRun | null;
  /** The last run that ended, and how. Dropped when a new run begins. */
  settled: {
    readonly run: IndexRun;
    readonly state: 'current' | 'incomplete';
  } | null;
  /**
   * Writes made outside the active run (a per-file reindex) since the last
   * run began, by path identity. Bounded by {@link PER_FILE_RECORD_LIMIT}.
   */
  readonly perFile: Map<string, RecordedWrite>;
  /** The per-file record hit its limit and stopped tracking new files. */
  perFileTruncated: boolean;
  /**
   * The full census still in progress for this root. Full censuses are
   * serialized, so this holds the active run only.
   */
  readonly runsInProgress: Set<IndexRun>;
}

/**
 * The one full census in flight for a root. Joiners share `promise`.
 * There is no follow-up: the workspace index lifecycle owns trailing runs.
 */
interface ActiveCensus {
  readonly promise: Promise<IndexingStats>;
  /** Progress recipients added by starter and joiners while the census runs. */
  readonly progressListeners: Set<
    NonNullable<CodeSymbolIndexerOptions['onProgress']>
  >;
  /** A faulty callback is warned once per census without interrupting indexing. */
  readonly warnedProgressListeners: Set<
    NonNullable<CodeSymbolIndexerOptions['onProgress']>
  >;
  /** Once a user joins, remaining batches must not wait for background work. */
  userInitiated: boolean;
}

const EMPTY_INDEX_STATS: IndexingStats = {
  filesScanned: 0,
  symbolsIndexed: 0,
  errors: 0,
  durationMs: 0,
};

const ANALYZED: FileOutcome = { kind: 'analyzed' };
const UNSUPPORTED: FileOutcome = { kind: 'unsupported' };
const UNCHECKED: FileOutcome = { kind: 'unchecked' };

/**
 * The Batch 24a parse-quality contract: only a clean parse counts as
 * analysed. A recovered tree (ERROR/MISSING nodes) is a parse failure even
 * though its partial symbols are still written; an unknown quality is
 * unchecked. A clean parse with export forms the extractor could not read
 * (`exports[key] = v`) is a failure too (`unsupported-syntax`, the reason
 * ptah_ast_analyze and the graph give): its known symbols are written, but
 * the file's rows may miss an export. So is a definition whose declarator
 * names nothing readable (`unextractedDeclarations`, Batch 31 r1 R31-02).
 */
function outcomeOfParse(insights: CodeInsights): FileOutcome {
  if (insights.parseStatus === 'ok') {
    return (insights.unextractedExports ?? []).length > 0 ||
      (insights.unextractedDeclarations ?? []).length > 0
      ? failure('unsupported-syntax')
      : ANALYZED;
  }
  if (insights.parseStatus === 'recovered') return failure('parse');
  return UNCHECKED;
}

/**
 * The `code_symbols` kind of an export record. A declared kind keeps its
 * name; a name the statement only re-exposes (`export { a as b }`, `export
 * default a`, `exports.a = a`, `export import A = N.B`) is `export`.
 */
function exportRowKind(info: ExportInfo): string {
  return info.kind === 'unknown' ? 'export' : info.kind;
}

/**
 * Names an export row is never written for: `*` (a wildcard names nothing
 * here; its names are indexed in their own module), `default` and `export=`
 * (the module's own slot, not a name anyone searches; a named default keeps
 * its declared name). Any other name is written as extracted, a `:` in it
 * included: each chunk carries its kind and name for the sink, so nothing is
 * parsed back out of the subject.
 */
function isIndexableExportName(info: ExportInfo): boolean {
  return (
    info.kind !== 'wildcard' &&
    info.name !== 'default' &&
    info.name !== 'export=' &&
    info.name.length > 0
  );
}

function failure(reason: FailureReason | 'write'): FileOutcome {
  return { kind: 'failed', reason };
}

/**
 * The approximation of an answer that wrote C sources parsed with the C++
 * grammar (User Decision 19): `c:parsed-as-cpp`, whatever each file's
 * outcome, since a C file the C++ grammar cannot parse is why some of them
 * may have failed.
 */
function parsedAsCppFields(
  writtenCSource: boolean,
): Pick<LanguageCoverage, 'approximations'> {
  return writtenCSource ? { approximations: ['c:parsed-as-cpp'] } : {};
}

/**
 * What a single-file reindex returns: its own one-file coverage (the same
 * contract as a full run's, verdict first) and the write's stats. The
 * coverage says what a bare `errors: 0` cannot: a recovered parse is
 * `failed`, an unknown parse quality `unchecked`, a skip-pattern file
 * `excluded`, a language without `codeIndex` `unsupported`.
 */
export interface SingleFileReindex {
  readonly coverage: LanguageCoverage;
  readonly symbolsIndexed: number;
  readonly errors: number;
  readonly durationMs: number;
}

/** The census of one explicitly named file: always complete. */
function singleFileCoverage(
  filePath: string,
  outcome: FileOutcome | 'excluded',
): LanguageCoverage {
  const counts = {
    analyzed: 0,
    unchecked: 0,
    failed: 0,
    unsupported: 0,
    excluded: 0,
  };
  if (outcome === 'excluded') counts.excluded = 1;
  else counts[outcome.kind] = 1;
  const language: UnsupportedLanguageKey =
    languageForExtension(path.extname(filePath)) ?? 'other';
  const reason =
    outcome !== 'excluded' &&
    outcome.kind === 'failed' &&
    outcome.reason !== 'write'
      ? outcome.reason
      : undefined;
  return withCoverageVerdict({
    supportedLanguages: supportedLanguagesFor('codeIndex'),
    census: 'complete',
    ...counts,
    unrecognised: 0,
    nonSource: 0,
    omittedByCap: 0,
    ...(counts.unsupported > 0
      ? { unsupportedByLanguage: { [language]: 1 } }
      : {}),
    ...(reason === undefined ? {} : { failedByReason: { [reason]: 1 } }),
    ...parsedAsCppFields(
      outcome !== 'excluded' &&
        outcome.kind !== 'unsupported' &&
        isCParsedAsCpp(filePath),
    ),
  });
}

/** Coverage when nothing enumerated the root's files: never clean. */
function unknownCoverage(state?: CoverageState): LanguageCoverage {
  return withCoverageVerdict({
    supportedLanguages: supportedLanguagesFor('codeIndex'),
    census: 'unknown',
    ...(state === undefined ? {} : { state }),
    analyzed: null,
    unchecked: null,
    failed: null,
    unsupported: null,
    unrecognised: null,
    nonSource: null,
    excluded: null,
    omittedByCap: null,
  });
}

function saturate(count: number): number {
  return Math.min(count, COVERAGE_COUNT_MAX);
}

@injectable()
export class CodeSymbolIndexer {
  /** Latch: a defective governor is warned about once, not per batch. */
  private governorFailureWarned = false;
  /**
   * Coverage state per workspace root, keyed by its path identity. One entry
   * per root indexed in this host session.
   */
  private readonly roots = new Map<string, RootRecord>();
  /**
   * The one full census per root identity. An entry exists only while that
   * census is running, and is removed in its `finally` before the promise
   * settles. There is no follow-up queue.
   */
  private readonly activeCensuses = new Map<string, ActiveCensus>();
  /**
   * Tail of the write chain per file identity (see {@link withFileLock}); an
   * entry lives only while a write of that file is running or queued.
   */
  private readonly fileLocks = new Map<string, Promise<void>>();
  /**
   * Identity of the file lock the current async chain already holds, so a
   * delete or reindex invoked from inside that write (after the read) can
   * record a tombstone before the replace. A caller from outside the chain
   * does not see it and waits.
   */
  private readonly fileLockContext = new AsyncLocalStorage<string>();
  /** Orders every recorded write, so the latest write of a file wins. */
  private writeSeq = 0;
  /**
   * File writes running or queued behind the file lock, per root identity.
   * Kept apart from the root records so a write that starts before a root
   * has any record is still seen; an entry lives only while its count is
   * above zero.
   */
  private readonly pendingWrites = new Map<string, number>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.AST_ANALYSIS_SERVICE)
    private readonly astAnalysis: AstAnalysisService,
    @inject(TOKENS.WORKSPACE_INDEXER_SERVICE)
    private readonly indexer: WorkspaceIndexerService,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(MEMORY_CONTRACT_TOKENS.SYMBOL_SINK)
    private readonly sink: ISymbolSink,
    /**
     * Optional: a bare container (and every host before Batch 16) has none,
     * and then indexing runs exactly as it did — ungoverned.
     */
    @inject(TOKENS.BACKGROUND_WORK_GOVERNOR, { isOptional: true })
    private readonly governor: BackgroundWorkAdmission | null = null,
  ) {}

  /**
   * Index all matching files in the workspace.
   * Uses setImmediate() between batches to avoid stalling the event loop.
   *
   * Background runs wait for the governor to clear before EACH batch,
   * including the first. The wait sits on a batch boundary, so a batch is
   * never split: every file's stale symbols are deleted and its new ones
   * inserted inside one batch. When the governor aborts the wait (host
   * shutdown) or `options.signal` fires during it, the run stops with the
   * same `AbortError` the signal check below throws — callers already treat
   * that as a clean stop.
   *
   * Coverage (TASK_2026_559 Batch 24b): the run begins synchronously, before
   * this method's first `await`, so a caller that starts it without awaiting
   * (the lazy reindex) already reads `state: 'updating'`. A run that returns
   * normally ends `current`; an abort, a failed discovery, a purge failure,
   * or a thrown error ends `incomplete`, which stays until a later run succeeds.
   * `IndexingStats` has no completeness field. A purge failure is thrown so
   * callers that only observe the promise (the host `.catch`) can schedule
   * a retry. Discovery failure still returns, because there is no write error.
   *
   * One census per root (path identity). A call that arrives while that
   * census is active joins it and receives the active run's `IndexingStats`.
   * A joiner's cap, batch size, and signal ownership remain starter-only. Its
   * `onProgress` callback receives later batch updates, and `userInitiated`
   * permanently makes remaining batches bypass the background governor. If the joiner
   * passes `signal` and that signal is already aborted or aborts later, only
   * the joiner's promise rejects with `DOMException` (`'Aborted'`, name
   * `'AbortError'`, the same error {@link throwIfAborted} throws). The
   * active census continues under the starter's signal. There is no
   * follow-up census here; a later full run is a new call after this one
   * settles. The workspace index lifecycle owns that trailing run.
   */
  async indexWorkspace(
    workspaceRoot: string,
    options?: CodeSymbolIndexerOptions,
  ): Promise<IndexingStats> {
    if (!workspaceRoot) {
      this.logger.warn(
        '[CodeSymbolIndexer] indexWorkspace called with empty workspaceRoot — skipping',
      );
      return EMPTY_INDEX_STATS;
    }

    const key = graphPathIdentity(workspaceRoot);
    const active = this.activeCensuses.get(key);
    if (active !== undefined) {
      return this.joinActiveCensus(active, options);
    }
    return this.startCensus(workspaceRoot, key, options);
  }

  /**
   * True while this root has an active full census. The key is the root's
   * path identity, so a trailing slash is the same run. A per-file
   * `reindexFile` does not count. The flag is the active-census record:
   * it is set before discovery and cleared in the census `finally`, before
   * the census promise settles, including when the census rejects. There
   * is no follow-up wait, so a gap between two full runs reads false.
   */
  isIndexing(workspaceRoot: string): boolean {
    if (!workspaceRoot) return false;
    return this.activeCensuses.has(graphPathIdentity(workspaceRoot));
  }

  /**
   * The live coverage of the code index for `workspaceRoot` in this host
   * session. It describes the last full run plus every file write since that
   * run began; it never claims to be a snapshot of the SQLite rows.
   *
   * - No run in this session: `census: 'unknown'`, no `state`, counts `null`.
   * - A run is discovering: `state: 'updating'`, counts `null`. Once
   *   discovery selected its files, a writing run reports its known partial
   *   counts from that run and concurrent per-file writes.
   * - The last run succeeded: `state: 'current'`; it failed or was aborted:
   *   `state: 'incomplete'`, with its files not yet written in `unchecked`.
   * - `unrecognised`, `nonSource` and `excluded` are `null`: discovery asks
   *   only for recognised source extensions and drops ignored and default-
   *   excluded paths itself, so those files are never observed.
   */
  getCoverage(workspaceRoot: string): LanguageCoverage {
    const record = this.roots.get(graphPathIdentity(workspaceRoot));
    if (record === undefined) return unknownCoverage();
    if (record.active !== null) {
      const { active } = record;
      if (active.census === null) return unknownCoverage('updating');
      return this.coverageForRun(record, active, 'updating', active.census);
    }
    if (record.settled === null) return unknownCoverage();
    const { run } = record.settled;
    // A per-file write or a census still writing: the rows a search reads
    // may be mid-change (cleared, not yet re-inserted).
    const writing =
      (this.pendingWrites.get(graphPathIdentity(workspaceRoot)) ?? 0) > 0 ||
      record.runsInProgress.size > 0;
    const state =
      writing && record.settled.state === 'current'
        ? 'updating'
        : record.settled.state;
    if (run.census === null) return unknownCoverage(state);

    return this.coverageForRun(
      record,
      run,
      state,
      record.perFileTruncated ? 'truncated' : run.census,
    );
  }

  /** Builds coverage from one run and the newest completed write per file. */
  private coverageForRun(
    record: RootRecord,
    run: IndexRun,
    state: CoverageState,
    census: CoverageCensus,
  ): LanguageCoverage {
    const latest = new Map(run.writes);
    for (const [identity, write] of record.perFile) {
      const previous = latest.get(identity);
      if (previous === undefined || write.seq > previous.seq) {
        latest.set(identity, write);
      }
    }
    let analyzed = 0;
    let uncheckedWrites = 0;
    let failed = 0;
    let writtenCSource = false;
    const failedByReason: Partial<Record<FailureReason, number>> = {};
    for (const [identity, { outcome }] of latest) {
      if (outcome.kind !== 'unsupported' && isCParsedAsCpp(identity)) {
        writtenCSource = true;
      }
      if (outcome.kind === 'analyzed') {
        analyzed++;
      } else if (outcome.kind === 'unchecked') {
        uncheckedWrites++;
      } else if (outcome.kind === 'failed') {
        failed++;
        if (outcome.reason !== 'write') {
          failedByReason[outcome.reason] =
            (failedByReason[outcome.reason] ?? 0) + 1;
        }
      }
    }
    const unchecked =
      uncheckedWrites +
      run.selected.filter((identity) => !latest.has(identity)).length;

    return withCoverageVerdict({
      supportedLanguages: supportedLanguagesFor('codeIndex'),
      census,
      ...(run.censusLimit === undefined
        ? {}
        : { censusLimit: run.censusLimit }),
      state,
      analyzed: saturate(analyzed),
      unchecked: saturate(unchecked),
      failed: saturate(failed),
      unsupported: saturate(run.unsupported),
      unrecognised: null,
      nonSource: null,
      excluded: null,
      omittedByCap: run.census === 'truncated' ? saturate(run.omittedByCap) : 0,
      ...(run.unsupported > 0
        ? {
            unsupportedByLanguage: limitLanguageCounts(
              run.unsupportedByLanguage,
            ),
          }
        : {}),
      ...(Object.keys(failedByReason).length > 0 ? { failedByReason } : {}),
      ...parsedAsCppFields(writtenCSource),
    });
  }

  /**
   * Starts the one census for `key`. The active-census record is stored
   * before {@link beginRun}, so coverage is `updating` and {@link isIndexing}
   * is true before this promise yields. The record is removed in `finally`
   * only when it is still this census, and before the returned promise
   * settles.
   */
  private startCensus(
    workspaceRoot: string,
    key: string,
    options?: CodeSymbolIndexerOptions,
  ): Promise<IndexingStats> {
    let resolveCensus!: (stats: IndexingStats) => void;
    let rejectCensus!: (error: unknown) => void;
    const promise = new Promise<IndexingStats>((resolve, reject) => {
      resolveCensus = resolve;
      rejectCensus = reject;
    });
    const record: ActiveCensus = {
      promise,
      progressListeners: new Set(
        options?.onProgress === undefined ? [] : [options.onProgress],
      ),
      warnedProgressListeners: new Set(),
      userInitiated: options?.userInitiated === true,
    };
    this.activeCensuses.set(key, record);
    const run = this.beginRun(workspaceRoot);
    let state: 'current' | 'incomplete' = 'incomplete';
    void this.runIndex(workspaceRoot, run, options, record)
      .then(({ stats, complete }) => {
        if (complete) state = 'current';
        return stats;
      })
      .finally(() => {
        this.settleRun(workspaceRoot, run, state);
        record.progressListeners.clear();
        record.warnedProgressListeners.clear();
        if (this.activeCensuses.get(key) === record) {
          this.activeCensuses.delete(key);
        }
      })
      .then(resolveCensus, rejectCensus);
    return promise;
  }

  /**
   * Shares the active census. A joiner's progress listener receives later
   * batches only; its abort removes that listener and rejects only the joiner.
   */
  private joinActiveCensus(
    active: ActiveCensus,
    options: CodeSymbolIndexerOptions | undefined,
  ): Promise<IndexingStats> {
    if (options?.userInitiated === true) active.userInitiated = true;
    const progress = options?.onProgress;
    if (progress !== undefined) active.progressListeners.add(progress);
    const signal = options?.signal;
    if (signal === undefined) return active.promise;
    if (signal.aborted) {
      if (progress !== undefined) active.progressListeners.delete(progress);
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }
    return new Promise<IndexingStats>((resolve, reject) => {
      let settled = false;
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        if (progress !== undefined) active.progressListeners.delete(progress);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      const finish = (): void => {
        signal.removeEventListener('abort', onAbort);
        if (progress !== undefined) active.progressListeners.delete(progress);
      };
      active.promise.then(
        (stats) => {
          finish();
          if (settled) return;
          settled = true;
          resolve(stats);
        },
        (error: unknown) => {
          finish();
          if (settled) return;
          settled = true;
          reject(error);
        },
      );
    });
  }

  /**
   * Starts a run for `workspaceRoot`: synchronous, so it holds before any
   * write. Full censuses for one root are serialized, so this does not
   * overlap another run. The previous run's counts and per-file record are
   * dropped.
   */
  private beginRun(workspaceRoot: string): IndexRun {
    const run: IndexRun = {
      census: null,
      omittedByCap: 0,
      selected: [],
      unsupported: 0,
      unsupportedByLanguage: {},
      writes: new Map(),
      keptPaths: new Map(),
      tombstones: new Set(),
      invalidated: false,
    };
    const key = graphPathIdentity(workspaceRoot);
    const record = this.roots.get(key);
    if (record === undefined) {
      this.roots.set(key, {
        active: run,
        settled: null,
        perFile: new Map(),
        perFileTruncated: false,
        runsInProgress: new Set([run]),
      });
    } else {
      record.active = run;
      record.settled = null;
      record.perFile.clear();
      record.perFileTruncated = false;
      record.runsInProgress.add(run);
    }
    return run;
  }

  /**
   * Another writer is about to change (or has changed) `workspaceRoot`'s
   * rows outside this indexer — the `memory:purgeJunk` RPC. Call it before
   * the mutation: the last run's coverage turns `incomplete`, and a run in
   * progress ends `incomplete` even if it succeeds, because it cannot know
   * which of its counted files lost their rows. Only a full run that begins
   * after the mutation reports `current` again. A root with no record (no
   * run in this session) is already `unknown` and stays so.
   */
  invalidateCoverage(workspaceRoot: string): void {
    const record = this.roots.get(graphPathIdentity(workspaceRoot));
    if (record === undefined) return;
    for (const run of record.runsInProgress) run.invalidated = true;
    if (record.settled !== null) {
      record.settled = { run: record.settled.run, state: 'incomplete' };
    }
  }

  /** Ends `run` for its root. A run that is no longer active changes nothing. */
  private settleRun(
    workspaceRoot: string,
    run: IndexRun,
    state: 'current' | 'incomplete',
  ): void {
    const record = this.roots.get(graphPathIdentity(workspaceRoot));
    if (record === undefined) return;
    record.runsInProgress.delete(run);
    if (record.active !== run) return;
    record.active = null;
    record.settled = { run, state: run.invalidated ? 'incomplete' : state };
  }

  /**
   * Records a completed write of one file for coverage. A write by the active
   * run is that run's; any other write (a per-file reindex) goes to the
   * per-file record, and the latest write of a file wins when coverage is
   * read. A root with no record (no run in this session) gets none: a
   * per-file write never creates a census.
   */
  private recordWrite(
    workspaceRoot: string,
    identity: string,
    outcome: FileOutcome,
    run: IndexRun | null,
  ): void {
    if (outcome.kind === 'unsupported') return;
    const record = this.roots.get(graphPathIdentity(workspaceRoot));
    if (record === undefined) return;
    const write: RecordedWrite = { outcome, seq: ++this.writeSeq };
    if (run !== null && record.active === run) {
      run.writes.set(identity, write);
      return;
    }
    if (
      record.perFile.has(identity) ||
      record.perFile.size < PER_FILE_RECORD_LIMIT
    ) {
      record.perFile.set(identity, write);
      return;
    }
    record.perFileTruncated = true;
  }

  /**
   * Runs `write` after every earlier write of the same file has finished, so
   * a per-file reindex and a full run never interleave their clear and insert
   * of one file, and the file's read happens after the previous write.
   */
  private async withFileLock<T>(
    identity: string,
    write: () => Promise<T>,
  ): Promise<T> {
    if (this.fileLockContext.getStore() === identity) {
      return write();
    }
    const previous = this.fileLocks.get(identity) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => done);
    this.fileLocks.set(identity, tail);
    await previous;
    try {
      return await this.fileLockContext.run(identity, write);
    } finally {
      release();
      if (this.fileLocks.get(identity) === tail) {
        this.fileLocks.delete(identity);
      }
    }
  }

  /** In-progress censuses for this root. A root with no run yields none. */
  private runsInProgress(workspaceRoot: string): Set<IndexRun> | undefined {
    return this.roots.get(graphPathIdentity(workspaceRoot))?.runsInProgress;
  }

  /**
   * Remember a store path a non-census write just committed, and drop any
   * tombstone for it. Every census still running for the root purges with
   * its own snapshot, so each of them must keep the path.
   */
  private rememberKeptPath(
    workspaceRoot: string,
    identity: string,
    storePath: string,
  ): void {
    const runs = this.runsInProgress(workspaceRoot);
    if (runs === undefined) return;
    for (const run of runs) {
      run.tombstones.delete(identity);
      run.keptPaths.set(identity, storePath);
    }
  }

  /** Tombstone `identity` on every census still running for the root. */
  private rememberTombstone(workspaceRoot: string, identity: string): void {
    const runs = this.runsInProgress(workspaceRoot);
    if (runs === undefined) return;
    for (const run of runs) {
      run.keptPaths.delete(identity);
      run.tombstones.add(identity);
    }
  }

  /** {@link _indexFile} under the file's write lock, with its outcome recorded. */
  private async indexFileRecorded(
    filePath: string,
    workspaceRoot: string,
    run: IndexRun | null,
  ): Promise<FileStats> {
    const identity = graphPathIdentity(filePath);
    // Counted from before the lock wait (a queued write is already pending),
    // and whether or not the root has a record yet: a write that starts
    // before the first run must still hold that run's answer at `updating`.
    const rootKey = graphPathIdentity(workspaceRoot);
    this.pendingWrites.set(rootKey, (this.pendingWrites.get(rootKey) ?? 0) + 1);
    try {
      return await this.withFileLock(identity, async () => {
        const stats = await this._indexFile(filePath, workspaceRoot, run);
        if (stats.skippedTombstone) return stats;
        if (run === null && stats.wrote === true) {
          this.rememberKeptPath(workspaceRoot, identity, filePath);
        }
        this.recordWrite(workspaceRoot, identity, stats.outcome, run);
        return stats;
      });
    } finally {
      const left = (this.pendingWrites.get(rootKey) ?? 1) - 1;
      if (left > 0) this.pendingWrites.set(rootKey, left);
      else this.pendingWrites.delete(rootKey);
    }
  }

  /** Counts an unsupported file of the run by its language. */
  private countUnsupported(run: IndexRun, filePath: string): void {
    const key: UnsupportedLanguageKey =
      languageForExtension(path.extname(filePath)) ?? 'other';
    run.unsupported++;
    run.unsupportedByLanguage[key] = (run.unsupportedByLanguage[key] ?? 0) + 1;
  }

  /**
   * Discovery and the batch loop of one run. `complete` is false when
   * discovery failed; an abort or a total failure throws.
   */
  private async runIndex(
    workspaceRoot: string,
    run: IndexRun,
    options: CodeSymbolIndexerOptions | undefined,
    active: ActiveCensus,
  ): Promise<{ stats: IndexingStats; complete: boolean }> {
    const startMs = Date.now();
    const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
    const maxFilesPerRun = options?.maxFilesPerRun;
    const eligible: Array<{
      readonly path: string;
      readonly size: number;
      /** Discovery could not stat it (locked, permission denied). */
      readonly unreadable: boolean;
    }> = [];
    const presentPaths: string[] = [];
    const seenPresent = new Set<string>();
    /** Classify one discovered file; every path is recorded as present on disk. */
    const consider = (
      filePath: string,
      size: number,
      unreadable: boolean,
    ): void => {
      const normalized = normalizeIndexPath(filePath);
      if (!seenPresent.has(normalized)) {
        seenPresent.add(normalized);
        presentPaths.push(normalized);
      }
      const fileClass = classifyFileForCoverage(filePath, 'codeIndex');
      if (fileClass === 'unsupported') {
        this.countUnsupported(run, filePath);
        return;
      }
      if (fileClass !== 'eligible' || shouldSkipFile(filePath)) return;
      eligible.push({ path: normalized, size, unreadable });
    };

    try {
      const stream = this.indexer.indexWorkspaceStream({
        includePatterns: [...DISCOVERY_PATTERNS],
        respectIgnoreFiles: true,
        workspaceFolder: workspaceRoot,
        // Every size: an over-size file is counted as `too-large` below
        // instead of being dropped by the stream without a count.
        maxFileSize: Number.MAX_SAFE_INTEGER,
        // A locked file is counted as `failed` (`read`), not lost.
        onUnreadableEntry: (filePath) => {
          consider(filePath, 0, true);
        },
      });

      // The skip filter runs before any optional cap, so config, test and
      // generated files never use the eligible-only budget. Discovery
      // always finishes so `omittedByCap` is a real count.
      for await (const file of stream) {
        consider(file.path, file.size, false);
      }
    } catch (error: unknown) {
      // The root's coverage stays `incomplete` with an unknown census.
      this.logger.warn('[CodeSymbolIndexer] Error during file discovery', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        stats: {
          filesScanned: 0,
          symbolsIndexed: 0,
          errors: 1,
          durationMs: Date.now() - startMs,
        },
        complete: false,
      };
    }

    eligible.sort((a, b) => compareDiscoveryOrder(a.path, b.path));
    let files = eligible;
    let truncated = false;
    let omittedByCap = 0;
    if (maxFilesPerRun !== undefined && eligible.length > maxFilesPerRun) {
      truncated = true;
      omittedByCap = eligible.length - maxFilesPerRun;
      files = eligible.slice(0, maxFilesPerRun);
    }

    run.census = truncated ? 'truncated' : 'complete';
    run.omittedByCap = omittedByCap;
    if (truncated) run.censusLimit = maxFilesPerRun;
    run.selected = files.map((file) => graphPathIdentity(file.path));

    let totalSymbols = 0;
    let totalErrors = 0;
    let attempted = 0;

    let filesProcessed = 0;
    // Before any write, after every batch (including the last), and again
    // immediately before purge. A cancel during the only or last batch used
    // to fall through into purgeAbsentPaths.
    this.throwIfAborted(options?.signal);
    for (let i = 0; i < files.length; i += batchSize) {
      if (!active.userInitiated) await this.yieldToForeground(options?.signal);
      this.throwIfAborted(options?.signal);
      const batch = files.slice(i, i + batchSize);

      for (const file of batch) {
        if (file.unreadable || file.size > MAX_INDEXED_FILE_BYTES) {
          this.recordWrite(
            workspaceRoot,
            graphPathIdentity(file.path),
            failure(file.unreadable ? 'read' : 'too-large'),
            run,
          );
        } else {
          const stats = await this.indexFileRecorded(
            file.path,
            workspaceRoot,
            run,
          );
          totalSymbols += stats.symbolsIndexed;
          totalErrors += stats.errors;
          attempted++;
        }
        filesProcessed++;
      }

      const progress = {
        filesScanned: filesProcessed,
        totalFiles: files.length,
        symbolsIndexed: totalSymbols,
        currentFile: batch[batch.length - 1]?.path ?? '',
      };
      for (const listener of active.progressListeners) {
        try {
          listener(progress);
        } catch (error: unknown) {
          if (active.warnedProgressListeners.has(listener)) continue;
          active.warnedProgressListeners.add(listener);
          this.logger.warn('[CodeSymbolIndexer] Progress listener failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (i + batchSize < files.length) {
        await yieldToEventLoop();
      }
      this.throwIfAborted(options?.signal);
    }

    const durationMs = Date.now() - startMs;

    // A cancelled run throws AbortError, including when this was the only
    // or last batch. It must not be reported as a finished index.
    this.throwIfAborted(options?.signal);

    if (attempted > 0 && totalSymbols === 0 && totalErrors === attempted) {
      throw new Error(
        `Code symbol indexing failed: all ${totalErrors} files errored and 0 symbols were produced. ` +
          `This usually means the tree-sitter WASM runtime or the symbol sink failed to initialize — check the logs for the underlying error.`,
      );
    }

    // Truncated, discovery-failed (returned above), and aborted (thrown
    // above) runs never reach this. A governor AbortError is thrown from
    // yieldToForeground and likewise never purges.
    this.throwIfAborted(options?.signal);
    if (run.census === 'complete') {
      this.purgeAbsentPaths(workspaceRoot, presentPaths, run);
    }

    this.logger.info('[CodeSymbolIndexer] Workspace indexing complete', {
      filesScanned: files.length,
      symbolsIndexed: totalSymbols,
      errors: totalErrors,
      durationMs,
    });

    return {
      stats: {
        filesScanned: files.length,
        symbolsIndexed: totalSymbols,
        errors: totalErrors,
        durationMs,
      },
      complete: true,
    };
  }

  /**
   * Wait until background work may start its next batch.
   *
   * `isClear()` first, so an idle host pays no promise per batch. A governor
   * `AbortError` (its `dispose()` at shutdown, or `signal`) is rethrown as the
   * `DOMException` the batch-boundary check throws, so callers see one abort
   * shape; it is logged at debug only — a shutdown mid-index is not an error.
   * A `'timeout'` (the governor's starvation ceiling) proceeds; the governor
   * logs that itself. Any other rejection is a governor defect: warn once per
   * indexer and run the batch (fail open), the rule every adopter follows.
   */
  private async yieldToForeground(
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const governor = this.governor;
    if (governor === null || governor.isClear()) return;
    try {
      await governor.whenClear({
        ...(signal ? { signal } : {}),
        lane: GOVERNOR_LANE,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.debug?.(
          '[CodeSymbolIndexer] Stopped while waiting for background work to clear',
          { reason: error.message },
        );
        throw new DOMException('Aborted', 'AbortError');
      }
      if (this.governorFailureWarned) return;
      this.governorFailureWarned = true;
      this.logger.warn(
        '[CodeSymbolIndexer] background-work wait failed — indexing anyway',
        { reason: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * Re-index a single file (called on file save events).
   * Returns per-file stats including a durationMs measurement.
   * Non-fatal — errors are logged as warnings and reflected in returned stats.
   *
   * The write waits for any running write of the same file (a full run's
   * included) and its outcome updates the root's coverage — folded into a
   * running full run, or into the per-file record — but never turns an
   * unknown or incomplete census complete; only a successful full run does.
   */
  /**
   * Delete one file's rows after every earlier write of that file has
   * finished, and tombstone the path on every census still running for the
   * root. The lock identity matches `reindexFile`. A later successful
   * non-census `reindexFile` of the same path clears the tombstone.
   */
  deleteFileSymbols(
    filePath: string,
    workspaceRoot: string,
  ): Promise<number> {
    return Promise.resolve().then(() => {
      const normalized = filePath.replace(/\\/g, '/');
      const identity = graphPathIdentity(normalized);
      return this.withFileLock(identity, () =>
        Promise.resolve().then(() => {
          this.rememberTombstone(workspaceRoot, identity);
          return this.sink.deleteSymbolsForFile(normalized, workspaceRoot);
        }),
      );
    });
  }

  async reindexFile(
    absoluteFilePath: string,
    workspaceRoot: string,
  ): Promise<SingleFileReindex> {
    if (shouldSkipFile(absoluteFilePath)) {
      this.logger.debug?.(
        `[CodeSymbolIndexer] reindexFile skipped (matches skip pattern): ${path.basename(absoluteFilePath)}`,
      );
      return {
        coverage: singleFileCoverage(absoluteFilePath, 'excluded'),
        symbolsIndexed: 0,
        errors: 0,
        durationMs: 0,
      };
    }
    const normalizedFilePath = absoluteFilePath.replace(/\\/g, '/');
    const startMs = Date.now();
    try {
      const { symbolsIndexed, errors, durationMs, outcome } =
        await this.indexFileRecorded(normalizedFilePath, workspaceRoot, null);
      return {
        coverage: singleFileCoverage(normalizedFilePath, outcome),
        symbolsIndexed,
        errors,
        durationMs,
      };
    } catch (error: unknown) {
      this.logger.warn('[CodeSymbolIndexer] reindexFile failed (non-fatal)', {
        file: normalizedFilePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        coverage: singleFileCoverage(normalizedFilePath, failure('parse')),
        symbolsIndexed: 0,
        errors: 1,
        durationMs: Date.now() - startMs,
      };
    }
  }

  /** A cancelled run throws AbortError and must not purge. */
  private throwIfAborted(signal: AbortSignal | undefined): void {
    if (!signal?.aborted) return;
    this.logger.debug?.(
      '[CodeSymbolIndexer] Abort signal received — stopping before purge',
    );
    throw new DOMException('Aborted', 'AbortError');
  }

  /**
   * Per-file write. {@link ISymbolSink.replaceFileSymbols} is one
   * transaction in the store, so a failed insert keeps the previous rows.
   */
  private async writeFileSymbols(
    filePath: string,
    workspaceRoot: string,
    chunks: readonly SymbolChunkInsert[],
  ): Promise<void> {
    await this.sink.replaceFileSymbols(workspaceRoot, filePath, chunks);
  }

  /**
   * Paths the purge must treat as present: discovery's snapshot, plus store
   * paths a non-census reindex wrote during this run, minus deletion
   * tombstones. Tombstoned paths are omitted even when discovery saw them,
   * so the purge removes their rows. No path is statted.
   */
  private purgePresentPaths(
    presentPaths: readonly string[],
    run: IndexRun,
  ): readonly string[] {
    if (run.tombstones.size === 0 && run.keptPaths.size === 0) {
      return presentPaths;
    }
    const kept: string[] = [];
    for (const filePath of presentPaths) {
      if (!run.tombstones.has(graphPathIdentity(filePath))) {
        kept.push(filePath);
      }
    }
    const seen = new Set(kept.map((filePath) => graphPathIdentity(filePath)));
    for (const [identity, storePath] of run.keptPaths) {
      if (run.tombstones.has(identity) || seen.has(identity)) continue;
      kept.push(storePath);
      seen.add(identity);
    }
    return kept;
  }

  private purgeAbsentPaths(
    workspaceRoot: string,
    presentPaths: readonly string[],
    run: IndexRun,
  ): void {
    let deleted: number;
    try {
      deleted = this.sink.purgeMissing(
        workspaceRoot,
        this.purgePresentPaths(presentPaths, run),
      );
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        '[CodeSymbolIndexer] Failed to purge missing paths after a complete run',
        { error: reason },
      );
      throw err;
    }
    if (deleted > 0) {
      this.logger.debug?.(
        `[CodeSymbolIndexer] Purged ${deleted} symbol rows for paths absent from disk`,
      );
    }
  }

  /**
   * Index a single file: parse AST, then replace its symbol rows in one
   * write. Returns per-file stats including durationMs.
   *
   * `absoluteFilePath` must already be normalized to forward slashes before
   * calling this method (callers are responsible for normalization).
   */
  private async _indexFile(
    absoluteFilePath: string,
    workspaceRoot: string,
    run: IndexRun | null,
  ): Promise<FileStats> {
    const startMs = Date.now();
    const normalizedFilePath = absoluteFilePath.replace(/\\/g, '/');

    const ext = path.extname(normalizedFilePath);
    const language = extensionToLanguage(ext);
    if (!language) {
      return {
        symbolsIndexed: 0,
        errors: 0,
        durationMs: Date.now() - startMs,
        outcome: UNSUPPORTED,
      };
    }

    let content: string;
    try {
      content = await this.fs.readFile(normalizedFilePath);
    } catch (error: unknown) {
      this.logger.warn('[CodeSymbolIndexer] Could not read file (non-fatal)', {
        file: normalizedFilePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        symbolsIndexed: 0,
        errors: 1,
        durationMs: Date.now() - startMs,
        outcome: failure('read'),
      };
    }

    const result = await this.astAnalysis.analyzeSource(
      content,
      language,
      normalizedFilePath,
    );
    if (result.isErr()) {
      this.logger.warn(
        `[CodeSymbolIndexer] AST parse failed for ${normalizedFilePath}: ${result.error?.message ?? 'Unknown error'}`,
      );
      return {
        symbolsIndexed: 0,
        errors: 1,
        durationMs: Date.now() - startMs,
        outcome: failure(parserFailureReason(result.error)),
      };
    }
    const insights = result.value;
    if (insights === undefined) {
      return {
        symbolsIndexed: 0,
        errors: 1,
        durationMs: Date.now() - startMs,
        outcome: failure('parse'),
      };
    }

    const relPath = path.relative(workspaceRoot, normalizedFilePath);

    const chunks: SymbolChunkInsert[] = [];
    // The store keys a row by (workspace root, subject) and overwrites on
    // conflict, so two declarations sharing a kind and name in one file (Java
    // overloads, one Rust type's several `impl` blocks, TS overload
    // signatures) must not share a subject. The first keeps the plain
    // subject; each later one adds its 1-based start line (Batch 30 r1
    // R30-02). Declarations are visited in source order, so the subjects are
    // stable across re-indexes of an unchanged file.
    const subjects = new Set<string>();
    const uniqueSubject = (base: string, startLine: number): string => {
      let subject = base;
      if (subjects.has(subject)) {
        subject = `${base}@${startLine + 1}`;
        for (let n = 2; subjects.has(subject); n++) {
          subject = `${base}@${startLine + 1}.${n}`;
        }
      }
      subjects.add(subject);
      return subject;
    };
    for (const fn of insights.functions) {
      const name = fn.name;
      const startLine = fn.startLine ?? 0;
      const endLine = fn.endLine ?? startLine;
      const text = `function ${name} in ${relPath}:${startLine}-${endLine}`;
      chunks.push({
        subject: uniqueSubject(
          `code:function:${normalizedFilePath}:${name}`,
          startLine,
        ),
        kind: 'function',
        symbolName: name,
        text,
        tokenCount: Math.ceil(text.length / 4),
        filePath: normalizedFilePath,
        workspaceRoot,
      });
    }
    for (const cls of insights.classes) {
      const className = cls.name;
      const classStartLine = cls.startLine ?? 0;
      const classEndLine = cls.endLine ?? classStartLine;
      const classText = `class ${className} in ${relPath}:${classStartLine}-${classEndLine}`;
      chunks.push({
        subject: uniqueSubject(
          `code:class:${normalizedFilePath}:${className}`,
          classStartLine,
        ),
        kind: 'class',
        symbolName: className,
        text: classText,
        tokenCount: Math.ceil(classText.length / 4),
        filePath: normalizedFilePath,
        workspaceRoot,
      });
      if (cls.methods) {
        for (const method of cls.methods) {
          const methodName = method.name;
          const methodStartLine = method.startLine ?? 0;
          const methodEndLine = method.endLine ?? methodStartLine;
          const methodText = `method ${className}.${methodName} in ${relPath}:${methodStartLine}-${methodEndLine}`;
          chunks.push({
            subject: uniqueSubject(
              `code:method:${normalizedFilePath}:${className}.${methodName}`,
              methodStartLine,
            ),
            kind: 'method',
            symbolName: `${className}.${methodName}`,
            text: methodText,
            tokenCount: Math.ceil(methodText.length / 4),
            filePath: normalizedFilePath,
            workspaceRoot,
          });
        }
      }
    }

    // Every other export (TASK_2026_559 Batch 24d): interfaces, type
    // aliases, enums, variables, namespaces and export-clause names. A row is
    // skipped only when the same kind and name already has one (an exported
    // function or class declaration): a same-named symbol of another kind or
    // scope is a different symbol, so both keep their rows.
    for (const info of insights.exports ?? []) {
      if (!isIndexableExportName(info)) continue;
      const rows = exportRowRange(info);
      const startLine = rows?.startLine ?? 0;
      const endLine = rows?.endLine ?? startLine;
      const kind = exportRowKind(info);
      const subject = `code:${kind}:${normalizedFilePath}:${info.name}`;
      if (subjects.has(subject)) continue;
      subjects.add(subject);
      const text =
        `${kind} ${info.name}` +
        (info.localName === undefined ? '' : ` = ${info.localName}`) +
        (info.source === undefined ? '' : ` from ${info.source}`) +
        ` in ${relPath}:${startLine}-${endLine}`;
      chunks.push({
        subject,
        kind,
        symbolName: info.name,
        text,
        tokenCount: Math.ceil(text.length / 4),
        filePath: normalizedFilePath,
        workspaceRoot,
      });
    }

    // Inside the file lock, after the read. A delete that ran once the
    // read had the content (or that won the lock earlier) wins: do not
    // put the census snapshot back.
    if (
      run !== null &&
      run.tombstones.has(graphPathIdentity(normalizedFilePath))
    ) {
      return {
        symbolsIndexed: 0,
        errors: 0,
        durationMs: Date.now() - startMs,
        outcome: UNCHECKED,
        skippedTombstone: true,
      };
    }

    try {
      await this.writeFileSymbols(normalizedFilePath, workspaceRoot, chunks);
    } catch (writeError: unknown) {
      const msg =
        writeError instanceof Error ? writeError.message : String(writeError);
      this.logger.warn(
        `[CodeSymbolIndexer] Failed to write symbols for ${normalizedFilePath}: ${msg}`,
      );
      return {
        symbolsIndexed: 0,
        errors: 1,
        durationMs: Date.now() - startMs,
        outcome: failure('write'),
      };
    }

    return {
      symbolsIndexed: chunks.length,
      // A recovered parse is a failure even though its symbols are written.
      errors: insights.parseStatus === 'recovered' ? 1 : 0,
      durationMs: Date.now() - startMs,
      outcome: outcomeOfParse(insights),
      wrote: true,
    };
  }
}
