import { InjectionToken } from '@angular/core';

/** Where a valid display fence's version stands in the tab's display panel. */
export type PtahUiDisplayFenceState = 'applied' | 'superseded' | 'evicted';

/**
 * The status the display sync computed for one `ptah-ui display` fence
 * (TASK_2026_623, component 5: `applied | superseded | evicted | invalid`).
 *
 * - `applied`: this fence's version is the one the panel shows.
 * - `superseded`: a later fence with the same id replaced it.
 * - `evicted`: its surface left the panel at the surface cap.
 * - `invalid`: the fence did not compile; `reason` is the 610 reason text.
 */
export type PtahUiDisplayFenceStatus =
  | {
      readonly kind: PtahUiDisplayFenceState;
      /** The panel key of the surface (`id:<id>` or `anon:<blockKey>:<ordinal>`). */
      readonly surfaceKey: string;
      /** The block's title, or `null` when untitled. */
      readonly title: string | null;
      /** The block's description, or `null` when it has none. */
      readonly description: string | null;
    }
  | { readonly kind: 'invalid'; readonly reason: string };

/**
 * The slice of the ChatView's per-tab display dock store that the in-message
 * display chip reads (TASK_2026_623, component 4 and D4). Lets lazy `ptah-ui`
 * code reach the dock without importing the `chat` library.
 *
 * `fenceStatus` reads the store's signals, so a caller inside a reactive
 * context re-runs when the status changes. It must be an O(1) lookup.
 */
export interface PtahUiDisplayDock {
  /** The fence's status in the tab, or `null` before the sync computed it. */
  fenceStatus(tabId: string, fenceKey: string): PtahUiDisplayFenceStatus | null;
  /** Opens the tab's dock on the Displays tab and brings the surface into view. */
  openSurface(tabId: string, surfaceKey: string): void;
}

/**
 * Provided by the ChatView that owns the dock store. Optional in every
 * consumer: when it is absent (a host that hides the dock), the chip shows
 * "Display panel unavailable" with its open action disabled.
 *
 * Eager-light: no runtime import besides `@angular/core`.
 */
export const PTAH_UI_DISPLAY_DOCK = new InjectionToken<PtahUiDisplayDock>(
  'PTAH_UI_DISPLAY_DOCK',
);

/** The per-fence key the sync and the chip share: `messageId:nodeId:ordinal`. */
export function displayFenceKey(
  messageId: string,
  nodeId: string,
  ordinal: number,
): string {
  return `${messageId}:${nodeId}:${ordinal}`;
}
