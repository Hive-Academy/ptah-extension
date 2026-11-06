/**
 * IndexingControlService — user-controlled workspace indexing state machine.
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  normalizeWorkspaceRoot,
} from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
  VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import { WebviewManager } from '@ptah-extension/vscode-core';
import { MEMORY_TOKENS } from '../di/tokens';
import { MemoryCuratorService } from '../memory-curator.service';
import { EmbedderStatusService } from '../embedder/embedder-status.service';
import {
  MEMORY_TRIGGER_DEFAULTS,
  MEMORY_TRIGGER_KEYS,
  MEMORY_TRIGGER_SECTION,
} from '../triggers/memory-trigger-config';
import {
  deriveWorkspaceFingerprint,
  deriveGitHeadSha,
} from '../workspace-fingerprint';
import {
  MESSAGE_TYPES,
  type IndexingState,
  type IndexingPipeline,
  type SymbolsCursor,
  type IndexingProgressEvent,
  type IndexingCompleteEvent,
  type IndexingFailedEvent,
  type IndexingRunWire,
  type IndexingLastRunWire,
} from '@ptah-extension/shared';

export type { IndexingState, IndexingPipeline, SymbolsCursor };
export type { IndexingProgressEvent, IndexingCompleteEvent };

export interface IndexingStatus {
  state: IndexingState;
  /** The live census for this root (manual, joined or background); null when idle. */
  running: IndexingRunWire | null;
  /** Summary of the last settled census for this workspace; null when none or unreadable. */
  lastRun: IndexingLastRunWire | null;
  workspaceFingerprint: string;
  gitHeadSha: string | null;
  currentGitHeadSha: string | null;
  lastIndexedAt: number | null;
  symbolsEnabled: boolean;
  memoryEnabled: boolean;
  symbolsCursor: SymbolsCursor | null;
  disclosureAcknowledgedAt: number | null;
  lastDismissedStaleSha: string | null;
  errorMessage: string | null;
  codeSymbolCount: number;
  memoryChunkCount: number;
  /** Distinct files with symbols for this workspace; undefined when the count read fails. */
  fileCount?: number;
  vec: {
    ok: boolean;
    reason?: string;
    attemptedPath?: string;
  };
  embedder: {
    ready: boolean;
    downloading?: boolean;
    progress?: { loaded: number; total: number; percent: number };
  };
}

/** Structural copy of the code-symbol indexer's per-run stats. */
export interface IndexingRunStats {
  filesScanned: number;
  symbolsIndexed: number;
  errors: number;
  durationMs: number;
}

/** One batch boundary reported by the code-symbol indexer. */
export interface IndexingRunProgress {
  filesScanned: number;
  totalFiles: number;
}

/** Callable dependencies injected at start() call time (avoids workspace-intelligence import cycle). */
export interface IndexingRunDeps {
  /**
   * Runs the code-symbol indexer for the given workspace, honoring the abort
   * signal and reporting batch progress through `onProgress`. Resolves with
   * the indexer's stats; rejects with an `AbortError` when aborted.
   */
  runSymbols: (
    workspaceRoot: string,
    options?: {
      signal?: AbortSignal;
      onProgress?: (progress: IndexingRunProgress) => void;
    },
  ) => Promise<IndexingRunStats | void>;
  /** Runs memory curation pass (optional; curator lifecycle is managed separately). */
  runMemory?: (workspaceRoot: string) => Promise<void>;
}

type CensusOrigin = 'manual' | 'background';

/** Why an abort happened: the user's pause, the user's cancel, or anything else. */
type AbortCause = 'pause' | 'cancel' | 'other';

type ParticipantOutcome =
  | { readonly kind: 'succeeded'; readonly stats: IndexingRunStats | null }
  | { readonly kind: 'failed'; readonly error: unknown }
  | { readonly kind: 'aborted'; readonly cause: AbortCause };

/**
 * One full symbols census for one normalized root, shared by every manual or
 * background caller that joins it before it closes. It settles exactly once,
 * when its last participant releases.
 */
interface CensusRecord {
  readonly rootKey: string;
  readonly workspaceRoot: string;
  readonly fp: string;
  readonly gitHeadSha: string | null;
  readonly origin: CensusOrigin;
  readonly startedAt: number;
  readonly force: boolean;
  /** Joinable. False once any symbols phase settled without an abort. */
  open: boolean;
  /** Live (not yet released) participants. */
  readonly participants: Set<CensusParticipant>;
  /** Released outcomes, in release order. */
  readonly outcomes: Array<{
    readonly origin: CensusOrigin;
    readonly outcome: ParticipantOutcome;
  }>;
  lastProgress: IndexingRunProgress | null;
  /** The one progress handler every participant's indexer call receives. */
  readonly onProgress: (progress: IndexingRunProgress) => void;
}

interface CensusParticipant {
  readonly record: CensusRecord;
  readonly origin: CensusOrigin;
  released: boolean;
}

const LAST_RUN_ORIGINS: ReadonlySet<unknown> = new Set([
  'manual',
  'background',
]);
const LAST_RUN_OUTCOMES: ReadonlySet<unknown> = new Set([
  'succeeded',
  'failed',
  'cancelled',
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

/** Hand-written guard for the persisted `last_run_json` value (this lib has no zod). */
function isLastRunWire(value: unknown): value is IndexingLastRunWire {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    LAST_RUN_ORIGINS.has(v['origin']) &&
    LAST_RUN_OUTCOMES.has(v['outcome']) &&
    isFiniteNumber(v['startedAt']) &&
    isFiniteNumber(v['finishedAt']) &&
    isFiniteNumber(v['durationMs']) &&
    isOptionalFiniteNumber(v['filesScanned']) &&
    isOptionalFiniteNumber(v['symbolsIndexed']) &&
    isOptionalFiniteNumber(v['errors'])
  );
}

/** Picks the indexer stats out of an untyped run result, or null. */
function toRunStats(value: unknown): IndexingRunStats | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    isFiniteNumber(v['filesScanned']) &&
    isFiniteNumber(v['symbolsIndexed']) &&
    isFiniteNumber(v['errors']) &&
    isFiniteNumber(v['durationMs'])
  ) {
    return {
      filesScanned: v['filesScanned'],
      symbolsIndexed: v['symbolsIndexed'],
      errors: v['errors'],
      durationMs: v['durationMs'],
    };
  }
  return null;
}

/**
 * Structural: a `DOMException` is not always `instanceof Error` (it can come
 * from another realm), so only the `name` is checked.
 */
function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'DOMException';
}

function abortCauseOf(signal: AbortSignal): AbortCause {
  return signal.reason === 'pause' || signal.reason === 'cancel'
    ? signal.reason
    : 'other';
}

interface IndexingStateRow {
  workspace_fingerprint: string;
  git_head_sha: string | null;
  last_indexed_at: number | null;
  symbols_enabled: number;
  memory_enabled: number;
  symbols_cursor: string | null;
  disclosure_acknowledged_at: number | null;
  last_dismissed_stale_sha: string | null;
  last_error: string | null;
  /** JSON `IndexingLastRunWire` (migration 0067). */
  last_run_json: string | null;
}

/** SQLite stores booleans as 0/1. */
function boolToInt(v: boolean): number {
  return v ? 1 : 0;
}

/**
 * Infer the logical IndexingState from the raw DB row.
 * There is no `state` column — the state is derived from the row's values
 * combined with the current git HEAD SHA.
 */
function deriveStateFromRow(
  row: IndexingStateRow,
  currentSha: string | null,
): IndexingState {
  if (row.last_error) return 'error';
  if (row.symbols_cursor) return 'paused';
  if (!row.last_indexed_at) return 'never-indexed';
  if (row.git_head_sha && currentSha && row.git_head_sha !== currentSha) {
    return 'stale';
  }

  return 'indexed';
}

@injectable()
export class IndexingControlService {
  /** Active AbortController for the current run. Null when not running. */
  private activeAbortController: AbortController | null = null;
  /** State of the currently running index. Used to restore on cancel. */
  private preIndexState: IndexingState = 'never-indexed';
  /** Current active workspace fingerprint (set during a run). */
  private activeWorkspaceFp: string | null = null;
  /** Chokidar-style watcher reference — stopped when symbols pipeline is disabled. */
  private symbolWatcher: { close: () => void } | null = null;
  /** Progress event listeners. */
  private readonly progressListeners: Array<
    (event: IndexingProgressEvent) => void
  > = [];
  /** Joinable census records, keyed by `normalizeWorkspaceRoot(root)`. */
  private readonly openCensuses = new Map<string, CensusRecord>();
  /** Every record with a live participant, open or closed. */
  private readonly liveCensuses = new Set<CensusRecord>();

  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly sqlite: SqliteConnectionService,
    @inject(MEMORY_TOKENS.MEMORY_CURATOR)
    private readonly memoryCurator: MemoryCuratorService,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(PERSISTENCE_TOKENS.VEC_STATUS)
    private readonly vecStatus: VecStatusService,
    @inject(MEMORY_TOKENS.EMBEDDER_STATUS)
    private readonly embedderStatus: EmbedderStatusService,
  ) {}

  /** Synchronous status read — derive state from stored row + current git HEAD. */
  async getStatus(workspaceRoot: string): Promise<IndexingStatus> {
    const { fp } = await deriveWorkspaceFingerprint(workspaceRoot, this.fs);
    const currentSha = await deriveGitHeadSha(workspaceRoot, this.fs);
    const row = this.readRow(fp);
    const counts = this.readRowCounts();
    const fileCount = this.readFileCount(workspaceRoot);
    const vecSnapshot = this.vecStatus.getStatus();
    const vec = {
      ok: vecSnapshot.available,
      reason: vecSnapshot.reason,
      attemptedPath: vecSnapshot.diagnostic.attemptedPath,
    };
    const embedderSnapshot = this.embedderStatus.getStatus();
    const embedder: IndexingStatus['embedder'] = {
      ready: embedderSnapshot.ready,
      ...(embedderSnapshot.downloading
        ? { downloading: embedderSnapshot.downloading }
        : {}),
      ...(typeof embedderSnapshot.progress === 'number'
        ? {
            progress: {
              loaded: 0,
              total: 0,
              percent: Math.max(
                0,
                Math.min(100, Math.round(embedderSnapshot.progress * 100)),
              ),
            },
          }
        : {}),
    };

    const running = this.runningView(workspaceRoot);

    if (!row) {
      return {
        state: running ? 'indexing' : 'never-indexed',
        running,
        lastRun: null,
        workspaceFingerprint: fp,
        gitHeadSha: null,
        currentGitHeadSha: currentSha,
        lastIndexedAt: null,
        symbolsEnabled: true,
        memoryEnabled: true,
        symbolsCursor: null,
        disclosureAcknowledgedAt: null,
        lastDismissedStaleSha: null,
        errorMessage: null,
        codeSymbolCount: counts.codeSymbolCount,
        memoryChunkCount: counts.memoryChunkCount,
        ...(fileCount !== undefined ? { fileCount } : {}),
        vec,
        embedder,
      };
    }

    const state = running ? 'indexing' : deriveStateFromRow(row, currentSha);
    let symbolsCursor: SymbolsCursor | null = null;
    if (row.symbols_cursor) {
      try {
        symbolsCursor = JSON.parse(row.symbols_cursor) as SymbolsCursor;
      } catch {
        symbolsCursor = null;
      }
    }

    return {
      state,
      running,
      lastRun: this.readLastRun(row.last_run_json),
      workspaceFingerprint: fp,
      gitHeadSha: row.git_head_sha,
      currentGitHeadSha: currentSha,
      lastIndexedAt: row.last_indexed_at,
      symbolsEnabled: row.symbols_enabled === 1,
      memoryEnabled: row.memory_enabled === 1,
      symbolsCursor,
      disclosureAcknowledgedAt: row.disclosure_acknowledged_at,
      lastDismissedStaleSha: row.last_dismissed_stale_sha,
      errorMessage: row.last_error,
      codeSymbolCount: counts.codeSymbolCount,
      memoryChunkCount: counts.memoryChunkCount,
      ...(fileCount !== undefined ? { fileCount } : {}),
      vec,
      embedder,
    };
  }

  private readRowCounts(): {
    codeSymbolCount: number;
    memoryChunkCount: number;
  } {
    let codeSymbolCount = 0;
    let memoryChunkCount = 0;
    try {
      const csRow = this.sqlite.db
        .prepare('SELECT COUNT(*) AS n FROM code_symbols')
        .get() as { n: number } | undefined;
      codeSymbolCount = csRow?.n ?? 0;
    } catch (error: unknown) {
      this.logger.debug('[indexing-control] code_symbols count read failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      const mcRow = this.sqlite.db
        .prepare('SELECT COUNT(*) AS n FROM memory_chunks')
        .get() as { n: number } | undefined;
      memoryChunkCount = mcRow?.n ?? 0;
    } catch (error: unknown) {
      this.logger.debug('[indexing-control] memory_chunks count read failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return { codeSymbolCount, memoryChunkCount };
  }

  /**
   * Distinct files with at least one symbol for `workspaceRoot`.
   *
   * The indexer stores `workspace_root` exactly as its caller passed it, and
   * the boot run and the user-started run can receive the same folder as
   * different strings (separator, trailing slash, drive-letter case). The
   * exact spelling is tried first, as an index seek. Only when it has no rows
   * are the stored roots scanned (`SELECT DISTINCT` walks the whole index) and
   * matched through `normalizeWorkspaceRoot`. DISTINCT dedupes a file stored
   * under two root spellings, except when its `file_path` differs only in
   * drive-letter case.
   *
   * Returns `undefined` when a read fails, so the UI shows "unknown", not 0.
   */
  private readFileCount(workspaceRoot: string): number | undefined {
    try {
      const exact = this.countFilesUnder([workspaceRoot]);
      if (exact > 0) return exact;
      const target = normalizeWorkspaceRoot(workspaceRoot);
      const roots = (
        this.sqlite.db
          .prepare('SELECT DISTINCT workspace_root AS root FROM code_symbols')
          .all() as Array<{ root: string }>
      )
        .map((r) => r.root)
        .filter((root) => normalizeWorkspaceRoot(root) === target);
      return roots.length === 0 ? 0 : this.countFilesUnder(roots);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the file count is a display
      // figure; undefined makes the caption fall back to the project type.
      this.logger.debug('[indexing-control] code_symbols file count failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private countFilesUnder(roots: readonly string[]): number {
    const placeholders = roots.map(() => '?').join(', ');
    const row = this.sqlite.db
      .prepare(
        `SELECT COUNT(DISTINCT file_path) AS n FROM code_symbols WHERE workspace_root IN (${placeholders})`,
      )
      .get(...roots) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  /**
   * Start indexing pipelines.
   *
   * @param pipeline  Which pipeline(s) to run ('symbols', 'memory', or both when undefined).
   * @param workspaceRoot  Absolute path to the workspace root.
   * @param deps  Callable dependencies (avoids circular imports from workspace-intelligence).
   * @param options  Optional force flag — skip fingerprint check when true.
   */
  async start(
    pipeline: IndexingPipeline | 'both' | undefined,
    workspaceRoot: string,
    deps: IndexingRunDeps,
    options?: { force?: boolean },
  ): Promise<void> {
    if (this.activeAbortController) {
      this.logger.info('[indexing-control] start ignored — already running');
      return;
    }
    const controller = new AbortController();
    this.activeAbortController = controller;
    const { signal } = controller;
    // Set once this run has joined (or opened) its census record; the
    // `finally` releases it exactly once with `outcome`.
    let participant: CensusParticipant | null = null;
    let outcome: ParticipantOutcome | null = null;
    let fp: string | null = null;

    try {
      fp = (await deriveWorkspaceFingerprint(workspaceRoot, this.fs)).fp;
      this.logger.info('[indexing-control] start', {
        workspaceRoot,
        fingerprint: fp,
      });
      const currentSha = await deriveGitHeadSha(workspaceRoot, this.fs);
      const row = this.readRow(fp);
      if (this.activeAbortController === controller) {
        this.preIndexState = row
          ? deriveStateFromRow(row, currentSha)
          : 'never-indexed';
        this.activeWorkspaceFp = fp;
      }
      if (signal.aborted) return; // aborted before joining: nothing to release

      const runSymbols =
        !pipeline || pipeline === 'symbols' || pipeline === 'both';
      const runMemory =
        !pipeline || pipeline === 'memory' || pipeline === 'both';
      const force = options?.force === true;
      const symbolsPhase = runSymbols && (row?.symbols_enabled !== 0 || force);
      this.upsertRow(fp, {
        last_error: null,
        symbols_cursor: null,
      });

      // Joined synchronously right before the indexer call: no `await`
      // between here and `deps.runSymbols`. A run without a symbols phase
      // opens a closed record of its own that nobody can join.
      participant = this.joinCensus(
        workspaceRoot,
        fp,
        currentSha,
        'manual',
        force,
        symbolsPhase,
      );

      let stats: IndexingRunStats | null = null;
      if (symbolsPhase) {
        const symbols = await this.runSymbolsIndexWithProgress(
          workspaceRoot,
          deps,
          participant.record,
          fp,
          signal,
        );
        if (symbols.kind === 'aborted') {
          outcome = symbols;
          return; // paused or cancelled — state handled by pause()/cancel()
        }
        stats = symbols.stats;
      }

      if (
        runMemory &&
        (row?.memory_enabled !== 0 || force) &&
        (force || this.readMemoryEnabled())
      ) {
        if (deps.runMemory) {
          await deps.runMemory(workspaceRoot);
        }
      }

      if (signal.aborted) {
        outcome = { kind: 'aborted', cause: abortCauseOf(signal) };
        return;
      }
      this.upsertRow(fp, {
        git_head_sha: currentSha,
        last_indexed_at: Date.now(),
        last_error: null,
        symbols_cursor: null,
      });
      this.logger.info('[indexing-control] complete', {
        workspaceRoot,
        ...(stats ?? {}),
      });
      outcome = { kind: 'succeeded', stats };
    } catch (error: unknown) {
      if (participant === null) {
        // Setup failed before the run joined a census: no run state to
        // settle, so the caller (the RPC handler) receives the error.
        throw error;
      }
      if (signal.aborted) {
        outcome = { kind: 'aborted', cause: abortCauseOf(signal) };
        return; // pause() / cancel() already handled the state
      }
      const message = error instanceof Error ? error.message : String(error);
      if (fp !== null) this.upsertRow(fp, { last_error: message });
      // The census settle logs the warn and pushes INDEXING_FAILED once.
      outcome = { kind: 'failed', error };
    } finally {
      if (this.activeAbortController?.signal === signal) {
        this.activeAbortController = null;
        this.activeWorkspaceFp = null;
      }
      if (participant !== null) {
        this.releaseParticipant(
          participant,
          outcome ?? { kind: 'aborted', cause: abortCauseOf(signal) },
        );
      }
    }
  }

  /** True while a manual (user-started) run is active. */
  isRunning(): boolean {
    return this.activeAbortController !== null;
  }

  /**
   * Run a background (lifecycle / watcher) full index for `workspaceRoot`
   * inside the shared census registry. `run` receives the record's progress
   * handler and its resolution or rejection is returned unchanged. This never
   * writes `last_indexed_at` or `last_error`; the record's single settle
   * writes `lastRun` and pushes complete/failed.
   */
  async trackBackgroundRun<T>(
    workspaceRoot: string,
    run: (onProgress: (progress: IndexingRunProgress) => void) => Promise<T>,
  ): Promise<T> {
    const [{ fp }, gitHeadSha] = await Promise.all([
      deriveWorkspaceFingerprint(workspaceRoot, this.fs),
      deriveGitHeadSha(workspaceRoot, this.fs),
    ]);
    // No `await` between joining and calling `run`.
    const participant = this.joinCensus(
      workspaceRoot,
      fp,
      gitHeadSha,
      'background',
      false,
      true,
    );
    let result: T;
    try {
      result = await run(participant.record.onProgress);
    } catch (error: unknown) {
      this.releaseParticipant(
        participant,
        isAbortError(error)
          ? { kind: 'aborted', cause: 'other' }
          : { kind: 'failed', error },
      );
      throw error;
    }
    this.releaseParticipant(participant, {
      kind: 'succeeded',
      stats: toRunStats(result),
    });
    return result;
  }

  /**
   * Join the open census record for the root, or open a new one whose
   * origin, start time and force flag come from this caller. A manual caller
   * never shares a record with another live manual participant (a paused or
   * cancelled run that is still unwinding): it opens a newer record instead.
   */
  private joinCensus(
    workspaceRoot: string,
    fp: string,
    gitHeadSha: string | null,
    origin: CensusOrigin,
    force: boolean,
    joinable: boolean,
  ): CensusParticipant {
    const rootKey = normalizeWorkspaceRoot(workspaceRoot);
    const open = joinable ? this.openCensuses.get(rootKey) : undefined;
    const canJoin =
      open !== undefined && !(origin === 'manual' && this.hasLiveManual(open));
    const record = canJoin
      ? open
      : this.openRecord(rootKey, workspaceRoot, fp, gitHeadSha, origin, force);
    if (!canJoin) {
      if (joinable) this.openCensuses.set(rootKey, record);
      else record.open = false;
    }
    const participant: CensusParticipant = {
      record,
      origin,
      released: false,
    };
    record.participants.add(participant);
    return participant;
  }

  private openRecord(
    rootKey: string,
    workspaceRoot: string,
    fp: string,
    gitHeadSha: string | null,
    origin: CensusOrigin,
    force: boolean,
  ): CensusRecord {
    const startedAt = Date.now();
    const record: CensusRecord = {
      rootKey,
      workspaceRoot,
      fp,
      gitHeadSha,
      origin,
      startedAt,
      force,
      open: true,
      participants: new Set(),
      outcomes: [],
      lastProgress: null,
      onProgress: (progress) => {
        const last = record.lastProgress;
        if (
          last !== null &&
          last.filesScanned === progress.filesScanned &&
          last.totalFiles === progress.totalFiles
        ) {
          return; // the same batch, reported to another participant
        }
        record.lastProgress = {
          filesScanned: progress.filesScanned,
          totalFiles: progress.totalFiles,
        };
        this.emitProgress(this.toProgressEvent(progress, startedAt));
      },
    };
    this.liveCensuses.add(record);
    return record;
  }

  /** A symbols phase settled without an abort: later callers open a new census. */
  private closeRecord(record: CensusRecord): void {
    record.open = false;
    if (this.openCensuses.get(record.rootKey) === record) {
      this.openCensuses.delete(record.rootKey);
    }
  }

  private releaseParticipant(
    participant: CensusParticipant,
    outcome: ParticipantOutcome,
  ): void {
    if (participant.released) return;
    participant.released = true;
    const { record } = participant;
    record.participants.delete(participant);
    record.outcomes.push({ origin: participant.origin, outcome });
    if (outcome.kind !== 'aborted') this.closeRecord(record);
    if (record.participants.size > 0) return;

    // Last participant released (A-F6): the record leaves the registry
    // whatever the outcome, identity-checked so a newer record for the same
    // root is never removed, then settles exactly once.
    record.open = false;
    if (this.openCensuses.get(record.rootKey) === record) {
      this.openCensuses.delete(record.rootKey);
    }
    this.liveCensuses.delete(record);
    this.settleCensus(record);
  }

  /**
   * Settle rules (first that applies):
   * 1. the manual participant ended without an abort → its outcome;
   * 2. the first background outcome that is not an abort;
   * 3. the manual participant was cancelled → `cancelled`, no push;
   * 4. otherwise (pause, background-only abort) → nothing recorded.
   */
  private settleCensus(record: CensusRecord): void {
    const manual = record.outcomes.find((o) => o.origin === 'manual');
    const background = record.outcomes.find(
      (o) => o.origin === 'background' && o.outcome.kind !== 'aborted',
    );
    let decided: ParticipantOutcome | null = null;
    if (manual && manual.outcome.kind !== 'aborted') {
      decided = manual.outcome;
    } else if (background) {
      decided = background.outcome;
    } else if (
      manual &&
      manual.outcome.kind === 'aborted' &&
      manual.outcome.cause === 'cancel'
    ) {
      decided = manual.outcome;
    }
    if (decided === null) return;

    const finishedAt = Date.now();
    const durationMs = finishedAt - record.startedAt;
    const stats = decided.kind === 'succeeded' ? decided.stats : null;
    const lastRun: IndexingLastRunWire = {
      origin: record.origin,
      outcome:
        decided.kind === 'aborted'
          ? 'cancelled'
          : decided.kind === 'failed'
            ? 'failed'
            : 'succeeded',
      startedAt: record.startedAt,
      finishedAt,
      durationMs,
      ...(stats
        ? {
            filesScanned: stats.filesScanned,
            symbolsIndexed: stats.symbolsIndexed,
            errors: stats.errors,
          }
        : {}),
    };
    this.upsertRow(record.fp, { last_run_json: JSON.stringify(lastRun) });

    if (decided.kind === 'succeeded') {
      const completeEvent: IndexingCompleteEvent = {
        workspaceRoot: record.workspaceRoot,
        workspaceFingerprint: record.fp,
        completedAt: finishedAt,
        gitHeadSha: record.gitHeadSha,
        elapsedMs: durationMs,
      };
      void this.webviewManager.broadcastMessage(
        MESSAGE_TYPES.INDEXING_COMPLETE,
        completeEvent,
      );
    } else if (decided.kind === 'failed') {
      const error = decided.error;
      this.logger.warn('[indexing-control] indexing failed', {
        origin: record.origin,
        error: error instanceof Error ? error.message : String(error),
      });
      const failedEvent: IndexingFailedEvent = {
        workspaceRoot: record.workspaceRoot,
        workspaceFingerprint: record.fp,
        failedAt: finishedAt,
        elapsedMs: durationMs,
        origin: record.origin,
      };
      void this.webviewManager.broadcastMessage(
        MESSAGE_TYPES.INDEXING_FAILED,
        failedEvent,
      );
    }
  }

  private hasLiveManual(record: CensusRecord): boolean {
    for (const p of record.participants) {
      if (p.origin === 'manual') return true;
    }
    return false;
  }

  /**
   * The running view for a root. With two live records (a closed manual
   * record in its memory phase and a newer background record), the one with
   * the live manual participant wins; otherwise the newest.
   */
  private runningView(workspaceRoot: string): IndexingRunWire | null {
    const rootKey = normalizeWorkspaceRoot(workspaceRoot);
    let chosen: CensusRecord | null = null;
    for (const record of this.liveCensuses) {
      if (record.rootKey !== rootKey) continue;
      if (
        chosen === null ||
        this.hasLiveManual(record) ||
        !this.hasLiveManual(chosen)
      ) {
        chosen = record;
      }
    }
    if (chosen === null) return null;
    const manualLive = this.hasLiveManual(chosen);
    return {
      origin: chosen.origin,
      startedAt: chosen.startedAt,
      force: chosen.force,
      ...(chosen.origin === 'background' && manualLive
        ? { joinedBackground: true }
        : {}),
      ...(chosen.lastProgress
        ? {
            processed: chosen.lastProgress.filesScanned,
            total: chosen.lastProgress.totalFiles,
          }
        : {}),
    };
  }

  private toProgressEvent(
    progress: IndexingRunProgress,
    startedAt: number,
  ): IndexingProgressEvent {
    const percent =
      progress.totalFiles > 0
        ? Math.min(
            100,
            Math.round((progress.filesScanned / progress.totalFiles) * 100),
          )
        : 0;
    return {
      pipeline: 'symbols',
      percent,
      currentLabel: `${progress.filesScanned}/${progress.totalFiles} files`,
      elapsedMs: Date.now() - startedAt,
      totalKnown: true,
      processed: progress.filesScanned,
      total: progress.totalFiles,
    };
  }

  /** The one progress fan-out: in-process listeners and the webview. */
  private emitProgress(event: IndexingProgressEvent): void {
    for (const listener of this.progressListeners) {
      listener(event);
    }
    void this.webviewManager.broadcastMessage(
      MESSAGE_TYPES.INDEXING_PROGRESS,
      event,
    );
  }

  /** Invalid or absent `last_run_json` → null (debug-logged when invalid). */
  private readLastRun(
    raw: string | null | undefined,
  ): IndexingLastRunWire | null {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error: unknown) {
      // degradation-audit: reported - an unreadable last-run summary is debug-logged and shown as "no last run"; the run state itself is unaffected.
      this.logger.debug('[indexing-control] last_run_json unreadable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    if (!isLastRunWire(parsed)) {
      this.logger.debug(
        '[indexing-control] last_run_json has an invalid shape',
      );
      return null;
    }
    return parsed;
  }

  private readMemoryEnabled(): boolean {
    return (
      this.workspace.getConfiguration<boolean>(
        MEMORY_TRIGGER_SECTION,
        MEMORY_TRIGGER_KEYS.enabled,
        MEMORY_TRIGGER_DEFAULTS.enabled,
      ) !== false
    );
  }

  /** Pause an active run — fires AbortController, persists cursor. */
  pause(): void {
    if (!this.activeAbortController) {
      this.logger.debug('[indexing-control] pause() — no active run');
      return;
    }
    this.activeAbortController.abort('pause');
    this.activeAbortController = null;
    this.logger.debug('[indexing-control] paused');
  }

  /**
   * Resume from stored cursor.
   * Re-launches `start()` with the same workspace; cursor is restored from DB.
   */
  async resume(workspaceRoot: string, deps: IndexingRunDeps): Promise<void> {
    const { fp } = await deriveWorkspaceFingerprint(workspaceRoot, this.fs);
    const row = this.readRow(fp);

    if (!row?.symbols_cursor) {
      this.logger.debug(
        '[indexing-control] resume() — no cursor stored, starting fresh',
      );
      await this.start(undefined, workspaceRoot, deps);
      return;
    }
    const currentSha = await deriveGitHeadSha(workspaceRoot, this.fs);
    if (row.git_head_sha && currentSha && row.git_head_sha !== currentSha) {
      this.logger.debug(
        '[indexing-control] resume() — fingerprint changed, discarding cursor',
      );
      this.upsertRow(fp, { symbols_cursor: null });
      await this.start(undefined, workspaceRoot, deps);
      return;
    }
    await this.start(undefined, workspaceRoot, deps);
  }

  /**
   * Cancel an active run — aborts, clears cursor, restores pre-index state.
   * Does NOT update git_head_sha or last_indexed_at.
   */
  cancel(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort('cancel');
      this.activeAbortController = null;
    }

    if (this.activeWorkspaceFp) {
      this.upsertRow(this.activeWorkspaceFp, {
        symbols_cursor: null,
        last_error: null,
      });
    }

    this.activeWorkspaceFp = null;
    this.logger.debug('[indexing-control] cancelled', {
      restoredState: this.preIndexState,
    });
  }

  /** Enable or disable a pipeline. Immediately starts/stops the relevant service. */
  async setPipelineEnabled(
    pipeline: IndexingPipeline,
    enabled: boolean,
    workspaceRoot: string,
  ): Promise<void> {
    const { fp } = await deriveWorkspaceFingerprint(workspaceRoot, this.fs);

    if (pipeline === 'symbols') {
      this.upsertRow(fp, { symbols_enabled: boolToInt(enabled) });
      if (!enabled && this.symbolWatcher) {
        this.symbolWatcher.close();
        this.symbolWatcher = null;
      }
    } else {
      this.upsertRow(fp, { memory_enabled: boolToInt(enabled) });
      if (enabled) {
        this.memoryCurator.start();
      } else {
        this.memoryCurator.stop();
      }
    }
  }

  /** Dismiss the stale banner for the current SHA (re-shows if HEAD changes again). */
  async dismissStale(workspaceRoot: string): Promise<void> {
    const { fp } = await deriveWorkspaceFingerprint(workspaceRoot, this.fs);
    const currentSha = await deriveGitHeadSha(workspaceRoot, this.fs);
    this.upsertRow(fp, { last_dismissed_stale_sha: currentSha });
  }

  /** Record that the user has acknowledged the privacy disclosure. */
  async acknowledgeDisclosure(workspaceRoot: string): Promise<void> {
    const { fp } = await deriveWorkspaceFingerprint(workspaceRoot, this.fs);
    this.upsertRow(fp, { disclosure_acknowledged_at: Date.now() });
  }

  /** Wire-runtime calls this after the chokidar watcher is created. */
  setSymbolWatcher(watcher: { close: () => void } | null): void {
    this.symbolWatcher = watcher;
  }

  /** Subscribe to indexing progress events. Returns an unsubscribe function. */
  onProgress(listener: (event: IndexingProgressEvent) => void): () => void {
    this.progressListeners.push(listener);
    return () => {
      const idx = this.progressListeners.indexOf(listener);
      if (idx !== -1) this.progressListeners.splice(idx, 1);
    };
  }

  /**
   * Internal symbol-indexing loop with progress events and cooperative abort.
   *
   * Passes the abort signal and the census record's progress handler to
   * deps.runSymbols. A settlement that is not an abort closes the record. On
   * abort, persists the cursor (except for a cancel, which clears it) and
   * reports the abort cause.
   */
  private async runSymbolsIndexWithProgress(
    workspaceRoot: string,
    deps: IndexingRunDeps,
    record: CensusRecord,
    fp: string,
    signal: AbortSignal,
  ): Promise<
    | { readonly kind: 'succeeded'; readonly stats: IndexingRunStats | null }
    | { readonly kind: 'aborted'; readonly cause: AbortCause }
  > {
    let result: IndexingRunStats | void;
    try {
      result = await deps.runSymbols(workspaceRoot, {
        signal,
        onProgress: record.onProgress,
      });
    } catch (error: unknown) {
      if (isAbortError(error) || signal.aborted) {
        const cause = signal.aborted ? abortCauseOf(signal) : 'other';
        if (cause !== 'cancel') {
          const cursor: SymbolsCursor = {
            remainingFiles: [],
            processed: 0,
            total: 0,
            batchIndex: 0,
          };
          this.upsertRow(fp, { symbols_cursor: JSON.stringify(cursor) });
        }
        return { kind: 'aborted', cause };
      }
      this.closeRecord(record);
      throw error;
    }

    this.closeRecord(record);
    if (signal.aborted) return { kind: 'aborted', cause: abortCauseOf(signal) };
    this.emitProgress({
      pipeline: 'symbols',
      percent: 100,
      currentLabel: 'Done',
      elapsedMs: Date.now() - record.startedAt,
      totalKnown: true,
    });
    return { kind: 'succeeded', stats: toRunStats(result) };
  }

  /** Synchronous SQLite read — returns null if no row exists. */
  private readRow(fingerprint: string): IndexingStateRow | null {
    try {
      const stmt = this.sqlite.db.prepare(
        'SELECT * FROM indexing_state WHERE workspace_fingerprint = ?',
      );
      return (stmt.get(fingerprint) as IndexingStateRow | undefined) ?? null;
    } catch {
      return null;
    }
  }

  /** Upsert partial fields into the indexing_state row for a workspace fingerprint. */
  private upsertRow(
    fingerprint: string,
    fields: Partial<
      Pick<
        IndexingStateRow,
        | 'git_head_sha'
        | 'last_indexed_at'
        | 'symbols_enabled'
        | 'memory_enabled'
        | 'symbols_cursor'
        | 'disclosure_acknowledged_at'
        | 'last_dismissed_stale_sha'
        | 'last_error'
        | 'last_run_json'
      >
    >,
  ): void {
    try {
      const now = Date.now();
      const setClauses: string[] = ['updated_at = ?'];
      const values: unknown[] = [now];

      if ('git_head_sha' in fields) {
        setClauses.push('git_head_sha = ?');
        values.push(fields.git_head_sha ?? null);
      }
      if ('last_indexed_at' in fields) {
        setClauses.push('last_indexed_at = ?');
        values.push(fields.last_indexed_at ?? null);
      }
      if ('symbols_enabled' in fields) {
        setClauses.push('symbols_enabled = ?');
        values.push(fields.symbols_enabled);
      }
      if ('memory_enabled' in fields) {
        setClauses.push('memory_enabled = ?');
        values.push(fields.memory_enabled);
      }
      if ('symbols_cursor' in fields) {
        setClauses.push('symbols_cursor = ?');
        values.push(fields.symbols_cursor ?? null);
      }
      if ('disclosure_acknowledged_at' in fields) {
        setClauses.push('disclosure_acknowledged_at = ?');
        values.push(fields.disclosure_acknowledged_at ?? null);
      }
      if ('last_dismissed_stale_sha' in fields) {
        setClauses.push('last_dismissed_stale_sha = ?');
        values.push(fields.last_dismissed_stale_sha ?? null);
      }
      if ('last_error' in fields) {
        setClauses.push('last_error = ?');
        values.push(fields.last_error ?? null);
      }
      if ('last_run_json' in fields) {
        setClauses.push('last_run_json = ?');
        values.push(fields.last_run_json ?? null);
      }

      values.push(fingerprint);
      const insertStmt = this.sqlite.db.prepare(
        `INSERT OR IGNORE INTO indexing_state (workspace_fingerprint, created_at, updated_at) VALUES (?, ?, ?)`,
      );
      insertStmt.run(fingerprint, now, now);

      const updateStmt = this.sqlite.db.prepare(
        `UPDATE indexing_state SET ${setClauses.join(', ')} WHERE workspace_fingerprint = ?`,
      );
      updateStmt.run(...values);
    } catch (error: unknown) {
      this.logger.debug('[indexing-control] upsertRow failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
