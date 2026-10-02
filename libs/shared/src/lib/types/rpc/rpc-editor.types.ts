/**
 * Session-metadata push notification type definitions.
 *
 * `SessionMetadataChangedNotification` push payload (S4): broadcast from
 * the backend when a session is created / updated / deleted / forked, so
 * all open webviews can refresh their sidebar without imperative
 * `loadSessions()` calls.
 *
 * The editor:revertFiles request/response types this file used to also
 * carry were removed with the rest of the editor RPC surface
 * (TASK_2026_385 Batch 4.4) — the file name is a historical artifact.
 */

/**
 * Reason a session metadata change was emitted.
 *
 *  - `created`: brand-new session metadata recorded.
 *  - `updated`: existing metadata mutated (rename, generic save).
 *  - `deleted`: metadata removed.
 *  - `forked`: a session was forked from another (the new fork's metadata).
 */
export type SessionMetadataChangeKind =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'forked';

/**
 * Push notification payload for `session:metadataChanged`.
 *
 * Sent from the backend (SessionMetadataStore mutations + fork) to all open
 * webviews. The frontend listens on the message event handler and refreshes
 * the affected sidebar — this is NOT a request/response RPC method, so it
 * does not appear in `RPC_METHOD_NAMES` / the RPC registry.
 */
export interface SessionMetadataChangedNotification {
  /** What kind of change occurred. */
  kind: SessionMetadataChangeKind;
  /** SDK session UUID the change applies to. */
  sessionId: string;
  /** Workspace path the session belongs to. */
  workspaceId: string;
}

export type EditorTargetId =
  | 'vscode'
  | 'cursor'
  | 'antigravity'
  | 'zed'
  | 'kiro'
  /**
   * An external terminal opened at a folder. Only `editor:openWorkspace`
   * accepts it; `editor:openFile` answers `{ success: false }`.
   */
  | 'terminal';

/** Wire-safe projection of a detected editor target. */
export interface EditorTarget {
  id: EditorTargetId;
  displayName: string;
  executablePath?: string;
}

export type EditorDetectTargetsParams = Record<string, never>;
export interface EditorDetectTargetsResult {
  success: boolean;
  targets: EditorTarget[];
  error?: string;
}

export interface EditorOpenFileParams {
  target: EditorTargetId;
  path: string;
  line?: number;
  workspaceRoot?: string;
  /**
   * Which path policy authorizes this launch.
   *
   * - `'workspace'` (default, unchanged behaviour): the path must resolve
   *   inside a registered workspace folder.
   * - `'external-link'`: an agent-authored link the viewer refused to show
   *   in-app. Adds the user's home and temp directories as authorized roots,
   *   MINUS a credential deny-list checked on both the lexical and the real
   *   path. Bytes go to the user's own editor process, never to the renderer.
   */
  scope?: 'workspace' | 'external-link';
}

export interface EditorOpenWorkspaceParams {
  target: EditorTargetId;
  root: string;
}

export interface EditorOpenResult {
  success: boolean;
  error?: string;
}

/**
 * Parameters for `editor:openMerge` (TASK_2026_576 Requirement 11): open the
 * three-way merge view of one conflicted path in an external editor.
 */
export interface EditorOpenMergeParams {
  /** The editor to launch; only a target with a merge view gets one (A11). */
  target: EditorTargetId;
  /** Repository-relative path of the conflicted file. */
  path: string;
  /**
   * The registered workspace folder the conflict is in; the active folder
   * when omitted. An unregistered folder is refused, never substituted.
   */
  workspaceRoot?: string;
}

/**
 * Why `editor:openMerge` did not launch:
 * - `invalid-params` — the payload failed validation.
 * - `invalid-path` — not a repository-relative path inside the working tree.
 * - `not-installed` — the target was not detected on this machine.
 * - `no-operation` — no merge, rebase or cherry-pick is in progress.
 * - `not-conflicted` — the path has no unmerged entry (already resolved).
 * - `not-mergeable` — a delete/modify, symlink or submodule conflict: no
 *   three-way merge exists; open the folder instead.
 * - `failed` — git, the file system or the launch failed (details in the log).
 */
export type EditorOpenMergeFailureReason =
  | 'invalid-params'
  | 'invalid-path'
  | 'not-installed'
  | 'no-operation'
  | 'not-conflicted'
  | 'not-mergeable'
  | 'failed';

/**
 * Result from `editor:openMerge`. Discriminated on `status`.
 * - `ok` — the editor started with its merge view.
 * - `unsupported` — the target has no merge view (or this host cannot launch
 *   one); nothing was written or spawned. Open the file instead.
 * - `failed` — `error` is fixed, user-facing copy; never a path or stderr.
 */
export type EditorOpenMergeResult =
  | { status: 'ok' }
  | { status: 'unsupported' }
  | {
      status: 'failed';
      reason: EditorOpenMergeFailureReason;
      error: string;
    };
