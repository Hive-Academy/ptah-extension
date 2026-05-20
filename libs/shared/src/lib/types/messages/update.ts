/**
 * Update lifecycle state types for in-app Electron auto-update UX (VS Code-Style).
 *
 * The `releaseNotesMarkdown` field is populated by the Electron main process
 * via a GitHub Releases API call (5s timeout). The renderer must NOT make
 * network calls — it receives the notes as part of the payload.
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
    }
  | {
      state: 'downloading';
      currentVersion: string;
      newVersion: string;
      percent: number;
      bytesPerSecond: number;
      transferred: number;
      total: number;
    }
  | {
      state: 'downloaded';
      currentVersion: string;
      newVersion: string;
      releaseDate?: string;
      releaseNotesMarkdown?: string | null;
    }
  | { state: 'dismissed' }
  | { state: 'error'; message: string };

/** Payload for MESSAGE_TYPES.UPDATE_STATUS_CHANGED ('update:statusChanged') */
export type UpdateStatusChangedPayload = UpdateLifecycleState;
