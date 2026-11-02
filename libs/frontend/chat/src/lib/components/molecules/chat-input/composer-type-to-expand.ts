/**
 * Type-to-expand rules for the compact streaming composer: which document
 * key presses and pastes belong to this composer's chat view.
 */

/** Where a key press may come from to expand one composer. */
export interface ComposerTypingScope {
  /**
   * The chat view that owns the composer. A focused ancestor that holds
   * this view and no other element with its tag also counts.
   */
  readonly view: Element;
  /**
   * Keys typed with nothing focused (target is `<body>`) go to this composer:
   * the visible main panel, or the focused canvas tile.
   */
  readonly ownsDocumentFocus: boolean;
}

/**
 * Targets that consume typed characters themselves: editable fields and
 * widgets with type-ahead. Keys there never expand the composer.
 */
const SELF_TYPING_TARGET =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), ' +
  '[role="menu"], [role="menubar"], [role="listbox"], [role="tree"], ' +
  '[role="grid"], [role="combobox"], [role="textbox"]';

/**
 * The target wraps this view and no other view of the same kind: the
 * session or tile wrapper that owns this composer (a canvas tile's
 * transcript host takes focus when its text is clicked). A shared ancestor
 * such as the canvas grid holds several chat views, so it matches none of
 * them. Views are counted by tag name; the directive's fallback view (the
 * composer root `div`, used when there is no `ptah-chat-view`) holds
 * `div`s, so no ancestor of it ever counts.
 */
function wrapsOnlyThisView(target: Element, view: Element): boolean {
  if (!target.contains(view)) return false;
  return target.getElementsByTagName(view.localName).length === 1;
}

/** The event target belongs to this composer's chat view or its own wrapper. */
export function isInTypingScope(
  target: EventTarget | null,
  scope: ComposerTypingScope,
): boolean {
  if (!(target instanceof Element)) return false;
  const doc = target.ownerDocument;
  if (target === doc.body || target === doc.documentElement) {
    return scope.ownsDocumentFocus;
  }
  if (
    !scope.view.contains(target) &&
    !wrapsOnlyThisView(target, scope.view)
  ) {
    return false;
  }
  return target.closest(SELF_TYPING_TARGET) === null;
}

/**
 * A printable character typed inside the scope. Shortcuts (Ctrl / Meta /
 * Alt, but not AltGr), IME composition, Space (it activates the focused
 * button) and handled events are left alone.
 */
export function isTypeToExpandKey(
  event: KeyboardEvent,
  scope: ComposerTypingScope,
): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  const altGraph = event.getModifierState?.('AltGraph') ?? false;
  if (!altGraph && (event.ctrlKey || event.metaKey || event.altKey)) {
    return false;
  }
  if (event.key.length !== 1 || event.key === ' ') return false;
  return isInTypingScope(event.target, scope);
}
