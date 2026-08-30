/**
 * Update lifecycle state types for the in-app desktop update dialog.
 *
 * Detection runs in the Electron main process by querying the GitHub Releases
 * API directly (mirroring the landing-page download route) and comparing the
 * latest `electron-v*` tag to the installed version. When a newer release
 * exists the dialog surfaces a Download action that opens the platform
 * installer in the browser. The renderer never makes network calls — it
 * receives `releaseNotesMarkdown`, `downloadUrl`, and `releaseUrl` in the
 * payload.
 *
 * `error` is a diagnostic state, not a UI state. A failed update *check* is
 * not something the user can act on, so `UpdateManager` logs it and the
 * renderer renders nothing for it. It stays on the wire so `update:get-state`
 * can report why a check produced no result.
 */

export type UpdateLifecycleState =
  | { state: 'idle' }
  | { state: 'checking' }
  | {
      state: 'available';
      currentVersion: string;
      newVersion: string;
      releaseDate?: string;
      releaseNotesMarkdown?: string | null;
      downloadUrl: string | null;
      releaseUrl: string;
    }
  | { state: 'dismissed' }
  | { state: 'error'; message: string };

/** Payload for MESSAGE_TYPES.UPDATE_STATUS_CHANGED ('update:statusChanged') */
export type UpdateStatusChangedPayload = UpdateLifecycleState;
