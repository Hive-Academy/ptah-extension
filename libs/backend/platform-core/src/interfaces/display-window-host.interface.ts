import type {
  DisplayWindowAction,
  DisplayWindowOpenResult,
  DisplayWindowSnapshot,
} from '@ptah-extension/shared';

/**
 * IDisplayWindowHost — the detached Display window (TASK_2026_853_3401, D2).
 *
 * Only the Electron host has a second window. Every other host binds
 * `DesktopOnlyDisplayWindowHost`, which reports `supported: false` and
 * answers with the negative value of each method.
 *
 * The main renderer stays authoritative: it publishes snapshots, the host
 * caches the latest one and forwards it to the child, and the child's user
 * actions are relayed back to the main renderer.
 */
export interface IDisplayWindowHost {
  /** Whether this host can show a detached Display window at all. */
  readonly supported: boolean;

  /**
   * Opens the window, or focuses it when it is already open. Resolves with
   * the typed reason when the host cannot open one. Never rejects.
   */
  open(): Promise<DisplayWindowOpenResult>;

  /** Closes an open window. Resolves `true` only when a window was closed. */
  close(): Promise<boolean>;

  /** Whether the window is currently open. */
  isOpen(): boolean;

  /**
   * Caches the snapshot as the latest state and forwards it to an open
   * window. Returns `true` when it was cached; a host without a window
   * returns `false` and keeps nothing.
   */
  publishState(snapshot: DisplayWindowSnapshot): boolean;

  /** The latest cached snapshot, or `null` when none was published. */
  getState(): DisplayWindowSnapshot | null;

  /**
   * Relays a child window action to the main renderer. Returns `true` when
   * it was delivered; `false` when it was not, or when it targets a tab other
   * than the cached snapshot's (stale; `attach` is always relayed).
   */
  relayAction(tabId: string, action: DisplayWindowAction): boolean;
}
