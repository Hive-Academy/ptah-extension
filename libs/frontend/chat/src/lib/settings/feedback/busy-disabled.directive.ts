import { DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';

/** Keys that still work on a busy control: leaving it (Tab), and closing what holds it (Esc). */
const PASS_KEYS: ReadonlySet<string> = new Set(['Tab', 'Escape']);
/** Caret keys: they only move within a read-only text field, so they pass there (Batch 55b m-4). */
const CARET_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
/** Input types that are not text: they are toggled or picked, not read-only-able. */
const NOT_TEXT_TYPES: ReadonlySet<string> = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

/** Ctrl/Cmd+C (copy) or Ctrl/Cmd+A (select all): they read, never change, so they pass on any busy control. */
const isCopyOrSelectAll = (event: KeyboardEvent): boolean =>
  (event.ctrlKey || event.metaKey) && !event.altKey && ['c', 'a'].includes(event.key.toLowerCase());

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
 * - the keys that would change a select or a field are cancelled. Tab, Esc, copy and select-all still work, and a
 *   read-only text field still takes the caret keys and a mouse selection (Batch 55b m-4).
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
    '[attr.readonly]': 'isTextField() && ptahBusyDisabled() ? "" : null',
  },
})
export class SettingsBusyDisabledDirective {
  readonly ptahBusyDisabled = input<boolean>(false);

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** A text-like field: it keeps focus and its value, and only refuses edits (readOnly). Read each time: a bound
   * `[type]` may change. */
  protected isTextField(): boolean {
    return this.element instanceof HTMLTextAreaElement
      || (this.element instanceof HTMLInputElement && !NOT_TEXT_TYPES.has(this.element.type));
  }

  /** What a busy control still lets through: nothing here changes a value or starts a save. */
  private passes(event: Event): boolean {
    if (event instanceof KeyboardEvent) {
      return PASS_KEYS.has(event.key) || isCopyOrSelectAll(event) || (CARET_KEYS.has(event.key) && this.isTextField());
    }
    // A read-only field can still be pressed to place the caret or select text; its click stays refused.
    return event.type === 'mousedown' && this.isTextField();
  }

  constructor() {
    const block = (event: Event): void => {
      if (!this.ptahBusyDisabled() || this.passes(event)) return;
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
