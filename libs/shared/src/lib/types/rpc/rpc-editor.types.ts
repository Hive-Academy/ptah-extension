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

export type EditorTargetId = 'vscode' | 'cursor' | 'antigravity' | 'zed';

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
}

export interface EditorOpenWorkspaceParams {
  target: EditorTargetId;
  root: string;
}

export interface EditorOpenResult {
  success: boolean;
  error?: string;
}
