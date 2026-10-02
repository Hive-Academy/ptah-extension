import { DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';

/** Keys that still work on a busy control: leaving it (Tab), and closing what holds it (Esc). */
const PASS_KEYS: ReadonlySet<string> = new Set(['Tab', 'Escape']);

/**
 * "Disabled while a save runs" without dropping focus (TASK_2026_555 Batch 54.1; the 36b move buttons, 36d Cursor
 * popover and 51.2 rule, now shared).
 *
 * A native `disabled` on the control the user just used moves focus to `body`. Keyboard users then lose their place,
 * and Esc no longer reaches the popover or drawer that holds the control (Gate V 36 M-2, re-check 2 N3, Batch 38
 * re-check 1 N1). Bound instead of `[disabled]`, this directive keeps the control focusable:
 * - it sets `aria-disabled="true"`, which assistive tech reads as disabled; the shared Settings rule in the app styles
 *   gives it the disabled look;
 * - a text field becomes `readOnly`;
 * - a click (and so a checkbox toggle or a radio pick) is cancelled before the control's own handlers run;
 * - the keys that would change a select or a field are cancelled. Tab and Esc still work.
 *
 * The handlers keep their own busy guard (D3); a refused save still alerts and reverts (D15). Use it only for a control
 * that is disabled because a save or check runs, where focus can sit at that moment. A control disabled for a lasting
 * reason (nothing to save, not loaded) can stay natively disabled.
 */
@Directive({
  selector: '[ptahBusyDisabled]',
  standalone: true,
  host: {
    '[attr.aria-disabled]': 'ptahBusyDisabled() ? "true" : null',
    '[attr.readonly]': 'textField && ptahBusyDisabled() ? "" : null',
  },
})
export class SettingsBusyDisabledDirective {
  readonly ptahBusyDisabled = input<boolean>(false);

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** A text-like field: it keeps focus and its value, and only refuses edits (readOnly). */
  protected readonly textField = this.element instanceof HTMLTextAreaElement
    || (this.element instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(this.element.type));

  constructor() {
    const block = (event: Event): void => {
      if (!this.ptahBusyDisabled()) return;
      if (event instanceof KeyboardEvent && PASS_KEYS.has(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    // Capture listeners on the control itself run before its own (bubble-phase) template handlers.
    const events = ['click', 'mousedown', 'keydown', 'change', 'input'] as const;
    for (const type of events) this.element.addEventListener(type, block, true);
    inject(DestroyRef).onDestroy(() => {
      for (const type of events) this.element.removeEventListener(type, block, true);
    });
  }
}
