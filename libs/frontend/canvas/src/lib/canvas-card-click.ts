/** Ignore clicks on controls and text selection inside a card. */
export function isIgnoredCardClick(event: MouseEvent, host: HTMLElement): boolean {
  if (isInteractiveTarget(event.target, host)) return true;
  const selection = window.getSelection();
  if (
    selection &&
    !selection.isCollapsed &&
    selection.toString().trim() &&
    selection.anchorNode &&
    host.contains(selection.anchorNode)
  )
    return true;
  return false;
}

/** True for a control inside the tile; the card-mode host is itself a role="button". */
export function isInteractiveTarget(target: EventTarget | null, host: HTMLElement): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  const control = target.closest(
    'button, a, input, textarea, select, [role="button"], [contenteditable="true"]',
  );
  return control !== null && control !== host;
}
