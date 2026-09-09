import {
  Injectable,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import {
  VSCodeService,
  ElectronLayoutService,
  rpcCall,
} from '@ptah-extension/core';
import type { MessageHandler } from '@ptah-extension/core';
import type {
  GitWorktreeInfo,
  GitWorktreesResult,
  GitAddWorktreeResult,
  GitRemoveWorktreeResult,
  GitWorktreeChangedNotification,
} from '@ptah-extension/shared';

const ASYNC_WORKTREE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Wire type of the worktree-changed push.
 *
 * Deliberately a literal and NOT a member of `MESSAGE_TYPES`: four backend
 * producers broadcast this string directly (`git-rpc.handlers.ts`,
 * `ptah-api-builder.service.ts` and two sites in `sdk-callbacks.ts`), so the
 * contract must not move. `tasks-store.service.ts` matches the same way.
 */
export const WORKTREE_CHANGED_MESSAGE_TYPE = 'git:worktreeChanged' as const;

interface PendingOperation {
  resolve: (value: { success: boolean; error?: string; path?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}

@Injectable({ providedIn: 'root' })
export class WorktreeService implements MessageHandler {
  private readonly vscodeService = inject(VSCodeService);
  private readonly layoutService = inject(ElectronLayoutService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _worktrees = signal<GitWorktreeInfo[]>([]);
  private readonly _isLoading = signal(false);
  private readonly pendingOps = new Map<string, PendingOperation>();

  readonly worktrees = this._worktrees.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly worktreeCount = computed(() => this._worktrees().length);

  /**
   * Message types dispatched to {@link handleMessage} by
   * `MessageRouterService`. Registered through the `MESSAGE_HANDLERS`
   * multi-provider in the composition root — this service holds no raw
   * `window` listener of its own.
   */
  readonly handledMessageTypes = [WORKTREE_CHANGED_MESSAGE_TYPE] as const;

  constructor() {
    this.destroyRef.onDestroy(() => {
      for (const pending of this.pendingOps.values()) {
        clearTimeout(pending.timer);
      }
      this.pendingOps.clear();
    });
  }

  async loadWorktrees(): Promise<void> {
    this._isLoading.set(true);

    const result = await rpcCall<GitWorktreesResult>(
      this.vscodeService,
      'git:worktrees',
      {},
    );

    if (result.success && result.data) {
      this._worktrees.set(result.data.worktrees);
    }

    this._isLoading.set(false);
  }

  /**
   * Add a worktree. Backend runs the git subprocess asynchronously and
   * resolves this promise via a correlated git:worktreeChanged push, so the
   * RPC channel cannot time out while a slow `git worktree add` is running.
   */
  async addWorktree(
    branch: string,
    options?: { path?: string; createBranch?: boolean },
  ): Promise<{ success: boolean; error?: string }> {
    this._isLoading.set(true);

    const operationId = this.generateOperationId();
    const pendingPromise = this.registerPendingOperation(operationId);

    const ack = await rpcCall<GitAddWorktreeResult>(
      this.vscodeService,
      'git:addWorktree',
      {
        branch,
        path: options?.path,
        createBranch: options?.createBranch,
        operationId,
      },
    );

    if (!ack.success || !ack.data) {
      this.cancelPendingOperation(operationId);
      this._isLoading.set(false);
      return {
        success: false,
        error: ack.error || 'Failed to add worktree',
      };
    }

    if (!ack.data.pending) {
      this.cancelPendingOperation(operationId);
      if (ack.data.success && ack.data.worktreePath) {
        await this.loadWorktrees();
        this._isLoading.set(false);
        return { success: true };
      }
      this._isLoading.set(false);
      return {
        success: false,
        error: ack.data.error || 'Failed to add worktree',
      };
    }

    const outcome = await pendingPromise;
    if (outcome.success && outcome.path) {
      await this.loadWorktrees();
      this._isLoading.set(false);
      return { success: true };
    }
    this._isLoading.set(false);
    return {
      success: false,
      error: outcome.error || 'Failed to add worktree',
    };
  }

  /**
   * Remove a worktree. An explicitly opened workspace must close first; a
   * cancelled or failed close prevents destructive Git removal. Async-pending
   * semantics otherwise mirror addWorktree above.
   */
  async removeWorktree(
    path: string,
    force?: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    this._isLoading.set(true);

    try {
      await this.unregisterOpenWorktree(path);
    } catch (error: unknown) {
      this._isLoading.set(false);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const operationId = this.generateOperationId();
    const pendingPromise = this.registerPendingOperation(operationId);

    const ack = await rpcCall<GitRemoveWorktreeResult>(
      this.vscodeService,
      'git:removeWorktree',
      { path, force, operationId },
    );

    if (!ack.success || !ack.data) {
      this.cancelPendingOperation(operationId);
      this._isLoading.set(false);
      return {
        success: false,
        error: ack.error || 'Failed to remove worktree',
      };
    }

    if (!ack.data.pending) {
      this.cancelPendingOperation(operationId);
      if (ack.data.success) {
        this.removeWorktreeLocally(path);
        this._isLoading.set(false);
        return { success: true };
      }
      this._isLoading.set(false);
      return {
        success: false,
        error: ack.data.error || 'Failed to remove worktree',
      };
    }

    const outcome = await pendingPromise;
    if (outcome.success) {
      this.removeWorktreeLocally(path);
      this._isLoading.set(false);
      return { success: true };
    }
    this._isLoading.set(false);
    return {
      success: false,
      error: outcome.error || 'Failed to remove worktree',
    };
  }

  private removeWorktreeLocally(path: string): void {
    this._worktrees.update((worktrees) =>
      worktrees.filter((w) => !this.pathsEqual(w.path, path)),
    );
  }

  /**
   * Close a worktree workspace only when the user had explicitly opened it.
   * Creation notifications never register folders; selecting a row is the sole
   * opt-in path into ElectronLayoutService.addFolderByPath().
   */
  private async unregisterOpenWorktree(path: string): Promise<void> {
    const index = this.layoutService
      .workspaceFolders()
      .findIndex((folder) => this.pathsEqual(folder.path, path));
    if (index < 0) return;

    const removed = await this.layoutService.removeFolder(index);
    if (!removed) {
      throw new Error(
        'Open worktree workspace could not be closed; Git removal was cancelled.',
      );
    }
  }

  private pathsEqual(left: string, right: string): boolean {
    const normalize = (value: string): string =>
      value.replace(/\\/g, '/').replace(/\/+$/, '');
    const platform = this.vscodeService.config().platform;
    return platform === 'win32'
      ? normalize(left).toLowerCase() === normalize(right).toLowerCase()
      : normalize(left) === normalize(right);
  }
  private async reconcileRemovedWorktree(path?: string): Promise<void> {
    let closeError: unknown;
    if (path) {
      try {
        await this.unregisterOpenWorktree(path);
      } catch (error: unknown) {
        closeError = error;
      }
    }
    await this.loadWorktrees();
    if (closeError !== undefined) throw closeError;
  }

  private generateOperationId(): string {
    const cryptoRef = globalThis.crypto as Crypto | undefined;
    if (cryptoRef?.randomUUID) {
      return cryptoRef.randomUUID();
    }
    return `wt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private registerPendingOperation(
    operationId: string,
  ): Promise<{ success: boolean; error?: string; path?: string }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingOps.delete(operationId)) {
          resolve({
            success: false,
            error: 'Timed out waiting for worktree operation to complete',
          });
        }
      }, ASYNC_WORKTREE_TIMEOUT_MS);
      this.pendingOps.set(operationId, { resolve, timer });
    });
  }

  private cancelPendingOperation(operationId: string): void {
    const pending = this.pendingOps.get(operationId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingOps.delete(operationId);
  }

  /**
   * Apply a `git:worktreeChanged` push routed by `MessageRouterService`.
   *
   * A push carrying an `operationId` settles the matching pending operation
   * and stops there — {@link addWorktree} / {@link removeWorktree} own the
   * follow-up. An uncorrelated push reconciles the local list; a removed path
   * is also unregistered if the user had explicitly opened that worktree.
   */
  handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type !== WORKTREE_CHANGED_MESSAGE_TYPE) return;

    const payload = message.payload as
      | GitWorktreeChangedNotification
      | undefined;
    if (!payload || !payload.action) return;

    if (payload.operationId) {
      const pending = this.pendingOps.get(payload.operationId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingOps.delete(payload.operationId);
        pending.resolve({
          success: payload.success !== false,
          error: payload.error,
          path: payload.path,
        });
        return;
      }
    }

    if (payload.success === false) return;

    if (payload.action === 'created') {
      void this.loadWorktrees();
    } else if (payload.action === 'removed') {
      void this.reconcileRemovedWorktree(payload.path).catch(() => {
        // Git already removed this worktree. Keep the still-open workspace and
        // let the user close it after active sessions or transient RPC failure.
      });
    }
  }
}
