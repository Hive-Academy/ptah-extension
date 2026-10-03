/**
 * Spec helper (TASK_2026_555 Batch 54.1): a Settings control reads as disabled when it is natively disabled or
 * disabled while a save runs (`ptahBusyDisabled`: `aria-disabled="true"`, still focusable). `undefined` for a missing
 * element, so a spec never passes on an element that is not there.
 */
export function isDisabledControl(element: Element | null | undefined): boolean | undefined {
  if (!element) return undefined;
  return (element as HTMLButtonElement).disabled === true || element.getAttribute('aria-disabled') === 'true';
}
