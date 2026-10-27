export interface CanvasRailKeyboardContext {
  readonly surfaceActive: boolean;
  readonly host?: HTMLElement | null;
  readonly orderedIds: readonly string[];
  readonly focusedId: string | null;
  focus(id: string): void;
  focusSelectButton(id: string): void;
  readonly focusInnerButtons: boolean;
}

export function focusRailSelectButton(card: HTMLElement | undefined): void {
  [...(card?.querySelectorAll<HTMLElement>('.rc-select, button') ?? [])]
    .find((element) => !element.closest('[aria-hidden="true"]'))
    ?.focus();
}

/** Focus `items[index]`, wrapping a negative or past-the-end index. */
export function focusMenuItem(items: readonly HTMLElement[], index: number): void {
  items[(index + items.length) % items.length]?.focus();
}

/**
 * Roving focus for a `role="menu"` (the ARIA menu pattern): ArrowDown and
 * ArrowUp move with wraparound, Home and End jump to the first and last item.
 * A handled key is prevented; any other key is left alone.
 */
export function handleMenuKeydown(event: KeyboardEvent, items: readonly HTMLElement[]): void {
  const current = items.findIndex((item) => item === item.ownerDocument.activeElement);
  let next: number;
  switch (event.key) {
    case 'ArrowDown': next = current + 1; break;
    case 'ArrowUp': next = current < 0 ? -1 : current - 1; break;
    case 'Home': next = 0; break;
    case 'End': next = -1; break;
    default: return;
  }
  focusMenuItem(items, next);
  event.preventDefault();
}

/**
 * Alt+Shift+ArrowUp/Down asks to move the card one place; any other modifier
 * set, or a plain arrow (left to `handleCanvasRailKeydown`), is not a move.
 */
export function railMoveKey(event: KeyboardEvent): 'up' | 'down' | null {
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return null;
  return event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : null;
}

const IGNORED_TARGET =
  'input, textarea, select, [contenteditable], [role="menu"], [role="listbox"], [role="dialog"], [popover]';

export function handleCanvasRailKeydown(
  event: KeyboardEvent,
  ctx: CanvasRailKeyboardContext,
): void {
  if (!ctx.surfaceActive || event.defaultPrevented || !ctx.orderedIds.length) return;
  const target = event.target;
  if (!(target instanceof Element) || target.closest(IGNORED_TARGET) ||
    (target instanceof HTMLElement && target.isContentEditable)) return;

  const card = target.closest<HTMLElement>('[data-rail-card]');
  const insideTablist = !!target.closest('[role="tablist"], [role="tab"]');
  if (event.key === 'Escape') {
    if (card && !target.matches('.rc-select') && ctx.focusInnerButtons) {
      ctx.focusSelectButton(card.dataset['tabId'] ?? ctx.focusedId ?? '');
    } else if (!card && ctx.focusedId) {
      ctx.focusSelectButton(ctx.focusedId);
    } else return;
    event.preventDefault();
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || insideTablist) return;

  const currentId = card?.dataset['tabId'] ?? ctx.focusedId;
  const index = currentId ? ctx.orderedIds.indexOf(currentId) : -1;
  if (index < 0) return;
  let next: number;
  if (card) {
    switch (event.key) {
      case 'ArrowUp': next = Math.max(0, index - 1); break;
      case 'ArrowDown': next = Math.min(ctx.orderedIds.length - 1, index + 1); break;
      case 'Home': next = 0; break;
      case 'End': next = ctx.orderedIds.length - 1; break;
      default: return;
    }
  } else {
    const documentRoot =
      target === target.ownerDocument.body ||
      target === target.ownerDocument.documentElement;
    if (!documentRoot) {
      if (ctx.host && !ctx.host.contains(target)) return;
      for (
        let region: Element | null = target;
        region && region !== ctx.host;
        region = region.parentElement
      ) {
        const style = getComputedStyle(region);
        const scrollsHorizontally =
          /(auto|scroll)/.test(style.overflowX) &&
          region.scrollWidth > region.clientWidth;
        if (scrollsHorizontally) return;
      }
    }
    if (event.key === 'ArrowLeft') next = (index - 1 + ctx.orderedIds.length) % ctx.orderedIds.length;
    else if (event.key === 'ArrowRight') next = (index + 1) % ctx.orderedIds.length;
    else return;
  }
  const id = ctx.orderedIds[next];
  ctx.focus(id);
  ctx.focusSelectButton(id);
  event.preventDefault();
}
