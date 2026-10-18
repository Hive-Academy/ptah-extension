/**
 * Decision-model editor popover helpers (TASK_2026_684 Phase 4 visual review, findings 1, 2 and 5): the editor's
 * height cap and its Tab containment. DOM-only; the row component owns when they run.
 */

import { capPopoverHeight } from './popover-height-cap';

/** Room the editor needs beyond its content: the popover offset (8), the panel's padding (2 x 8) and an edge gap (8). */
const EDITOR_CHROME_PX = 32;
/** The panel's padding (2 x 8) and the popover's shift padding at both viewport edges (2 x 8). */
const PANEL_FIT_PX = 32;
/** With at least this much room under the cell the editor opens below it, so it grows downward (finding 2). */
const MIN_ROOM_BELOW_PX = 280;
/**
 * The editor's height cap in px for a cell at `cell` in a viewport `viewportHeight` tall. The room below the cell
 * wins when it is at least `MIN_ROOM_BELOW_PX`: the capped editor then fits below, so the popover never flips above
 * and a growing hint pushes content down, not the field being typed in up. Otherwise the larger side wins, and the
 * capped editor fits there with its top (heading, close, kind picker) on screen (finding 1). In a window too short
 * for the fixed heading, kind picker and Save footer, the whole editor scrolls; `capPopoverHeight` keeps a usable
 * floor, so the cap is never zero or NaN, and clamps it so the whole panel fits the viewport, where the popover's
 * `keepInViewport` shift holds it.
 */
export function decisionEditorMaxHeight(
  cell: { readonly top: number; readonly bottom: number },
  viewportHeight: number,
): number {
  const below = viewportHeight - cell.bottom - EDITOR_CHROME_PX;
  const above = cell.top - EDITOR_CHROME_PX;
  const room = below >= MIN_ROOM_BELOW_PX ? below : Math.max(below, above);
  return capPopoverHeight(room, viewportHeight - PANEL_FIT_PX);
}

const TAB_STOPS = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Keeps Tab inside the editor dialog (finding 5): Tab on its last control moves to the first, Shift+Tab on the first
 * control (or on the dialog itself, which takes focus on open, or on the popover panel) moves to the last. Escape is
 * the popover's own close, which returns focus to the cell. `editor` is the dialog element; its parent is the panel.
 */
export function wrapEditorTab(event: KeyboardEvent, editor: HTMLElement): void {
  const target = event.target;
  if (event.key !== 'Tab' || !(target instanceof Node)) return;
  const panel = editor.parentElement;
  if (!panel?.contains(target)) return;
  const stops = Array.from(editor.querySelectorAll<HTMLElement>(TAB_STOPS));
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return;
  const leaving = event.shiftKey
    ? target === first || target === editor || target === panel
    : target === last;
  if (!leaving) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}
