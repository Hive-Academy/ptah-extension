import {
  afterNextRender,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
} from '@angular/core';
import { AppsSessionService } from '../services/apps-session.service';

/** Restores the workspace's last control when the Apps page is mounted. */
@Directive({
  selector: '[ptahAppsFocusMemory]',
  standalone: true,
  host: { tabindex: '-1' },
})
export class AppsFocusMemoryDirective {
  private readonly host =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly session = inject(AppsSessionService);

  public constructor() {
    const destroyRef = inject(DestroyRef);
    const onFocus = (event: FocusEvent): void => {
      try {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const control = target.closest('[data-apps-focus-key]');
        if (control && this.host.contains(control)) {
          this.session.recordFocusKey(
            control.getAttribute('data-apps-focus-key'),
          );
        }
      } catch (error: unknown) {
        void error;
        // A removed control or unavailable host must not break navigation.
      }
    };
    this.host.addEventListener('focusin', onFocus);
    const render = afterNextRender(() => this.restoreFocus());
    destroyRef.onDestroy(() => {
      this.host.removeEventListener('focusin', onFocus);
      render.destroy();
    });
  }

  private restoreFocus(): void {
    try {
      const key = this.session.lastFocusKey();
      if (key !== null) {
        for (const control of this.host.querySelectorAll<HTMLElement>(
          '[data-apps-focus-key]',
        )) {
          if (control.getAttribute('data-apps-focus-key') !== key) continue;
          if (!this.canFocus(control)) continue;
          control.focus();
          if (this.host.ownerDocument.activeElement === control) return;
        }
      }
    } catch (error: unknown) {
      void error;
      // Fall back even if a control's focus implementation throws.
    }
    try {
      this.host.focus();
    } catch (error: unknown) {
      void error;
      // Focus restoration is best effort; no timers or deferred retries.
    }
  }

  private canFocus(control: HTMLElement): boolean {
    if (!control.isConnected || !this.host.contains(control)) return false;
    if (control.matches(':disabled, [aria-disabled="true"]')) return false;
    if (control.closest('[hidden], [inert]')) return false;
    if (
      !control.matches(
        'button, input:not([type="hidden"]), select, textarea, a[href], area[href], summary, iframe, [tabindex], [contenteditable]:not([contenteditable="false"])',
      )
    )
      return false;
    for (
      let node: HTMLElement | null = control;
      node;
      node = node.parentElement
    ) {
      const style = node.ownerDocument.defaultView?.getComputedStyle(node);
      if (
        style?.display === 'none' ||
        style?.visibility === 'hidden' ||
        style?.visibility === 'collapse'
      )
        return false;
    }
    return true;
  }
}
