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
   * Most indexable files one run processes, counted after the skip filter
   * (config, test and generated files never use the budget). Past it the
   * run's census is `truncated`. Default: 2000
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
const DEFAULT_MAX_FILES = 2000;
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
  /** Path identities the run set out to index. */
  selected: string[];
  unsupported: number;
  unsupportedByLanguage: Partial<Record<UnsupportedLanguageKey, number>>;
  /** Writes this run made, by path identity. */
  readonly writes: Map<string, RecordedWrite>;
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
  /** The run currently writing this root; a newer run supersedes it. */
  active: IndexRun | null;
  /** The last run that ended, and how. Dropped when a new run begins. */
  settled: {
    readonly run: IndexRun;
    readonly state: 'current' | 'incomplete';
  } | null;
  /**
   * Writes made outside the active run (a per-file reindex, a superseded
   * run) since the last run began, by path identity. Bounded by
   * {@link PER_FILE_RECORD_LIMIT}.
   */
  readonly perFile: Map<string, RecordedWrite>;
  /** The per-file record hit its limit and stopped tracking new files. */
  perFileTruncated: boolean;
  /**
   * Runs of this root still in progress, the superseded ones included: a
   * superseded run keeps writing until it ends.
   */
  readonly runsInProgress: Set<IndexRun>;
}

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
   * Tail of the write chain per file identity (see {@link withFileLock}); an
   * entry lives only while a write of that file is running or queued.
   */
  private readonly fileLocks = new Map<string, Promise<void>>();
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
   * normally ends `current`; an abort, a failed discovery or a thrown error
   * ends `incomplete`, which stays until a later run succeeds.
   */
  async indexWorkspace(
    workspaceRoot: string,
    options?: CodeSymbolIndexerOptions,
  ): Promise<IndexingStats> {
    if (!workspaceRoot) {
      this.logger.warn(
        '[CodeSymbolIndexer] indexWorkspace called with empty workspaceRoot — skipping',
      );
      return { filesScanned: 0, symbolsIndexed: 0, errors: 0, durationMs: 0 };
    }

    const run = this.beginRun(workspaceRoot);
    let state: 'current' | 'incomplete' = 'incomplete';
    try {
      const { stats, complete } = await this.runIndex(
        workspaceRoot,
        run,
        options,
      );
      if (complete) state = 'current';
      return stats;
    } finally {
      this.settleRun(workspaceRoot, run, state);
    }
  }

  /**
   * The live coverage of the code index for `workspaceRoot` in this host
   * session. It describes the last full run plus every file write since that
   * run began; it never claims to be a snapshot of the SQLite rows.
   *
   * - No run in this session: `census: 'unknown'`, no `state`, counts `null`.
   * - A run is writing: `state: 'updating'`, counts `null` (the previous
   *   run's counts were dropped when it began).
   * - The last run succeeded: `state: 'current'`; it failed or was aborted:
   *   `state: 'incomplete'`, with its files not yet written in `unchecked`.
   * - `unrecognised`, `nonSource` and `excluded` are `null`: discovery asks
   *   only for recognised source extensions and drops ignored and default-
   *   excluded paths itself, so those files are never observed.
   */
  getCoverage(workspaceRoot: string): LanguageCoverage {
    const record = this.roots.get(graphPathIdentity(workspaceRoot));
    if (record === undefined) return unknownCoverage();
    if (record.active !== null) return unknownCoverage('updating');
    if (record.settled === null) return unknownCoverage();
    const { run } = record.settled;
    // A per-file write or a superseded run still writing: the rows a search
    // reads may be mid-change (cleared, not yet re-inserted).
    const writing =
      (this.pendingWrites.get(graphPathIdentity(workspaceRoot)) ?? 0) > 0 ||
      record.runsInProgress.size > 0;
    const state =
      writing && record.settled.state === 'current'
        ? 'updating'
        : record.settled.state;
    if (run.census === null) return unknownCoverage(state);

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
      census: record.perFileTruncated ? 'truncated' : run.census,
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
      // Discovery stopped at the cap, so how many more were eligible is unknown.
      omittedByCap: run.census === 'truncated' ? null : 0,
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
   * Starts a run for `workspaceRoot`: synchronous, so it holds before any
   * write. The run supersedes one still running for the root (that run's
   * later writes count as per-file writes and its end changes nothing), and
   * the previous run's counts and per-file record are dropped.
   */
  private beginRun(workspaceRoot: string): IndexRun {
    const run: IndexRun = {
      census: null,
      selected: [],
      unsupported: 0,
      unsupportedByLanguage: {},
      writes: new Map(),
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

  /** Ends `run` for its root, unless a newer run superseded it. */
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
   * run is that run's; any other write (a per-file reindex, a superseded run)
   * goes to the per-file record, and the latest write of a file wins when
   * coverage is read. A root with no record (no run in this session) gets
   * none: a per-file write never creates a census.
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
    const previous = this.fileLocks.get(identity) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => done);
    this.fileLocks.set(identity, tail);
    await previous;
    try {
      return await write();
    } finally {
      release();
      if (this.fileLocks.get(identity) === tail) {
        this.fileLocks.delete(identity);
      }
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
        const stats = await this._indexFile(filePath, workspaceRoot);
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
  ): Promise<{ stats: IndexingStats; complete: boolean }> {
    const startMs = Date.now();
    const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
    const maxFilesPerRun = options?.maxFilesPerRun ?? DEFAULT_MAX_FILES;
    const files: Array<{
      readonly path: string;
      readonly size: number;
      /** Discovery could not stat it (locked, permission denied). */
      readonly unreadable: boolean;
    }> = [];
    let truncated = false;
    /** Classify one discovered file; false once the eligible cap is passed. */
    const consider = (
      filePath: string,
      size: number,
      unreadable: boolean,
    ): boolean => {
      const fileClass = classifyFileForCoverage(filePath, 'codeIndex');
      if (fileClass === 'unsupported') {
        this.countUnsupported(run, filePath);
        return true;
      }
      if (fileClass !== 'eligible' || shouldSkipFile(filePath)) return true;
      if (files.length >= maxFilesPerRun) {
        truncated = true;
        return false;
      }
      files.push({ path: filePath, size, unreadable });
      return true;
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
          if (!truncated) consider(filePath, 0, true);
        },
      });

      // The skip filter runs before the cap, so config, test and generated
      // files never use the eligible-only budget.
      for await (const file of stream) {
        if (!consider(file.path, file.size, false)) break;
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

    run.census = truncated ? 'truncated' : 'complete';
    if (truncated) run.censusLimit = maxFilesPerRun;
    run.selected = files.map((file) => graphPathIdentity(file.path));

    let totalSymbols = 0;
    let totalErrors = 0;
    let attempted = 0;

    const governed = options?.userInitiated !== true;
    let filesProcessed = 0;
    for (let i = 0; i < files.length; i += batchSize) {
      if (governed) await this.yieldToForeground(options?.signal);
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

      if (options?.onProgress) {
        options.onProgress({
          filesScanned: filesProcessed,
          totalFiles: files.length,
          symbolsIndexed: totalSymbols,
          currentFile: batch[batch.length - 1]?.path ?? '',
        });
      }

      if (i + batchSize < files.length) {
        await yieldToEventLoop();
        if (options?.signal?.aborted) {
          this.logger.debug?.(
            '[CodeSymbolIndexer] Abort signal received at batch boundary — stopping early',
          );
          throw new DOMException('Aborted', 'AbortError');
        }
      }
    }

    const durationMs = Date.now() - startMs;

    if (attempted > 0 && totalSymbols === 0 && totalErrors === attempted) {
      throw new Error(
        `Code symbol indexing failed: all ${totalErrors} files errored and 0 symbols were produced. ` +
          `This usually means the tree-sitter WASM runtime or the symbol sink failed to initialize — check the logs for the underlying error.`,
      );
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

  /**
   * Index a single file: parse AST, delete stale symbols, insert new ones.
   * Returns per-file stats including durationMs.
   *
   * `absoluteFilePath` must already be normalized to forward slashes before
   * calling this method (callers are responsible for normalization).
   */
  private async _indexFile(
    absoluteFilePath: string,
    workspaceRoot: string,
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
    try {
      const deletedCount = this.sink.deleteSymbolsForFile(
        normalizedFilePath,
        workspaceRoot,
      );
      if (deletedCount > 0) {
        this.logger.debug?.(
          `[CodeSymbolIndexer] Cleared ${deletedCount} stale entries for ${normalizedFilePath}`,
        );
      }
    } catch (err: unknown) {
      this.logger.warn(
        `[CodeSymbolIndexer] Failed to clear stale entries for ${normalizedFilePath}`,
        { error: err instanceof Error ? err.message : String(err) },
      );
      return {
        symbolsIndexed: 0,
        errors: 1,
        durationMs: Date.now() - startMs,
        outcome: failure('write'),
      };
    }

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

    if (chunks.length > 0) {
      try {
        await this.sink.insertSymbols(chunks);
      } catch (insertError: unknown) {
        const msg =
          insertError instanceof Error
            ? insertError.message
            : String(insertError);
        this.logger.warn(
          `[CodeSymbolIndexer] Symbols deleted but insert failed for ${normalizedFilePath}: ${msg}. Re-index this file to recover.`,
        );
        return {
          symbolsIndexed: 0,
          errors: 1,
          durationMs: Date.now() - startMs,
          outcome: failure('write'),
        };
      }
    }

    return {
      symbolsIndexed: chunks.length,
      // A recovered parse is a failure even though its symbols are written.
      errors: insights.parseStatus === 'recovered' ? 1 : 0,
      durationMs: Date.now() - startMs,
      outcome: outcomeOfParse(insights),
    };
  }
}
