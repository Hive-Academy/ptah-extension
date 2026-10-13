export interface CanvasRailKeyboardContext {
  readonly surfaceActive: boolean;
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
    if (event.key === 'ArrowLeft') next = (index - 1 + ctx.orderedIds.length) % ctx.orderedIds.length;
    else if (event.key === 'ArrowRight') next = (index + 1) % ctx.orderedIds.length;
    else return;
  }
  const id = ctx.orderedIds[next];
  ctx.focus(id);
  ctx.focusSelectButton(id);
  event.preventDefault();
}
