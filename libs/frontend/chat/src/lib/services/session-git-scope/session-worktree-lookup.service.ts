import { Injectable, computed, inject } from '@angular/core';
import { ChatStore } from '../chat.store';
import { SessionOrganizationCache } from '../session-organization/session-organization-cache.store';

/**
 * The one place the webview reads a session's ORGANIZATION worktree
 * (TASK_2026_855 D19). The git dock scope, the board cards' git stats and the
 * inspector's git section all go through it, so they resolve the same root.
 *
 * The organization record comes from {@link SessionOrganizationCache}
 * (TASK_2026_854): the loaded `session:list` row, else one
 * `session:getOrganization` read, refreshed on `session:organizationChanged`.
 * The answer has three states:
 *   - `{ known: true, worktreePath }` — the organization names a worktree;
 *   - `{ known: true, worktreePath: null }` — the organization has none, the
 *     row is loaded without an organization (a host without the store), or
 *     the tab has no backend session yet: the shared resolver falls through
 *     to the agent origin, the session cwd and the workspace folder;
 *   - `{ known: false, worktreePath: null }` — the organization is not read
 *     (yet) and the row is not loaded. Callers that WRITE (the git dock) must
 *     not guess a root for it; read-only callers may treat it as "no worktree".
 */
export interface SessionWorktree {
  /** False while the session's organization is unknown. */
  readonly known: boolean;
  /** The organization worktree; null when none or unknown. */
  readonly worktreePath: string | null;
}

const NO_WORKTREE: SessionWorktree = { known: true, worktreePath: null };
const UNKNOWN: SessionWorktree = { known: false, worktreePath: null };

@Injectable({ providedIn: 'root' })
export class SessionWorktreeLookup {
  private readonly chatStore = inject(ChatStore);
  private readonly organizationCache = inject(SessionOrganizationCache);

  /** Ids of the loaded session rows, rebuilt when the rows change. */
  private readonly loadedIds = computed(
    () => new Set<string>(this.chatStore.sessions().map((row) => row.id)),
  );

  /**
   * The session's organization worktree and whether it is known. A reactive
   * read: calling it inside a `computed`/`effect` re-runs when the
   * organization or the session rows change.
   */
  worktreeFor(sessionId: string | null): SessionWorktree {
    if (sessionId === null) return NO_WORKTREE;
    const organization =
      this.organizationCache.organizationFor(sessionId)();
    if (organization) {
      return organization.worktreePath
        ? { known: true, worktreePath: organization.worktreePath }
        : NO_WORKTREE;
    }
    return this.loadedIds().has(sessionId) ? NO_WORKTREE : UNKNOWN;
  }
}
