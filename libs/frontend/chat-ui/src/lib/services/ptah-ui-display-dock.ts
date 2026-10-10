import { InjectionToken } from '@angular/core';
import type { DisplaySurface } from '../organisms/display-panel/display-surfaces';

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

/**
 * What the display sync publishes for a tab in one computation (component 5):
 * the agent surfaces (at most `maxSurfacesPerRoutingId`, creation order) and
 * one status per closed display fence, keyed by `displayFenceKey`.
 */
export interface PtahUiDisplaySurfacesPublication {
  readonly surfaces: readonly DisplaySurface[];
  readonly statuses: ReadonlyMap<string, PtahUiDisplayFenceStatus>;
}

/**
 * The write side of the dock store, used only by the headless display sync
 * (decision #60). Kept apart from `PtahUiDisplayDock` so the chip never sees
 * a write. The sync calls these outside any reactive context.
 */
export interface PtahUiDisplayDockSync {
  /** The surfaces last published for the tab (the D10 comparison input). */
  surfaces(tabId: string): readonly DisplaySurface[];
  /**
   * Replaces the tab's surfaces and fence statuses. The store drops view state
   * of keys no longer present and, per surface, keeps only the component
   * entries listed in `retainedViewStateIds` (D10).
   */
  setSurfaces(
    tabId: string,
    publication: PtahUiDisplaySurfacesPublication,
  ): void;
  /**
   * Whether the fence (`displayFenceKey`, which equals `blockKey:ordinal`) is in
   * the tab's `seenBlockKeys`. The set lives in the store, so a sync remount
   * cannot re-trigger auto-open (D12).
   */
  hasSeen(tabId: string, fenceKey: string): boolean;
  /** Adds fences to the tab's `seenBlockKeys`. */
  markSeen(tabId: string, fenceKeys: readonly string[]): void;
  /**
   * D12: a live, applied, unseen fence asks the panel to open on its surface.
   * The store ignores it when the user closed the panel in this turn
   * (`userClosedTurnKey === turnKey`) and increments `newCount` instead. The
   * store never moves focus (R1.7).
   */
  requestAutoOpen(tabId: string, turnKey: string, surfaceKey: string): void;
}

/**
 * Provided by the ChatView alongside `PTAH_UI_DISPLAY_DOCK` (both
 * `useExisting` the dock store). Optional: without it the sync publishes
 * nothing and never throws.
 */
export const PTAH_UI_DISPLAY_DOCK_SYNC =
  new InjectionToken<PtahUiDisplayDockSync>('PTAH_UI_DISPLAY_DOCK_SYNC');

/** The per-fence key the sync and the chip share: `messageId:nodeId:ordinal`. */
export function displayFenceKey(
  messageId: string,
  nodeId: string,
  ordinal: number,
): string {
  return `${messageId}:${nodeId}:${ordinal}`;
}
