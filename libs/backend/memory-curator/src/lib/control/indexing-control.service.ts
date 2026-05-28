/**
 * IndexingControlService — user-controlled workspace indexing state machine.
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
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
} from '@ptah-extension/shared';

export type { IndexingState, IndexingPipeline, SymbolsCursor };
export type { IndexingProgressEvent, IndexingCompleteEvent };

export interface IndexingStatus {
  state: IndexingState;
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

/** Callable dependencies injected at start() call time (avoids workspace-intelligence import cycle). */
export interface IndexingRunDeps {
  /** Runs the code-symbol indexer for the given workspace, honoring abort signal. */
  runSymbols: (
    workspaceRoot: string,
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
  /** Runs memory curation pass (optional; curator lifecycle is managed separately). */
  runMemory?: (workspaceRoot: string) => Promise<void>;
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

  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly sqlite: SqliteConnectionService,
    @inject(MEMORY_TOKENS.MEMORY_CURATOR)
    private readonly memoryCurator: MemoryCuratorService,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
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

    if (!row) {
      return {
        state: 'never-indexed',
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
        vec,
        embedder,
      };
    }

    const state = deriveStateFromRow(row, currentSha);
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
      this.logger.debug(
        '[indexing-control] start() called while already running — ignored',
      );
      return;
    }
    this.activeAbortController = new AbortController();
    const { signal } = this.activeAbortController;

    const { fp } = await deriveWorkspaceFingerprint(workspaceRoot, this.fs);
    this.logger.info('[indexing-control] start', {
      workspaceRoot,
      fingerprint: fp,
    });
    const currentSha = await deriveGitHeadSha(workspaceRoot, this.fs);
    const row = this.readRow(fp);
    this.preIndexState = row
      ? deriveStateFromRow(row, currentSha)
      : 'never-indexed';
    this.activeWorkspaceFp = fp;
    if (signal.aborted) return;

    const runSymbols =
      !pipeline || pipeline === 'symbols' || pipeline === 'both';
    const runMemory = !pipeline || pipeline === 'memory' || pipeline === 'both';
    const startedAt = Date.now();
    this.upsertRow(fp, {
      last_error: null,
      symbols_cursor: null,
    });

    try {
      if (runSymbols && (row?.symbols_enabled !== 0 || options?.force)) {
        await this.runSymbolsIndexWithProgress(
          workspaceRoot,
          deps,
          startedAt,
          signal,
        );
        if (signal.aborted) return; // paused or cancelled — state handled by pause()/cancel()
      }

      if (runMemory && (row?.memory_enabled !== 0 || options?.force)) {
        if (deps.runMemory) {
          await deps.runMemory(workspaceRoot);
        }
      }

      if (!signal.aborted) {
        this.upsertRow(fp, {
          git_head_sha: currentSha,
          last_indexed_at: Date.now(),
          last_error: null,
          symbols_cursor: null,
        });
        const completeEvent: IndexingCompleteEvent = {
          workspaceRoot,
          workspaceFingerprint: fp,
          completedAt: Date.now(),
          gitHeadSha: currentSha,
          elapsedMs: Date.now() - startedAt,
        };
        void this.webviewManager.broadcastMessage(
          MESSAGE_TYPES.INDEXING_COMPLETE,
          completeEvent,
        );
        this.activeAbortController = null;
        this.activeWorkspaceFp = null;
      }
    } catch (error: unknown) {
      if (signal.aborted) return; // pause() / cancel() already handled the state
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug('[indexing-control] indexing error', { message });
      this.upsertRow(fp, { last_error: message });
      this.activeAbortController = null;
      this.activeWorkspaceFp = null;
    }
  }

  /** Pause an active run — fires AbortController, persists cursor. */
  pause(): void {
    if (!this.activeAbortController) {
      this.logger.debug('[indexing-control] pause() — no active run');
      return;
    }
    this.activeAbortController.abort();
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
      this.activeAbortController.abort();
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
   * Passes abort signal to deps.runSymbols so each batch boundary is
   * checkable. On abort, persists the cursor before returning.
   */
  private async runSymbolsIndexWithProgress(
    workspaceRoot: string,
    deps: IndexingRunDeps,
    startedAt: number,
    signal: AbortSignal,
  ): Promise<void> {
    const fp = this.activeWorkspaceFp;

    const progressHandler = (event: IndexingProgressEvent): void => {
      for (const listener of this.progressListeners) {
        listener(event);
      }
      void this.webviewManager.broadcastMessage(
        MESSAGE_TYPES.INDEXING_PROGRESS,
        event,
      );
    };
    try {
      await deps.runSymbols(workspaceRoot, { signal });

      if (!signal.aborted) {
        const elapsedMs = Date.now() - startedAt;
        progressHandler({
          pipeline: 'symbols',
          percent: 100,
          currentLabel: 'Done',
          elapsedMs,
          totalKnown: true,
        });
      }
    } catch (error: unknown) {
      const isDomAbort =
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'DOMException');

      if (isDomAbort || signal.aborted) {
        if (fp) {
          const cursor: SymbolsCursor = {
            remainingFiles: [],
            processed: 0,
            total: 0,
            batchIndex: 0,
          };
          this.upsertRow(fp, { symbols_cursor: JSON.stringify(cursor) });
        }
        return;
      }
      throw error;
    }
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
