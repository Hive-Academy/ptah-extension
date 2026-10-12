import type { CanvasDetailService } from './canvas-detail.service';

export function handleCanvasDetailKeydown(
  event: KeyboardEvent,
  surfaceActive: boolean,
  detailTabId: string | null,
  detail: CanvasDetailService,
): void {
  if (!surfaceActive || !detailTabId || event.defaultPrevented) return;
  const target = event.target;
  if (
    target instanceof Element &&
    (target.closest(
      'input, textarea, select, [contenteditable], [role="menu"], [role="listbox"], [role="dialog"], [popover], [role="tablist"], [role="tab"]',
    ) ||
      (target instanceof HTMLElement && target.isContentEditable))
  )
    return;
  if (event.key === 'Escape') {
    detail.close();
    event.preventDefault();
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === 'ArrowRight') detail.next();
  else if (event.key === 'ArrowLeft') detail.prev();
  else return;
  event.preventDefault();
}
