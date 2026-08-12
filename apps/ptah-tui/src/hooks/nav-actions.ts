/**
 * Pure key → action resolution for `useKeyboardNav`.
 *
 * Deliberately kept in its own module with no `ink` import: `ink` is ESM-only
 * and cannot be loaded by this project's jest transform, so anything that
 * imports it is untestable here. Splitting the decision logic out is how the
 * navigation contract gets real coverage.
 */

/** The subset of Ink's `Key` the navigation hook reacts to. */
export interface NavKey {
  readonly upArrow?: boolean;
  readonly downArrow?: boolean;
  readonly pageUp?: boolean;
  readonly pageDown?: boolean;
  readonly return?: boolean;
  readonly escape?: boolean;
}

export type NavAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'escape' }
  | { readonly kind: 'select' }
  | { readonly kind: 'move'; readonly index: number };

/**
 * Escape is resolved BEFORE the empty-list guard, and that ordering is the
 * whole point.
 *
 * An overlay that matched zero items is precisely when the user needs to back
 * out, and at that moment it is the only live handler in the app — the shell's
 * `useInput` is gated off by `overlayActive`, the composer is yielded to the
 * overlay, and Ctrl+C is disabled by `exitOnCtrlC: false`. Bailing on
 * `itemCount === 0` before reaching Escape left the TUI with no reachable
 * binding at all: an unrecoverable lock that needed the terminal killed.
 */
export function resolveNavAction(
  key: NavKey,
  current: number,
  itemCount: number,
  wrap: boolean,
): NavAction {
  if (key.escape === true) return { kind: 'escape' };
  if (itemCount === 0) return { kind: 'none' };

  if (key.upArrow === true) {
    if (current > 0) return { kind: 'move', index: current - 1 };
    return { kind: 'move', index: wrap ? itemCount - 1 : current };
  }
  if (key.downArrow === true) {
    if (current < itemCount - 1) return { kind: 'move', index: current + 1 };
    return { kind: 'move', index: wrap ? 0 : current };
  }
  if (key.pageUp === true) {
    return { kind: 'move', index: Math.max(0, current - 10) };
  }
  if (key.pageDown === true) {
    return { kind: 'move', index: Math.min(itemCount - 1, current + 10) };
  }
  if (key.return === true) return { kind: 'select' };
  return { kind: 'none' };
}
