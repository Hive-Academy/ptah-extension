/**
 * Width policy of the docked session inspector (design-spec §1-2). Pure: the
 * host supplies `availableWidth`, the width the tile area and the dock share.
 */

/** Narrowest docked inspector width (px); matches the Git dock `min-w-[300px]`. */
export const INSPECTOR_MIN_WIDTH = 300;
/** Widest docked inspector width (px). */
export const INSPECTOR_MAX_WIDTH = 560;
/**
 * Width (px) the tile area keeps beside the docked inspector (decisions.md
 * row 18): a new floor for the canvas single-focus tile, the same value as
 * the split-pane `min-w-[360px]`. The `INSPECTOR_MIN_WIDTH` dock wins below it.
 */
export const INSPECTOR_MAIN_MIN_WIDTH = 360;
/** Available width (px) from which the default docked width is the large tier. */
export const INSPECTOR_LARGE_SHELL_MIN_WIDTH = 1100;
/** Available width (px) from which the default docked width is the wide tier. */
export const INSPECTOR_WIDE_SHELL_MIN_WIDTH = 1500;
/** Default docked width (px) below `INSPECTOR_LARGE_SHELL_MIN_WIDTH`. */
export const INSPECTOR_DEFAULT_WIDTH = 336;
/** Default docked width (px) from `INSPECTOR_LARGE_SHELL_MIN_WIDTH`. */
export const INSPECTOR_LARGE_DEFAULT_WIDTH = 400;
/** Default docked width (px) from `INSPECTOR_WIDE_SHELL_MIN_WIDTH`. */
export const INSPECTOR_WIDE_DEFAULT_WIDTH = 448;

/**
 * Width (px) of the canvas board's Stats tab (`ptah-sidebar-tab`, default
 * size `w-8`). It sits between the tile area and the dock and belongs to
 * neither, so the host subtracts it before computing `availableWidth`.
 */
export const INSPECTOR_TAB_WIDTH = 32;

/**
 * Widest docked inspector for `availableWidth` px, the width the tile area
 * and the dock share: the tile area keeps `INSPECTOR_MAIN_MIN_WIDTH`, within
 * [MIN, MAX]. Whole px, rounded down, so a subpixel width never takes the
 * tile area below its floor. An unmeasured width (0 or non-finite) allows
 * `INSPECTOR_MAX_WIDTH`.
 */
export function inspectorMaxWidthFor(availableWidth: number): number {
  if (!(availableWidth > 0) || !Number.isFinite(availableWidth)) {
    return INSPECTOR_MAX_WIDTH;
  }
  return Math.max(
    INSPECTOR_MIN_WIDTH,
    Math.min(
      INSPECTOR_MAX_WIDTH,
      Math.floor(availableWidth - INSPECTOR_MAIN_MIN_WIDTH),
    ),
  );
}

/**
 * Default docked width for `availableWidth` px, the width the tile area and
 * the dock share. An unmeasured width (0 or non-finite) gets the narrow tier.
 */
export function inspectorDefaultWidthFor(availableWidth: number): number {
  if (!Number.isFinite(availableWidth)) return INSPECTOR_DEFAULT_WIDTH;
  if (availableWidth < INSPECTOR_LARGE_SHELL_MIN_WIDTH) {
    return INSPECTOR_DEFAULT_WIDTH;
  }
  if (availableWidth < INSPECTOR_WIDE_SHELL_MIN_WIDTH) {
    return INSPECTOR_LARGE_DEFAULT_WIDTH;
  }
  return INSPECTOR_WIDE_DEFAULT_WIDTH;
}

/**
 * Rendered docked width: `preference` (else the default for
 * `availableWidth`) rounded and clamped to
 * [MIN, `inspectorMaxWidthFor(availableWidth)`]. A non-finite preference
 * falls back to the default. The clamp is for rendering only and is never
 * written back to the stored preference.
 */
export function inspectorDockWidth(
  preference: number | null,
  availableWidth: number,
): number {
  const wanted =
    preference !== null && Number.isFinite(preference)
      ? preference
      : inspectorDefaultWidthFor(availableWidth);
  // Round first: the integer max then bounds the rendered width.
  const max = inspectorMaxWidthFor(availableWidth);
  return Math.min(max, Math.max(INSPECTOR_MIN_WIDTH, Math.round(wanted)));
}
