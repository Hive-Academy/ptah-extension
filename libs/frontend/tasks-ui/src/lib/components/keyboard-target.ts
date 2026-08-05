/**
 * The one implementation of "this keystroke belongs to a text field" (R10).
 *
 * ## Why it is a module rather than a method on each host
 *
 * Two components bind a `host:` keydown handler — `TasksViewComponent` (the
 * palette shortcut) and `TaskBoardComponent` (roving navigation) — and R10
 * states the rule once: **every key is ignored while the target is an
 * `<input>`, a `<textarea>` or a `[contenteditable]`.** Two copies of that
 * predicate is two places for it to drift, and the failure mode of a drifted
 * copy is silent: a user typing a task title into the New Task box would find
 * a space scrolling the board or a `k` opening the palette, and nothing would
 * be logged.
 *
 * ## `closest`, not a tag comparison
 *
 * A `contenteditable` region's key events target the deepest node inside it,
 * which is usually a `<span>` or a text node's parent — comparing
 * `target.tagName` against a list would miss every one of them. `closest`
 * walks up, so a keystroke anywhere inside an editable region is recognised as
 * belonging to it.
 */

/**
 * The selector for "somewhere a user is typing".
 *
 * `[contenteditable]:not([contenteditable='false'])` matters: the attribute is
 * present and explicitly disabled on nodes that opt OUT of editing, and a bare
 * `[contenteditable]` would swallow keys for those too.
 */
const TEXT_ENTRY_SELECTOR =
  "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/**
 * True when the event originated inside a text-entry control.
 *
 * Accepts `EventTarget | null` — the raw shape of `KeyboardEvent.target` — so
 * callers pass it straight through without a cast at each site.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(TEXT_ENTRY_SELECTOR) !== null
  );
}
