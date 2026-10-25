/**
 * The main chat's centered message column, for lane rows (controls, notices,
 * composers). It uses the transcript's own rule (`.chat-scroll-content`):
 * the width of the lane container less a 0.75 rem gutter on each side, capped
 * at `--chat-content-max-width` (758 px). Sized from the container, not from
 * the parent, so rows inside and outside the lane scroller share one left
 * edge. The lane host sets the container (`container-type: inline-size`).
 */
export const LANE_COLUMN_CLASS =
  'mx-auto w-[calc(100cqw-1.5rem)] max-w-[min(var(--chat-content-max-width,758px),100%)]';
