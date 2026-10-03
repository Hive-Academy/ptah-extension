import type { ReviewCanvasFile } from './file-diff-section.component';

/**
 * Reading-position state of the review canvas: the scroll anchors kept per
 * workspace and comparison, the restore loop's tuning, and how a collapsed
 * file keeps its state when staging gives it a new id.
 */

/** Scroll anchors kept for comparisons the canvas is not showing. */
const MAX_SCROLL_ANCHORS = 16;

/**
 * A restore re-applies its anchor every frame until the anchor section has
 * not moved for this many frames (sections above it are estimated until they
 * render and are measured) and no section in the window is still waiting for
 * its first read. It gives up after the frame cap (about 1 s), extended to
 * the pending cap (about 5 s) while a read is still in flight, since that
 * read will move everything below it when it lands.
 */
export const RESTORE_STABLE_FRAMES = 6;
export const RESTORE_MAX_FRAMES = 60;
export const RESTORE_PENDING_MAX_FRAMES = 300;

/** Input that means the user is scrolling: a running restore yields to it. */
export const USER_SCROLL_EVENTS = [
  'wheel',
  'touchstart',
  'pointerdown',
  'keydown',
] as const;

export interface ScrollAnchor {
  readonly fileId: string;
  /**
   * The file's path. Staging or unstaging a file changes its id (the id
   * carries the staged/worktree kind), so the restore falls back to it.
   */
  readonly path: string;
  /** Pixels from the top of that file's section to the viewport top. */
  readonly offset: number;
}

export interface AnchorRestore {
  readonly anchor: ScrollAnchor;
  frames: number;
  stable: number;
}

/**
 * Where each comparison of each workspace was scrolled to, so leaving the
 * canvas (spot editor, another tab, another comparison) and coming back lands
 * on the same file (parity §7 "view state"). Module scope because the canvas
 * itself may be destroyed in between; bounded and in memory only.
 */
export const scrollAnchors = new Map<string, ScrollAnchor>();

export function rememberAnchor(
  comparisonId: string,
  anchor: ScrollAnchor,
): void {
  scrollAnchors.delete(comparisonId);
  scrollAnchors.set(comparisonId, anchor);
  if (scrollAnchors.size > MAX_SCROLL_ANCHORS) {
    const oldest = scrollAnchors.keys().next().value;
    if (oldest !== undefined) scrollAnchors.delete(oldest);
  }
}

/**
 * Staging or unstaging a file gives it a new id (the id carries the
 * staged/worktree kind), or merges it into the section of the same path that
 * was already listed (a partially staged file staged or unstaged in full).
 * The returned function, given the collapsed ids and each new file list,
 * moves every collapsed id that left the list to the files now listed under
 * its path, new or already present (a merged file stays collapsed if either
 * of its sections was), drops the vanished id, and returns the new set
 * (`null` when nothing moved). An id whose path is no longer listed at all is
 * left alone. It remembers the previous list between calls.
 */
export function collapsedCarrier(): (
  collapsed: ReadonlySet<string>,
  files: readonly ReviewCanvasFile[],
) => Set<string> | null {
  let previousPaths = new Map<string, string>();
  return (collapsed, files) => {
    const previous = previousPaths;
    previousPaths = new Map(files.map((file) => [file.id, file.path]));
    if (collapsed.size === 0) return null;
    let next: Set<string> | null = null;
    for (const id of collapsed) {
      const path = previous.get(id);
      if (previousPaths.has(id) || path === undefined) continue;
      const survivors = files.filter((file) => file.path === path);
      if (survivors.length === 0) continue;
      next ??= new Set(collapsed);
      next.delete(id);
      for (const survivor of survivors) next.add(survivor.id);
    }
    return next;
  };
}
