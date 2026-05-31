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
import type {
  GitWorktreeInfo,
  GitWorktreesResult,
  GitAddWorktreeResult,
  GitRemoveWorktreeResult,
  GitWorktreeChangedNotification,
} from '@ptah-extension/shared';

const ASYNC_WORKTREE_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingOperation {
  resolve: (value: { success: boolean; error?: string; path?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}

@Injectable({ providedIn: 'root' })
export class WorktreeService {
  private readonly vscodeService = inject(VSCodeService);
  private readonly layoutService = inject(ElectronLayoutService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _worktrees = signal<GitWorktreeInfo[]>([]);
  private readonly _isLoading = signal(false);
  private readonly pendingOps = new Map<string, PendingOperation>();

  readonly worktrees = this._worktrees.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly worktreeCount = computed(() => this._worktrees().length);

  constructor() {
    this.setupWorktreeChangeListener();
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
        await this.layoutService.addFolderByPath(ack.data.worktreePath);
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
      await this.layoutService.addFolderByPath(outcome.path);
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
   * Remove a worktree. Async-pending semantics mirror addWorktree above.
   */
  async removeWorktree(
    path: string,
    force?: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    this._isLoading.set(true);

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
      worktrees.filter((w) => w.path !== path),
    );
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

  private setupWorktreeChangeListener(): void {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type !== 'git:worktreeChanged') return;

      const payload = data.payload as
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
        }
        return;
      }

      if (payload.action === 'created') {
        if (payload.path) {
          void this.layoutService.addFolderByPath(payload.path);
        }
        this.loadWorktrees();
      } else if (payload.action === 'removed') {
        this.loadWorktrees();
      }
    };

    window.addEventListener('message', handler);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('message', handler);
      for (const pending of this.pendingOps.values()) {
        clearTimeout(pending.timer);
      }
      this.pendingOps.clear();
    });
  }
}
