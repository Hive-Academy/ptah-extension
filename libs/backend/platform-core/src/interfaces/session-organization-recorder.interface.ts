/**
 * Session-organization recorder port — lets capture producers (SDK hooks, MCP
 * tools, the agent session spawner) write organization facts without a SQLite
 * dependency.
 *
 * Adapter lives in @ptah-extension/session-organization. Consumers inject by
 * token, never by class. Contract for every method:
 *   - every `sessionId`, `parentSessionId` and `forkOfSessionId` is an SDK
 *     session UUID, never a webview tab id. A caller that holds only a tab id
 *     must not call the recorder;
 *   - methods never throw and return nothing. The adapter logs and drops a
 *     write it cannot apply (database closed, invalid input);
 *   - the adapter is registered only when the SQLite connection is. When it
 *     is not (VS Code today), consumers that inject the token with
 *     `{ isOptional: true }` receive nothing and skip the call.
 */
import type {
  SessionPrLinkSource,
  SessionPrState,
  SessionStartedBy,
  SessionTaskLinkRole,
  SessionTaskLinkSource,
} from '@ptah-extension/shared';

export interface ISessionOrganizationRecorder {
  /** Record the git worktree (and branch, when known) a session runs in. */
  recordWorktree(input: {
    sessionId: string;
    workspaceRootHint?: string;
    worktreePath: string;
    branch?: string;
  }): void;

  /** Record where a session came from: its parent, the session it forks, and who started it. */
  recordLineage(input: {
    sessionId: string;
    workspaceRootHint?: string;
    parentSessionId?: string;
    forkOfSessionId?: string;
    startedBy?: SessionStartedBy;
  }): void;

  /** Link a session to a task folder. A second `primary` link demotes the existing one. */
  linkTask(input: {
    sessionId: string;
    workspaceRootHint?: string;
    taskId: string;
    role: SessionTaskLinkRole;
    source: SessionTaskLinkSource;
  }): void;

  /** Attach a pull-request URL to a session. */
  addPrLink(input: {
    sessionId: string;
    workspaceRootHint?: string;
    url: string;
    state?: SessionPrState;
    source: SessionPrLinkSource;
  }): void;

  /**
   * TASK_2026_584: one call when an agent-started child's SDK session id is
   * known. Records lineage (started by an agent), worktree, branch and the
   * optional task link in one transaction.
   */
  recordAgentStartedSession(input: {
    sessionId: string;
    workspaceRoot: string;
    parentSessionId?: string;
    worktreePath: string;
    branch: string;
    taskId?: string;
  }): void;
}
