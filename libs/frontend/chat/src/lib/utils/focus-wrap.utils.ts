/**
 * Tab trap for a modal layer (TASK_2026_679, plan component 5).
 *
 * The same filter as the canvas Rail compact-sheet trap
 * (`canvas-rail-board.component.ts`), kept here because the chat lib must not
 * import from the canvas lib. The canvas copy also skips nested pane overlays;
 * the chat dialogs have none, so that rule is left out.
 */

const TABBABLE =
  'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';

/** In tab order, enabled, outside any `[hidden]` or `[inert]` subtree, and rendered visible. */
function isTabbable(element: HTMLElement): boolean {
  if (element.tabIndex < 0 || element.matches(':disabled')) return false;
  if (element.closest('[hidden], [inert]')) return false;
  if (typeof element.checkVisibility === 'function') {
    return element.checkVisibility({ visibilityProperty: true });
  }
  // Environments without checkVisibility (jsdom): walk the computed styles.
  const view = element.ownerDocument.defaultView;
  for (
    let node: Element | null = element;
    node && view;
    node = node.parentElement
  ) {
    const style = view.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

/**
 * Keep Tab and Shift+Tab inside `container`.
 *
 * Call it from the layer's `keydown` handler. Other keys, and Tab with Alt,
 * Ctrl or Meta, are left alone. Tab on the last tabbable moves to the first,
 * Shift+Tab on the first moves to the last. When focus sits outside the
 * container (for example on a backdrop button), Tab brings it to the first
 * tabbable and Shift+Tab to the last. With nothing tabbable, the key is
 * swallowed so focus cannot leave the layer.
 */
export function wrapTabWithin(
  container: HTMLElement,
  event: KeyboardEvent,
): void {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  const items = Array.from(
    container.querySelectorAll<HTMLElement>(TABBABLE),
  ).filter(isTabbable);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = container.ownerDocument.activeElement;
  const inside = active instanceof Node && container.contains(active);
  if (event.shiftKey && (!inside || active === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault();
    first.focus();
  }
}
