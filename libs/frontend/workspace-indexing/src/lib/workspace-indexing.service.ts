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
  type IndexingPipeline,
  type IndexingProgressEvent,
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
  | {
      readonly kind: 'indexing';
      readonly percent: number;
      readonly label: string;
      readonly elapsedMs: number;
      readonly totalKnown: boolean;
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

const INDEXING_PROGRESS_MESSAGE_TYPE = MESSAGE_TYPES.INDEXING_PROGRESS;
const INDEXING_COMPLETE_MESSAGE_TYPE = MESSAGE_TYPES.INDEXING_COMPLETE;

@Injectable({ providedIn: 'root' })
export class WorkspaceIndexingService implements MessageHandler {
  private readonly rpc = inject(ClaudeRpcService);

  private readonly _status = signal<IndexingStatusWire | null>(null);
  private readonly _progress = signal<IndexingProgressEvent | null>(null);
  private readonly _completedAt = signal<number | null>(null);
  private readonly _hasWorkspace = signal<boolean>(true);

  /** Latest status snapshot from the backend. `null` until first load. */
  readonly status = this._status.asReadonly();
  /** Most recent progress push event (or `null` between runs). */
  readonly progress = this._progress.asReadonly();
  /** Epoch-ms timestamp of the most recent `indexing:complete` push (or `null`). */
  readonly completedAt = this._completedAt.asReadonly();

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

    switch (status.state) {
      case 'never-indexed': {
        const p = this._progress();
        if (p !== null && p.percent < 100) {
          return this.buildIndexingState(p);
        }
        return { kind: 'never-indexed' };
      }
      case 'indexing':
        return this.buildIndexingState(this._progress());
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
    }
  }

  private buildIndexingState(p: IndexingProgressEvent | null): IndexingUiState {
    return {
      kind: 'indexing',
      percent: p?.percent ?? 0,
      label: p?.currentLabel ?? '',
      elapsedMs: p?.elapsedMs ?? 0,
      totalKnown: p?.totalKnown ?? false,
    };
  }

  /**
   * Components call this when the workspace root changes. Passing `null`
   * forces the `no-workspace` UI state and clears any stale status snapshot.
   */
  setWorkspaceAvailability(hasWorkspace: boolean): void {
    this._hasWorkspace.set(hasWorkspace);
    if (!hasWorkspace) {
      this._status.set(null);
      this._progress.set(null);
    }
  }

  /** Fetch the current backend status for `workspaceRoot`. */
  async loadStatus(workspaceRoot: string): Promise<void> {
    this._hasWorkspace.set(true);
    const result = await this.rpc.call('indexing:getStatus', { workspaceRoot });
    if (result.isSuccess()) {
      this._status.set(result.data.status);
    }
  }

  async start(workspaceRoot: string, force = false): Promise<void> {
    const result = await this.rpc.call('indexing:start', {
      workspaceRoot,
      force,
    });
    if (result.isSuccess()) {
      await this.loadStatus(workspaceRoot);
    }
  }

  /**
   * Pauses the active indexing run. `workspaceRoot` is optional — if provided,
   * the service issues a `loadStatus()` after the RPC so callers can rely on
   * the `status` signal converging without a manual refresh.
   */
  async pause(workspaceRoot?: string): Promise<void> {
    await this.rpc.call('indexing:pause', {});
    if (workspaceRoot) {
      await this.loadStatus(workspaceRoot);
    }
  }

  async resume(workspaceRoot: string): Promise<void> {
    await this.rpc.call('indexing:resume', { workspaceRoot });
    await this.loadStatus(workspaceRoot);
  }

  async cancel(workspaceRoot: string): Promise<void> {
    await this.rpc.call('indexing:cancel', {});
    await this.loadStatus(workspaceRoot);
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
