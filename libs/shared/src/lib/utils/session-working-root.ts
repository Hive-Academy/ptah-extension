/**
 * Session → working-root resolver (TASK_2026_855).
 *
 * One deterministic rule for "which directory does this chat session work
 * in", shared by the git dock scope, the session stats cards and the session
 * inspector so their numbers and their root always agree.
 *
 * Precedence (first non-empty candidate wins):
 *   1. `organizationWorktreePath` — the session's organization record
 *      (`SessionOrganizationSummary.worktreePath`, filled by the host).
 *   2. `agentOriginWorktreePath` — the worktree the spawning agent recorded.
 *   3. `sessionCwd` — the session's own working directory (its workspace
 *      partition path in the webview today).
 *   4. `workspaceRoot` — the open workspace folder.
 *
 * This function does NOT decide whether a root is allowed. The backend is the
 * only authority: every `git:*` call re-validates the root it receives
 * (`GitRootResolver` in `@ptah-extension/rpc-handlers`). A refused root shows
 * as "unavailable" in the dock, never as a silently different folder.
 *
 * Pure: no I/O, no clock.
 */
import { normalizeWorkspaceRoot } from './workspace-root-key';

export type SessionWorkingRootSource =
  | 'organization-worktree'
  | 'agent-origin-worktree'
  | 'session-cwd'
  | 'workspace-root';

export interface SessionWorkingRootInput {
  readonly organizationWorktreePath: string | null;
  readonly agentOriginWorktreePath: string | null;
  /** The session's own working directory, when the caller knows one. */
  readonly sessionCwd: string | null;
  /** The workspace folder used as the last resort. */
  readonly workspaceRoot: string | null;
}

export interface SessionWorkingRoot {
  /** The chosen root, trimmed, in the caller's spelling; null when none. */
  readonly root: string | null;
  /** Which candidate won; null when every candidate was absent. */
  readonly source: SessionWorkingRootSource | null;
}

const NO_ROOT: SessionWorkingRoot = { root: null, source: null };

function present(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveSessionWorkingRoot(
  input: SessionWorkingRootInput,
): SessionWorkingRoot {
  const candidates: ReadonlyArray<
    readonly [SessionWorkingRootSource, string | null]
  > = [
    ['organization-worktree', input.organizationWorktreePath],
    ['agent-origin-worktree', input.agentOriginWorktreePath],
    ['session-cwd', input.sessionCwd],
    ['workspace-root', input.workspaceRoot],
  ];
  for (const [source, value] of candidates) {
    const root = present(value);
    if (root !== null) return { root, source };
  }
  return NO_ROOT;
}

/** True when two root spellings name the same directory (case/separator-folded). */
export function isSameWorkingRoot(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (a === null || a === undefined || b === null || b === undefined) {
    return false;
  }
  return normalizeWorkspaceRoot(a) === normalizeWorkspaceRoot(b);
}
