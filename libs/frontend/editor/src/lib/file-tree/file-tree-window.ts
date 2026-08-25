import { computed, signal, type Signal } from '@angular/core';
import type { FileTreeNode } from '../models/file-tree.model';

/**
 * How many sibling nodes render at once before the rest are held back behind a
 * reveal row.
 *
 * WHY A CHUNK AND NOT A SCROLL VIEWPORT. The problem this solves is that
 * expanding one directory mounts one `FileTreeNodeComponent` per child, with
 * no upper bound — and each of those is not a cheap div: it carries two
 * computed signals that read `GitStatusService`, an effect, and a lucide icon.
 * A `node_modules` with 4,000 entries mounts 4,000 of them, and every
 * subsequent `git:status-update` then walks all 4,000.
 *
 * A viewport-based virtual scroller would also solve that, but it would have
 * to flatten the recursive tree into a single positioned list — which means
 * moving every node's expansion state up into the parent, giving up the
 * recursive component, and reworking the context-menu path in
 * `editor-panel.component.ts`. It also requires a uniform row height and a
 * measurable scroll container, neither of which jsdom can report, so the whole
 * thing would be untestable outside a real browser.
 *
 * Chunking bounds the mounted-node count with none of that: expansion state
 * stays on the node, the recursion stays, the scroll container is untouched
 * (so scroll position across a collapse/re-expand is whatever it always was),
 * and the reveal row is an ordinary focusable control rather than a
 * synthesised one. What it gives up is O(1) DOM for a user who keeps pressing
 * "show more" — an explicit, per-click cost, not a surprise.
 *
 * 200 is chosen to sit above essentially every hand-authored directory (so the
 * reveal row is not something a normal repo ever sees) while still being two
 * orders of magnitude below the pathological case.
 */
export const FILE_TREE_WINDOW_SIZE = 200;

/** A bounded view over one node's siblings. */
export interface FileTreeWindow {
  /** The prefix of `all` that should be rendered right now. */
  readonly visible: Signal<readonly FileTreeNode[]>;
  /** How many of `all` are being held back. 0 means everything is rendered. */
  readonly hiddenCount: Signal<number>;
  /** Reveal the next chunk. */
  showMore(): void;
  /** Drop back to the first chunk — called when a directory collapses. */
  reset(): void;
}

/**
 * Build a window over a list of sibling nodes.
 *
 * @param all - The full, already-sorted sibling list.
 * @param activeFilePath - The file the editor currently has open, if any. A
 *   window that hid it would make "reveal in explorer" look broken for exactly
 *   the directories big enough to need windowing, so the window stretches to
 *   include it. This is a stretch, not a scroll: everything before it renders
 *   too, which keeps the visible list a contiguous prefix and the reveal row's
 *   count honest.
 */
export function createFileTreeWindow(
  all: () => readonly FileTreeNode[],
  activeFilePath: () => string | undefined = () => undefined,
): FileTreeWindow {
  const limit = signal(FILE_TREE_WINDOW_SIZE);

  const effectiveLimit = computed(() => {
    const nodes = all();
    const requested = limit();
    if (nodes.length <= requested) return nodes.length;

    const active = activeFilePath();
    if (!active) return requested;

    const index = nodes.findIndex((node) => node.path === active);
    return index < requested ? requested : index + 1;
  });

  return {
    visible: computed(() => {
      const nodes = all();
      const bound = effectiveLimit();
      return bound >= nodes.length ? nodes : nodes.slice(0, bound);
    }),
    hiddenCount: computed(() => all().length - effectiveLimit()),
    showMore: () => limit.set(effectiveLimit() + FILE_TREE_WINDOW_SIZE),
    reset: () => limit.set(FILE_TREE_WINDOW_SIZE),
  };
}
