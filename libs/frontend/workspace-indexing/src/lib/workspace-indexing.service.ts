/**
 * WorkspaceIndexingService — Frontend bridge for the `indexing:*` RPC namespace.
 *
 * Owns:
 *  - The latest `IndexingStatusWire` snapshot (signal).
 *  - The most recent push `indexing:progress` event (signal).
 *  - A `uiState` computed that maps the backend status into one of 8 UX states.
 *
 * Push events from the backend arrive via the `MessageHandler` /
 * `MESSAGE_HANDLERS` token wired in `apps/ptah-extension-webview/src/app/app.config.ts`.
 * See `libs/frontend/core/src/lib/services/message-router.service.ts` for the
 * dispatch model.
 *
 * No backend imports — types come from `@ptah-extension/shared`.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type IndexingCompleteEvent,
  type IndexingFailedEvent,
  type IndexingLastRunWire,
  type IndexingPipeline,
  type IndexingProgressEvent,
  type IndexingRefusalReason,
  type IndexingRunWire,
  type IndexingStatusWire,
} from '@ptah-extension/shared';
import type { MessageHandler } from '@ptah-extension/core';

/**
 * Discriminated union covering every UI state the workspace-indexing panel can
 * render.
 *
 * `loading` and `no-workspace` are pseudo-states (no backend equivalent) used
 * before the first `getStatus` round-trip completes or when no workspace is
 * open.
 */
export type IndexingUiState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'no-workspace' }
  | { readonly kind: 'never-indexed' }
  | { readonly kind: 'code-only-no-memory'; readonly codeSymbolCount: number }
  | {
      readonly kind: 'indexing';
      readonly percent: number;
      readonly label: string;
      readonly elapsedMs: number;
      readonly totalKnown: boolean;
      /** Files scanned so far, when the backend reported it. */
      readonly processed?: number;
      /** Files this run will scan, paired with `processed`. */
      readonly total?: number;
    }
  | {
      readonly kind: 'paused';
      readonly percent: number;
    }
  | {
      readonly kind: 'indexed';
      readonly lastIndexedAt: number | null;
      readonly isNonGit: boolean;
    }
  | {
      readonly kind: 'stale';
      readonly prevSha: string | null;
      readonly currentSha: string | null;
      readonly lastDismissedSha: string | null;
    }
  | {
      readonly kind: 'error';
      readonly message: string;
    };

/**
 * Result of the last user action (start, resume, pause, cancel). The text is
 * always one of the fixed sentences below, never backend error text.
 */
export interface IndexingActionMessage {
  readonly tone: 'error' | 'info';
  readonly text: string;
}

const INDEXING_PROGRESS_MESSAGE_TYPE = MESSAGE_TYPES.INDEXING_PROGRESS;
const INDEXING_COMPLETE_MESSAGE_TYPE = MESSAGE_TYPES.INDEXING_COMPLETE;
const INDEXING_FAILED_MESSAGE_TYPE = MESSAGE_TYPES.INDEXING_FAILED;

const REFUSAL_MESSAGES: Readonly<
  Record<IndexingRefusalReason, IndexingActionMessage>
> = {
  'already-running': {
    tone: 'info',
    text: 'A full index is already running.',
  },
  'indexer-not-ready': {
    tone: 'error',
    text: 'The code indexer is not ready yet. Open a workspace folder and try again.',
  },
  'no-workspace': { tone: 'error', text: 'Open a workspace folder to index it.' },
  'setup-failed': {
    tone: 'error',
    text: 'Could not start indexing. See the logs.',
  },
};

const JOINED_BACKGROUND_MESSAGE: IndexingActionMessage = {
  tone: 'info',
  text: 'Joined the scan already in progress. Progress appears after its next batch.',
};
const START_FAILED_MESSAGE = REFUSAL_MESSAGES['setup-failed'];
/** A start or resume was accepted, but the follow-up status read failed. */
const STATUS_AFTER_START_FAILED_MESSAGE: IndexingActionMessage = {
  tone: 'error',
  text: 'Indexing started, but its status could not be read. Reopen this view to check it.',
};
/** An `indexing:failed` push arrived and the follow-up status read failed. */
const INDEXING_FAILED_MESSAGE: IndexingActionMessage = {
  tone: 'error',
  text: 'Indexing failed. See the logs.',
};
const PAUSE_FAILED_MESSAGE: IndexingActionMessage = {
  tone: 'error',
  text: 'Could not pause indexing. See the logs.',
};
const CANCEL_FAILED_MESSAGE: IndexingActionMessage = {
  tone: 'error',
  text: 'Could not cancel indexing. See the logs.',
};

/** Fields of `indexing:start` and `indexing:resume` results this service reads. */
interface StartLikeResult {
  readonly accepted: boolean;
  readonly reason?: IndexingRefusalReason;
}
/** The part of an RPC result a start-like action reads. */
interface StartLikeRpcResult {
  isSuccess(): boolean;
  readonly data?: StartLikeResult;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceIndexingService implements MessageHandler {
  private readonly rpc = inject(ClaudeRpcService);

  private readonly _status = signal<IndexingStatusWire | null>(null);
  /**
   * Bumped by every successful status read and workspace change. A failed-push
   * fallback drops the stale `running` view only while its value is current.
   */
  private statusGeneration = 0;
  /**
   * Bumped by every user action (start, resume, pause, cancel). A failed-push
   * fallback writes its sentence only when no newer action owns the message.
   */
  private actionGeneration = 0;
  private readonly _progress = signal<IndexingProgressEvent | null>(null);
  private readonly _completedAt = signal<number | null>(null);
  private readonly _hasWorkspace = signal<boolean>(true);
  private readonly _starting = signal<boolean>(false);
  private readonly _actionMessage = signal<IndexingActionMessage | null>(null);

  /** Latest status snapshot from the backend. `null` until first load. */
  readonly status = this._status.asReadonly();
  /** Most recent progress push event (or `null` between runs). */
  readonly progress = this._progress.asReadonly();
  /** Epoch-ms timestamp of the most recent `indexing:complete` push (or `null`). */
  readonly completedAt = this._completedAt.asReadonly();
  /** Result sentence of the last start/resume/pause/cancel (or `null`). */
  readonly actionMessage = this._actionMessage.asReadonly();
  /** True while a start or resume request is in flight. */
  readonly starting = this._starting.asReadonly();

  /** The run in progress for this workspace, if any. */
  private readonly running = computed<IndexingRunWire | null>(
    () => this._status()?.running ?? null,
  );
  /** Origin of the run in progress (`null` when nothing runs). */
  readonly runningOrigin = computed<'manual' | 'background' | null>(
    () => this.running()?.origin ?? null,
  );
  /** The last finished run recorded by the backend (or `null`). */
  readonly lastRun = computed<IndexingLastRunWire | null>(
    () => this._status()?.lastRun ?? null,
  );
  /**
   * True while a start is in flight or a manual run is live (a manual start
   * that joined a background scan counts). A background-only run is not busy:
   * a click on Re-index joins it.
   */
  readonly isBusy = computed<boolean>(() => {
    if (this._starting()) return true;
    const run = this.running();
    if (run === null) return false;
    return run.origin === 'manual' || run.joinedBackground === true;
  });

  /**
   * Derived UI state. Order matters — checks `error` and `indexing` first so
   * a stale row that is currently re-indexing reports `kind: 'indexing'`.
   */
  readonly uiState = computed<IndexingUiState>(() => {
    if (!this._hasWorkspace()) {
      return { kind: 'no-workspace' };
    }
    const status = this._status();
    if (!status) {
      return { kind: 'loading' };
    }

    // A live run (manual or background) or an unfinished progress push means
    // indexing, whatever the persisted state says. Paused keeps its own view:
    // its last progress push is below 100 by definition.
    const p = this._progress();
    const running = status.running ?? null;
    if (
      status.state !== 'paused' &&
      (running !== null || (p !== null && p.percent < 100))
    ) {
      return this.buildIndexingState(p, running);
    }

    switch (status.state) {
      case 'never-indexed': {
        const codeSymbolCount = status.codeSymbolCount ?? 0;
        const memoryChunkCount = status.memoryChunkCount ?? 0;
        if (codeSymbolCount > 0 && memoryChunkCount === 0) {
          return { kind: 'code-only-no-memory', codeSymbolCount };
        }
        return { kind: 'never-indexed' };
      }
      case 'indexing':
        return this.buildIndexingState(p, running);
      case 'paused': {
        const p = this._progress();
        return { kind: 'paused', percent: p?.percent ?? 0 };
      }
      case 'indexed': {
        const isNonGit =
          status.gitHeadSha === null && status.currentGitHeadSha === null;
        return {
          kind: 'indexed',
          lastIndexedAt: status.lastIndexedAt,
          isNonGit,
        };
      }
      case 'stale': {
        const dismissedForCurrent =
          status.lastDismissedStaleSha !== null &&
          status.currentGitHeadSha !== null &&
          status.lastDismissedStaleSha === status.currentGitHeadSha;
        if (dismissedForCurrent) {
          return {
            kind: 'indexed',
            lastIndexedAt: status.lastIndexedAt,
            isNonGit: false,
          };
        }
        return {
          kind: 'stale',
          prevSha: status.gitHeadSha,
          currentSha: status.currentGitHeadSha,
          lastDismissedSha: status.lastDismissedStaleSha,
        };
      }
      case 'error':
        return {
          kind: 'error',
          message: status.errorMessage ?? 'Indexing failed.',
        };
      default:
        return { kind: 'loading' };
    }
  });

  readonly handledMessageTypes = [
    INDEXING_PROGRESS_MESSAGE_TYPE,
    INDEXING_COMPLETE_MESSAGE_TYPE,
    INDEXING_FAILED_MESSAGE_TYPE,
  ] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type === INDEXING_PROGRESS_MESSAGE_TYPE) {
      const payload = message.payload as IndexingProgressEvent | undefined;
      if (!payload) return;
      this._progress.set(payload);
      return;
    }
    if (message.type === INDEXING_COMPLETE_MESSAGE_TYPE) {
      const payload = message.payload as IndexingCompleteEvent | undefined;
      if (!payload) return;
      this._progress.set(null);
      this._completedAt.set(payload.completedAt);
      void this.loadStatus(payload.workspaceRoot).catch(() => undefined);
      return;
    }
    if (message.type === INDEXING_FAILED_MESSAGE_TYPE) {
      const payload = message.payload as IndexingFailedEvent | undefined;
      if (!payload) return;
      this._progress.set(null);
      void this.refreshAfterFailure(payload.workspaceRoot);
    }
  }

  /**
   * After a failure push the persisted status normally shows the error. When
   * that read fails, the last `running` view is stale: drop it (and a stale
   * `indexing` row becomes `error`) so the panel leaves the indexing state and
   * stops counting as busy, and show a fixed failure sentence.
   */
  private async refreshAfterFailure(workspaceRoot: string): Promise<void> {
    const statusGeneration = this.statusGeneration;
    const actionGeneration = this.actionGeneration;
    if (await this.tryLoadStatus(workspaceRoot)) return;
    // A newer snapshot or workspace change replaced the stale view: keep it.
    if (statusGeneration !== this.statusGeneration) return;
    this._status.update((status) =>
      status
        ? {
            ...status,
            running: null,
            state: status.state === 'indexing' ? 'error' : status.state,
            errorMessage:
              status.state === 'indexing'
                ? INDEXING_FAILED_MESSAGE.text
                : status.errorMessage,
          }
        : status,
    );
    // A newer action owns the message (for example its own failure sentence).
    if (actionGeneration !== this.actionGeneration) return;
    this._actionMessage.set(INDEXING_FAILED_MESSAGE);
  }

  /**
   * Progress comes from the latest push. Until the first push of a run
   * arrives, `processed/total` come from the status `running` view; with
   * neither, the bar is indeterminate.
   */
  private buildIndexingState(
    p: IndexingProgressEvent | null,
    running: IndexingRunWire | null,
  ): IndexingUiState {
    if (p !== null) {
      return {
        kind: 'indexing',
        percent: p.percent,
        label: p.currentLabel,
        elapsedMs: p.elapsedMs,
        totalKnown: p.totalKnown,
        ...(p.processed !== undefined && p.total !== undefined
          ? { processed: p.processed, total: p.total }
          : {}),
      };
    }
    const processed = running?.processed;
    const total = running?.total;
    if (processed !== undefined && total !== undefined && total > 0) {
      return {
        kind: 'indexing',
        percent: Math.min(100, Math.round((processed / total) * 100)),
        label: '',
        elapsedMs: 0,
        totalKnown: true,
        processed,
        total,
      };
    }
    return {
      kind: 'indexing',
      percent: 0,
      label: '',
      elapsedMs: 0,
      totalKnown: false,
    };
  }

  /**
   * Components call this when the workspace root changes. Passing `null`
   * forces the `no-workspace` UI state and clears any stale status snapshot.
   */
  setWorkspaceAvailability(hasWorkspace: boolean): void {
    this._hasWorkspace.set(hasWorkspace);
    this.statusGeneration++;
    if (!hasWorkspace) {
      this._status.set(null);
      this._progress.set(null);
      this._actionMessage.set(null);
    }
  }

  /**
   * Fetch the current backend status for `workspaceRoot`. Resolves `true`
   * when the status was read, `false` when the RPC returned a failure (the
   * last status stays). A transport failure still rejects.
   */
  async loadStatus(workspaceRoot: string): Promise<boolean> {
    this._hasWorkspace.set(true);
    const result = await this.rpc.call('indexing:getStatus', { workspaceRoot });
    if (!result.isSuccess()) {
      console.warn('[workspace-indexing] getStatus failed', result.error);
      return false;
    }
    this.statusGeneration++;
    this._status.set(result.data.status);
    return true;
  }

  /** `loadStatus` that never rejects: `false` for any failed read. */
  private async tryLoadStatus(workspaceRoot: string): Promise<boolean> {
    try {
      return await this.loadStatus(workspaceRoot);
    } catch (error: unknown) {
      console.warn('[workspace-indexing] getStatus failed', error);
      return false;
    }
  }

  /**
   * Starts a run. Never rejects: a refusal or a transport failure becomes
   * `actionMessage`. A start during a background-only scan joins that scan.
   */
  async start(workspaceRoot: string, force = false): Promise<void> {
    await this.runStartLike(
      workspaceRoot,
      () => this.rpc.call('indexing:start', { workspaceRoot, force }),
      true,
    );
  }

  /**
   * Pauses the active indexing run. `workspaceRoot` is optional — if provided,
   * the service issues a `loadStatus()` after the RPC so callers can rely on
   * the `status` signal converging without a manual refresh. Never rejects.
   */
  async pause(workspaceRoot?: string): Promise<void> {
    this.actionGeneration++;
    this._actionMessage.set(null);
    try {
      const result = await this.rpc.call('indexing:pause', {});
      if (!result.isSuccess()) {
        this._actionMessage.set(PAUSE_FAILED_MESSAGE);
      }
      if (workspaceRoot) {
        await this.loadStatus(workspaceRoot);
      }
    } catch {
      this._actionMessage.set(PAUSE_FAILED_MESSAGE);
    }
  }

  /** Resumes a paused run. Never rejects; refusals become `actionMessage`. */
  async resume(workspaceRoot: string): Promise<void> {
    await this.runStartLike(
      workspaceRoot,
      () => this.rpc.call('indexing:resume', { workspaceRoot }),
      false,
    );
  }

  /** Cancels the active run. Never rejects. */
  async cancel(workspaceRoot: string): Promise<void> {
    this.actionGeneration++;
    this._actionMessage.set(null);
    try {
      const result = await this.rpc.call('indexing:cancel', {});
      if (result.isSuccess()) {
        // No push follows a cancel, so drop the last progress event here.
        this._progress.set(null);
      } else {
        this._actionMessage.set(CANCEL_FAILED_MESSAGE);
      }
      await this.loadStatus(workspaceRoot);
    } catch {
      this._actionMessage.set(CANCEL_FAILED_MESSAGE);
    }
  }

  private async runStartLike(
    workspaceRoot: string,
    send: () => Promise<StartLikeRpcResult>,
    reportJoin: boolean,
  ): Promise<void> {
    if (this._starting()) return;
    this._starting.set(true);
    this.actionGeneration++;
    this._actionMessage.set(null);
    try {
      const result = await send();
      const data = result.isSuccess() ? result.data : undefined;
      if (data === undefined) {
        this._actionMessage.set(START_FAILED_MESSAGE);
        return;
      }
      if (data.accepted === false) {
        this._actionMessage.set(
          REFUSAL_MESSAGES[data.reason ?? 'setup-failed'] ??
            START_FAILED_MESSAGE,
        );
      }
      const refreshed = await this.tryLoadStatus(workspaceRoot);
      if (data.accepted === false) return;
      if (!refreshed) {
        this._actionMessage.set(STATUS_AFTER_START_FAILED_MESSAGE);
      } else if (
        reportJoin &&
        this._status()?.running?.joinedBackground === true
      ) {
        this._actionMessage.set(JOINED_BACKGROUND_MESSAGE);
      }
    } catch {
      this._actionMessage.set(START_FAILED_MESSAGE);
    } finally {
      this._starting.set(false);
    }
  }

  async setPipelineEnabled(
    pipeline: IndexingPipeline,
    enabled: boolean,
    workspaceRoot: string,
  ): Promise<void> {
    const result = await this.rpc.call('indexing:setPipelineEnabled', {
      workspaceRoot,
      pipeline,
      enabled,
    });
    if (result.isSuccess()) {
      await this.loadStatus(workspaceRoot);
    }
  }

  async dismissStale(workspaceRoot: string): Promise<void> {
    await this.rpc.call('indexing:dismissStale', { workspaceRoot });
    await this.loadStatus(workspaceRoot);
  }

  async acknowledgeDisclosure(workspaceRoot: string): Promise<void> {
    await this.rpc.call('indexing:acknowledgeDisclosure', { workspaceRoot });
    await this.loadStatus(workspaceRoot);
  }
}
