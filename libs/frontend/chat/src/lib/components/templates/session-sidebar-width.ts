/**
 * Width rules for the resizable session sidebar in the app shell.
 *
 * The user's chosen width is a preference, not a promise: the open sidebar
 * also leaves {@link SESSION_SIDEBAR_MAIN_MIN_WIDTH} for the main area (chat
 * or canvas tiles). That cap never drops below
 * {@link SESSION_SIDEBAR_FLOOR_WIDTH}, the fixed width the sidebar had before
 * it was resizable, so a narrow shell (a VS Code side panel, Electron with
 * the Review dock open) lays out exactly as it did then.
 */

export const SESSION_SIDEBAR_MIN_WIDTH = 200;
export const SESSION_SIDEBAR_MAX_WIDTH = 480;
export const SESSION_SIDEBAR_DEFAULT_WIDTH = 272;
/** The pre-resizer `w-56`; the cap never goes below it. */
export const SESSION_SIDEBAR_FLOOR_WIDTH = 224;
/** Width the main area keeps beside the open sidebar, when there is room. */
export const SESSION_SIDEBAR_MAIN_MIN_WIDTH = 320;
/** The "Sessions" vertical tab between the sidebar and the main area. */
export const SESSION_SIDEBAR_TAB_RESERVE = 32;
/** Keyboard resize step (ArrowLeft/ArrowRight) in px. */
export const SESSION_SIDEBAR_WIDTH_STEP = 16;
/** localStorage key the chosen width persists under. */
export const SESSION_SIDEBAR_WIDTH_STORAGE_KEY = 'ptah.sessionSidebarWidth';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The widest the open sidebar may be in a shell row `rowWidth` px wide.
 * A row of 0 is not measured yet (or hidden), so only the max applies.
 */
export function sessionSidebarWidthCap(rowWidth: number): number {
  if (rowWidth <= 0) return SESSION_SIDEBAR_MAX_WIDTH;
  return clamp(
    rowWidth - SESSION_SIDEBAR_TAB_RESERVE - SESSION_SIDEBAR_MAIN_MIN_WIDTH,
    SESSION_SIDEBAR_FLOOR_WIDTH,
    SESSION_SIDEBAR_MAX_WIDTH,
  );
}

/** A requested width (drag, keyboard, reset) clamped to the bounds and cap. */
export function clampSessionSidebarWidth(width: number, cap: number): number {
  return clamp(Math.round(width), SESSION_SIDEBAR_MIN_WIDTH, cap);
}

/**
 * Sessions-sidebar width while the Electron divider between the workspace
 * sidebar and the sessions sidebar is dragged.
 *
 * The divider reports a viewport pointer X. That X is the workspace pane's
 * width only because the workspace pane starts at the window's left edge.
 * The sessions pane keeps its own width: the drag adds the pointer delta to
 * the sessions width it started from. Dragging right widens the sessions
 * sidebar; the workspace width is not an input.
 */
export function sessionSidebarWidthFromDividerDrag(
  startWidth: number,
  startPointerX: number,
  pointerX: number,
): number {
  return startWidth + (pointerX - startPointerX);
}

/**
 * The chosen width after a drag or keyboard request. A request the cap turns
 * into no visible change keeps the current choice, so a wider preference
 * survives ArrowRight or an outward drag on a capped sidebar.
 */
export function nextChosenSessionSidebarWidth(
  requested: number,
  chosen: number,
  cap: number,
): number {
  const next = clampSessionSidebarWidth(requested, cap);
  return next === Math.min(chosen, cap) ? chosen : next;
}

/** The persisted width, or the default when missing or not a number. */
export function parseStoredSessionSidebarWidth(stored: string | null): number {
  if (stored === null) return SESSION_SIDEBAR_DEFAULT_WIDTH;
  const parsed = Number.parseInt(stored, 10);
  return Number.isFinite(parsed)
    ? clamp(parsed, SESSION_SIDEBAR_MIN_WIDTH, SESSION_SIDEBAR_MAX_WIDTH)
    : SESSION_SIDEBAR_DEFAULT_WIDTH;
}
