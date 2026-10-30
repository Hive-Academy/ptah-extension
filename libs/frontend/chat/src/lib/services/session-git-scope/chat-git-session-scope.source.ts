import { Injectable, computed, inject } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { TabState } from '@ptah-extension/chat-types';
import type {
  GitSessionScopeCandidate,
  GitSessionScopeSource,
} from '@ptah-extension/core';
import { SessionWorktreeLookup } from './session-worktree-lookup.service';

function sameCandidate(
  a: GitSessionScopeCandidate | null,
  b: GitSessionScopeCandidate | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.tabId === b.tabId &&
    a.sessionId === b.sessionId &&
    a.sessionName === b.sessionName &&
    a.organizationWorktreePath === b.organizationWorktreePath &&
    a.organizationResolved === b.organizationResolved &&
    a.agentOriginWorktreePath === b.agentOriginWorktreePath &&
    a.sessionCwd === b.sessionCwd
  );
}

function sameCandidates(
  a: readonly GitSessionScopeCandidate[],
  b: readonly GitSessionScopeCandidate[],
): boolean {
  return a.length === b.length && a.every((item, i) => sameCandidate(item, b[i]));
}

/**
 * The chat side of the git dock's session scope (TASK_2026_855): turns chat
 * tabs into `GitSessionScopeCandidate`s for `GitDockScopeStore`, which lives
 * in git-ui and reaches this only through the `GIT_SESSION_SCOPE_SOURCE`
 * token provided by the webview app.
 *
 * A candidate carries the session's organization worktree (through
 * {@link SessionWorktreeLookup}, the same read the board cards use), the
 * agent-origin worktree, and the tab's workspace partition as its cwd.
 */
@Injectable({ providedIn: 'root' })
export class ChatGitSessionScopeSource implements GitSessionScopeSource {
  private readonly tabManager = inject(TabManagerService);
  private readonly worktrees = inject(SessionWorktreeLookup);

  // Equality on the candidate fields: a tab object changes on every
  // streaming update, the candidate almost never does, and the dock scope
  // effect downstream must not re-run at streaming rate.
  readonly activeSession = computed<GitSessionScopeCandidate | null>(
    () => {
      const tab = this.tabManager.activeTab();
      return tab === null ? null : this.candidateFor(tab);
    },
    { equal: sameCandidate },
  );

  readonly openSessions = computed<readonly GitSessionScopeCandidate[]>(() => {
    const activeId = this.tabManager.activeTabId();
    const tabs = this.tabManager.tabs();
    const ordered = [
      ...tabs.filter((tab) => tab.id === activeId),
      ...tabs.filter((tab) => tab.id !== activeId),
    ];
    return ordered.map((tab) => this.candidateFor(tab));
  }, { equal: sameCandidates });

  candidateForTab(tabId: string): GitSessionScopeCandidate | null {
    const found = this.tabManager.findTabByIdAcrossWorkspaces(tabId);
    return found === null
      ? null
      : this.candidateFor(found.tab, found.workspacePath);
  }

  private candidateFor(
    tab: TabState,
    partitionPath?: string | null,
  ): GitSessionScopeCandidate {
    const sessionCwd =
      partitionPath !== undefined
        ? partitionPath
        : (this.tabManager.findTabByIdAcrossWorkspaces(tab.id)?.workspacePath ??
          null);
    const organization = this.worktrees.worktreeFor(tab.claudeSessionId);
    return {
      tabId: tab.id,
      sessionId: tab.claudeSessionId,
      sessionName: tab.title || 'New Chat',
      organizationWorktreePath: organization.worktreePath,
      organizationResolved: organization.known,
      agentOriginWorktreePath: tab.agentOrigin?.worktreePath ?? null,
      sessionCwd,
    };
  }
}
