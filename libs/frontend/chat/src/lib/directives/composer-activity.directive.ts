import {
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  signal,
} from '@angular/core';

/** True when a native popover (`popover` attribute) under `root` is shown. */
function hasOpenPopover(root: HTMLElement): boolean {
  try {
    return root.querySelector(':popover-open') !== null;
  } catch {
    // Engines without the `:popover-open` selector (test DOMs) have none open.
    return false;
  }
}

/**
 * Reports whether the user is busy inside a composer region: focus within it,
 * and whether one of its native popovers (attach menu, model menu, approval
 * chip) is open. The streaming composer stays expanded while either is true.
 *
 * Popover `toggle` events do not bubble, so one capture listener on the host
 * sees every popover below it; it is removed when the host is destroyed.
 */
@Directive({
  selector: '[ptahComposerActivity]',
  host: {
    '(focusin)': 'focusWithin.set(true)',
    '(focusout)': 'onFocusOut()',
  },
})
export class ComposerActivityDirective {
  private readonly host: HTMLElement = inject(ElementRef<HTMLElement>)
    .nativeElement;

  /** Focus is on the host or one of its descendants. */
  readonly focusWithin = signal(false);
  /** A native popover below the host is open. */
  readonly popoverOpen = signal(false);

  constructor() {
    const onToggle = (): void =>
      this.popoverOpen.set(hasOpenPopover(this.host));
    this.host.addEventListener('toggle', onToggle, true);
    inject(DestroyRef).onDestroy(() =>
      this.host.removeEventListener('toggle', onToggle, true),
    );
  }

  /**
   * Re-read the focus after the move settles. A focus move inside the host
   * keeps it; a window blur leaves `activeElement` in place, so switching
   * apps does not count as leaving the composer.
   */
  protected onFocusOut(): void {
    queueMicrotask(() =>
      this.focusWithin.set(
        this.host.contains(this.host.ownerDocument.activeElement),
      ),
    );
  }
}
