import { InjectionToken, type Signal } from '@angular/core';

/**
 * What the git dock needs to know about one chat session to decide the root
 * it works in (TASK_2026_855). The precedence between these candidates is
 * `resolveSessionWorkingRoot` in `@ptah-extension/shared`; this record only
 * carries them.
 */
export interface GitSessionScopeCandidate {
  /** The chat tab the session lives in. */
  readonly tabId: string;
  /** The tab's backend session id (`TabState.claudeSessionId`), or null. */
  readonly sessionId: string | null;
  /** Display name: the tab title, or a placeholder for an untitled tab. */
  readonly sessionName: string;
  /** The session organization record's worktree, or null. */
  readonly organizationWorktreePath: string | null;
  /**
   * False while the session's organization record is not loaded, so whether
   * it has a worktree is unknown. The dock then shows an unresolved scope with
   * mutations off instead of guessing the workspace folder.
   */
  readonly organizationResolved: boolean;
  /** The worktree the spawning agent recorded, or null. */
  readonly agentOriginWorktreePath: string | null;
  /** The session's working directory: its tab's workspace partition path. */
  readonly sessionCwd: string | null;
}

/**
 * Contract between the chat sessions and the git dock.
 *
 * Implemented by `ChatGitSessionScopeSource` in `@ptah-extension/chat` and
 * provided by the webview app, so `@ptah-extension/git-ui` learns about chat
 * sessions without importing chat:
 *   core (defines the contract) ← chat (implements it) ← app (provides it)
 *   git-ui injects the token (optional: no provider = workspace-root scope).
 */
export interface GitSessionScopeSource {
  /** Candidate of the active chat tab, or null when none. Reactive. */
  readonly activeSession: Signal<GitSessionScopeCandidate | null>;
  /** Candidates of the active workspace's open tabs, active first. Reactive. */
  readonly openSessions: Signal<readonly GitSessionScopeCandidate[]>;
  /**
   * Candidate of one tab in any workspace, or null when the tab is gone.
   * A reactive read: calling it inside a `computed`/`effect` tracks the tab.
   */
  candidateForTab(tabId: string): GitSessionScopeCandidate | null;
}

export const GIT_SESSION_SCOPE_SOURCE =
  new InjectionToken<GitSessionScopeSource>('GIT_SESSION_SCOPE_SOURCE');
