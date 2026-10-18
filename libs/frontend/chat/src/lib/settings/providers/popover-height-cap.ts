/**
 * The height-cap rule shared by the decision-model editor and the Main Agent popover: the room beside the trigger,
 * but never less than a usable scrollport, and never more than fits in the viewport. DOM-free.
 */

/** About a header plus one control: enough of a scrollport to scroll to Save in a very short window. */
const MIN_USABLE_PX = 120;

/**
 * `room` (the free px beside the trigger, already less the popover chrome) floored to a usable height, so a short
 * window or bad geometry never yields a zero-height, unusable dialog. `fit` is the largest cap whose whole panel
 * (cap plus its padding) still fits inside the viewport's edge margins; the popover opts into vertical shift
 * (`keepInViewport`), so a floored panel that would hang past the trigger's side is pulled back on screen. The
 * floor is `MIN_USABLE_PX`, clamped to `fit`, and the result is never under 1 px. A non-finite `room` falls back
 * to the floor; a non-finite `fit` leaves the floor at `MIN_USABLE_PX` and the cap unclamped. Where `room` is at
 * least the floor (every ordinary window) the result is `room`, unchanged.
 */
export function capPopoverHeight(room: number, fit: number): number {
  const limit = Number.isFinite(fit) ? Math.floor(fit) : Infinity;
  const floor = Math.min(MIN_USABLE_PX, limit);
  const capped = Number.isFinite(room)
    ? Math.min(limit, Math.max(floor, Math.floor(room)))
    : floor;
  return Math.max(1, capped);
}
