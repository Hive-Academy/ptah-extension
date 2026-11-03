import { Injectable, signal } from '@angular/core';

/**
 * GitDockMutationGate — whether the dock may change the repository right now
 * (TASK_2026_855 review S1).
 *
 * `GitDockScopeStore` closes it while the scope is unresolved (the session's
 * organization record is not loaded, so its worktree is unknown). The write
 * paths — `SourceControlService` stage/unstage/discard/commit/abort/continue
 * and `ReviewDiffService.applyHunks` — read it before every call and refuse
 * without an RPC. It has no dependencies, so those services can read it while
 * the store, which injects them, writes it.
 */
@Injectable({ providedIn: 'root' })
export class GitDockMutationGate {
  private readonly _blockedReason = signal<string | null>(null);

  /** Why mutations are off, or null when they are allowed. */
  readonly blockedReason = this._blockedReason.asReadonly();

  setBlockedReason(reason: string | null): void {
    this._blockedReason.set(reason);
  }
}

/** The gate's message while the session's worktree is not known yet. */
export const UNRESOLVED_SCOPE_MESSAGE =
  "This session's worktree is not loaded yet. Changes are read-only until it is.";
