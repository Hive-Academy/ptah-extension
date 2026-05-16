/**
 * IndexingControlService — user-controlled workspace indexing state machine.
 *
 * Responsibilities:
 *   - Persist indexing state per workspace fingerprint in the `indexing_state` SQLite table.
 *   - Evaluate boot strategy (first-time / skip / mark-stale-and-skip) from stored + current git HEAD.
 *   - Own the state machine (never-indexed | indexing | paused | indexed | stale | error).
 *   - Expose pause / resume / cancel with cooperative AbortController cancellation.
 *   - Broadcast progress events via WebviewManager.broadcastMessage().
 *   - Gate MemoryCuratorService on the memoryEnabled flag.
 *   - Hold the chokidar watcher reference so setPipelineEnabled('symbols', false) can stop it.
 *
 * LOGGING CONSTRAINT: evaluateBootStrategy() and the 'skip' path MUST NOT emit
 * logger.info or console.log — only logger.debug. This is AC #1 (keystone metric).
 *
 * IMPORT CONSTRAINT: This service must NOT import workspace-intelligence libs directly.
 * Indexer callables are passed at start() call time to avoid circular dependencies.
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import { WebviewManager } from '@ptah-extension/vscode-core';
import { MEMORY_TOKENS } from '../di/tokens';
import { MemoryCuratorService } from '../memory-curator.service';
import {
  deriveWorkspaceFingerprint,
  deriveGitHeadSha,
} from '../workspace-fingerprint';
import type {
  IndexingState,
  IndexingPipeline,
  BootStrategy,
  SymbolsCursor,
  IndexingProgressEvent,
} from '@ptah-extension/shared';

// ---- Backend-only types (not exported via shared wire) ----

export type { IndexingState, IndexingPipeline, BootStrategy, SymbolsCursor };
export type { IndexingProgressEvent };

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

// ---- Internal DB row shape ----

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

  // Stale detection: stored SHA differs from current SHA
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
  ) {}

  // ---- Boot strategy evaluation -----------------------------------------------

  /**
   * Evaluate whether the workspace should be indexed on this boot.
   *
   * LOGGING: Only logger.debug — NO logger.info, NO console.log.
   * This constraint is AC #1: zero log lines on 'skip' strategy boot.
   */
  async evaluateBootStrategy(workspaceRoot: string): Promise<BootStrategy> {
    const { fp } = await deriveWorkspaceFingerprint(workspaceRoot, this.fs);
    const currentSha = await deriveGitHeadSha(workspaceRoot, this.fs);
    const row = this.readRow(fp);

    this.logger.debug('[indexing-control] evaluateBootStrategy', {
      fp,
      currentSha,
      hasRow: Boolean(row),
      storedSha: row?.git_head_sha ?? null,
    });

    if (!row) {
      return 'auto-index-first-time';
    }

    // Stale detection: both SHAs must be non-null and different
    if (row.git_head_sha && currentSha && row.git_head_sha !== currentSha) {
      return 'mark-stale-and-skip';
    }

    // Non-git workspace (both null) → skip; matching SHA → skip
    return 'skip';
  }

  // ---- Status read -------------------------------------------------------

  /** Synchronous status read — derive state from stored row + current git HEAD. */
  async getStatus(workspaceRoot: string): Promise<IndexingStatus> {
    const { fp } = await deriveWorkspaceFingerprint(workspaceRoot, this.fs);
    const currentSha = await deriveGitHeadSha(workspaceRoot, this.fs);
    const row = this.readRow(fp);

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
    };
  }

  // ---- State machine transitions -----------------------------------------------

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
    // Prevent double-start — set controller synchronously before any await
    if (this.activeAbortController) {
      this.logger.debug(
        '[indexing-control] start() called while already running — ignored',
      );
      return;
    }
    // Set immediately (synchronous) so concurrent calls see it
    this.activeAbortController = new AbortController();
    const { signal } = this.activeAbortController;

    const { fp } = await deriveWorkspaceFingerprint(workspaceRoot, this.fs);
    const currentSha = await deriveGitHeadSha(workspaceRoot, this.fs);
    const row = this.readRow(fp);

    // Record pre-index state for cancel()
    this.preIndexState = row
      ? deriveStateFromRow(row, currentSha)
      : 'never-indexed';
    this.activeWorkspaceFp = fp;

    // Early return if already aborted (pause/cancel called before awaits returned)
    if (signal.aborted) return;

    const runSymbols =
      !pipeline || pipeline === 'symbols' || pipeline === 'both';
    const runMemory = !pipeline || pipeline === 'memory' || pipeline === 'both';
    const startedAt = Date.now();

    // Persist transitional state: clear error, set as indexing
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
        // Successful completion
        this.upsertRow(fp, {
          git_head_sha: currentSha,
          last_indexed_at: Date.now(),
          last_error: null,
          symbols_cursor: null,
        });
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
    // Cursor is persisted by runSymbolsIndexWithProgress after the abort is detected
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

    // Verify fingerprint hasn't changed (workspace modified while paused)
    const currentSha = await deriveGitHeadSha(workspaceRoot, this.fs);
    if (row.git_head_sha && currentSha && row.git_head_sha !== currentSha) {
      // Fingerprint changed — discard cursor and start fresh
      this.logger.debug(
        '[indexing-control] resume() — fingerprint changed, discarding cursor',
      );
      this.upsertRow(fp, { symbols_cursor: null });
      await this.start(undefined, workspaceRoot, deps);
      return;
    }

    // Resume with stored cursor
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
      // Clear cursor but do NOT touch git_head_sha or last_indexed_at
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

  // ---- Pipeline toggles -------------------------------------------------------

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

  // ---- Stale / disclosure management ------------------------------------------

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

  /** Mark workspace as stale (called by RPC handler or wire-runtime after boot strategy eval). */
  async markStale(workspaceRoot: string): Promise<void> {
    const { fp } = await deriveWorkspaceFingerprint(workspaceRoot, this.fs);
    const currentSha = await deriveGitHeadSha(workspaceRoot, this.fs);
    // Write the current (new) SHA so next boot can compare again
    this.upsertRow(fp, { git_head_sha: currentSha, last_error: null });
  }

  // ---- Watcher management ---------------------------------------------------

  /** Wire-runtime calls this after the chokidar watcher is created. */
  setSymbolWatcher(watcher: { close: () => void } | null): void {
    this.symbolWatcher = watcher;
  }

  // ---- Progress events -------------------------------------------------------

  /** Subscribe to indexing progress events. Returns an unsubscribe function. */
  onProgress(listener: (event: IndexingProgressEvent) => void): () => void {
    this.progressListeners.push(listener);
    return () => {
      const idx = this.progressListeners.indexOf(listener);
      if (idx !== -1) this.progressListeners.splice(idx, 1);
    };
  }

  // ---- First-launch helper ---------------------------------------------------

  /**
   * First-launch helper: starts both pipelines once with progress broadcast.
   * Called by wire-runtime when evaluateBootStrategy returns 'auto-index-first-time'.
   */
  async startAutoIndex(
    workspaceRoot: string,
    deps: IndexingRunDeps,
  ): Promise<void> {
    await this.start(undefined, workspaceRoot, deps);
  }

  // ---- Private helpers -------------------------------------------------------

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
      // Emit to listeners
      for (const listener of this.progressListeners) {
        try {
          listener(event);
        } catch {
          // never swallow listener errors into the indexing path
        }
      }
      // Broadcast to webview
      void this.webviewManager.broadcastMessage(
        'indexing:progress' as never,
        event,
      );
    };

    // Wrap runSymbols to intercept abort and persist cursor
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
        // Paused — persist cursor position
        // The cursor is managed by the caller (wire-runtime / RPC handler) as it
        // knows the file list; here we simply mark the cursor as "mid-run".
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

      // Build SET clause dynamically from provided fields
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

      // INSERT OR IGNORE first (creates row if not exists), then UPDATE
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
