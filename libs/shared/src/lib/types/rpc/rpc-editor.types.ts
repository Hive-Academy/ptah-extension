/**
 * Editor RPC Type Definitions
 *
 * Types for editor-related RPC methods that operate on the host editor
 * (VS Code text editors / Electron Monaco editors).
 *
 * Includes:
 *   - `editor:revertFiles` request/response (M3): re-read open editor buffers
 *     from disk after a session-rewind has mutated files. Used so users don't
 *     see stale unsaved content sitting on top of newly-rewound files.
 *   - `SessionMetadataChangedNotification` push payload (S4): broadcast from
 *     the backend when a session is created / updated / deleted / forked, so
 *     all open webviews can refresh their sidebar without imperative
 *     `loadSessions()` calls.
 */

// ============================================================
// editor:revertFiles RPC Types (M3)
// ============================================================

/** Parameters for editor:revertFiles RPC method. */
export interface EditorRevertFilesParams {
  /** Absolute file paths to revert in the host editor. */
  files: string[];
}

/** Response from editor:revertFiles RPC method. */
export interface EditorRevertFilesResult {
  /**
   * Number of files actually reverted. Files not currently open in any text
   * editor (or open without unsaved changes) are silently skipped.
   */
  revertedCount: number;
}

// ============================================================
// session:metadataChanged Push Notification (S4)
// ============================================================

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
