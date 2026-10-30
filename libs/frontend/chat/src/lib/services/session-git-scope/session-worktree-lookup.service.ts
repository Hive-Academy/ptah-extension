import { Injectable, computed, inject } from '@angular/core';
import { ChatStore } from '../chat.store';

/**
 * The one place the webview reads a session's ORGANIZATION worktree
 * (TASK_2026_855 D19). The git dock scope, the board cards' git stats and the
 * inspector's git section all go through it, so they resolve the same root.
 *
 * On `main` the organization record arrives on the `session:list` rows held
 * by `ChatStore.sessions()`. The answer has three states:
 *   - `{ known: true, worktreePath }` — the row is loaded and names a worktree;
 *   - `{ known: true, worktreePath: null }` — the row is loaded without one,
 *     or the tab has no backend session yet: the shared resolver falls
 *     through to the agent origin, the session cwd and the workspace folder;
 *   - `{ known: false, worktreePath: null }` — a session id whose row is not
 *     loaded (yet). Callers that WRITE (the git dock) must not guess a root
 *     for it; read-only callers may treat it as "no worktree".
 *
 * After TASK_2026_854 (feat/session-auto-links) merges, the body of
 * {@link worktreeFor} becomes
 * a read of `this.organizationCache.organizationFor(sessionId)()` from
 * `SessionOrganizationCache` (not loaded → `known: false`), which adds the
 * `session:getOrganization` fallback and the `session:organizationChanged`
 * refresh. No caller changes.
 */
export interface SessionWorktree {
  /** False when the session's row is not loaded, so its worktree is unknown. */
  readonly known: boolean;
  /** The organization worktree; null when none or unknown. */
  readonly worktreePath: string | null;
}

const NO_SESSION: SessionWorktree = { known: true, worktreePath: null };
const UNKNOWN: SessionWorktree = { known: false, worktreePath: null };

@Injectable({ providedIn: 'root' })
export class SessionWorktreeLookup {
  private readonly chatStore = inject(ChatStore);

  /** Answer per loaded session row, rebuilt when the rows change. */
  private readonly worktrees = computed(() => {
    const byId = new Map<string, SessionWorktree>();
    for (const row of this.chatStore.sessions()) {
      byId.set(row.id, {
        known: true,
        worktreePath: row.organization?.worktreePath || null,
      });
    }
    return byId;
  });

  /**
   * The session's organization worktree and whether it is known. A reactive
   * read: calling it inside a `computed`/`effect` re-runs when the session
   * rows change.
   */
  worktreeFor(sessionId: string | null): SessionWorktree {
    const worktrees = this.worktrees();
    if (sessionId === null) return NO_SESSION;
    return worktrees.get(sessionId) ?? UNKNOWN;
  }
}
