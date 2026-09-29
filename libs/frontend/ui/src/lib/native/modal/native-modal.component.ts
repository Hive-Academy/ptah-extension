/**
 * NativeModalComponent - Centered modal dialog on the native `<dialog>` API.
 *
 * A domain-free, centered modal for card-driven views. Unlike the drawer and
 * popover, which are plain `<div>`s and therefore hand-write their Tab-trap,
 * Escape handling and focus-restore in TypeScript, this component is a real
 * `<dialog>` element opened with `showModal()`:
 * - `showModal()` traps focus inside the dialog and, on `close()`, returns
 *   focus to the element that had focus before it opened — both per the HTML
 *   Living Standard, with no extra code
 * - Escape fires a native `cancel` event, which the component only forwards
 *   to the parent
 * - a backdrop click requests closure
 *
 * Visibility is driven entirely by `showModal()`/`close()` — never by the
 * daisyUI `modal-open` class toggle, which gives none of the above for free.
 *
 * Follows the same control contract as the other `Native*` overlays: the
 * PARENT owns visibility (`isOpen`) and the modal only ever *requests*
 * closure via {@link closed}.
 *
 * Three projection slots: `[modal-header]`, default (body) and
 * `[modal-footer]`.
 *
 * @example
 * ```html
 * <ptah-native-modal
 *   [isOpen]="isOpen()"
 *   ariaLabel="Connect a provider"
 *   size="lg"
 *   (closed)="isOpen.set(false)"
 * >
 *   <h3 modal-header>Connect a provider</h3>
 *   <div>…body…</div>
 *   <div modal-footer><button class="btn btn-ghost" (click)="close()">Cancel</button></div>
 * </ptah-native-modal>
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  isDevMode,
  output,
  viewChild,
} from '@angular/core';

/** Modal width preset, mapped to a `modal-box` max-width class. */
export type NativeModalSize = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<NativeModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

@Component({
  selector: 'ptah-native-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      class="modal"
      data-testid="native-modal-dialog"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-labelledby]="ariaLabelledby()"
      (cancel)="onCancel()"
    >
      <div class="modal-box" [class]="boxClass()">
        <ng-content select="[modal-header]" />
        <ng-content />
        <ng-content select="[modal-footer]" />
      </div>
      <form method="dialog" class="modal-backdrop">
        <button (click)="requestClose()">close</button>
      </form>
    </dialog>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class NativeModalComponent implements OnDestroy {
  /** Whether the modal is open. Owned by the parent. */
  readonly isOpen = input.required<boolean>();

  /** Accessible name of the dialog (a `<dialog>` has no implicit name). */
  readonly ariaLabel = input<string>();

  /**
   * `id` of the visible dialog title to name the dialog via
   * `aria-labelledby`. Exactly one of this and {@link ariaLabel} must be
   * passed; an unnamed dialog is unusable for assistive tech, so dev mode
   * reports the omission.
   */
  readonly ariaLabelledby = input<string>();

  /** Width preset of the `modal-box`. @default 'md' */
  readonly size = input<NativeModalSize>('md');

  /**
   * The modal is asking to be closed (Escape via `cancel`, backdrop click).
   * The parent must flip `isOpen` — the modal never closes itself.
   */
  readonly closed = output<void>();

  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const dialog = this.dialog()?.nativeElement;
      if (!dialog) return;
      if (this.isOpen()) {
        dialog.showModal();
      } else {
        dialog.close();
      }
    });

    // A dialog must always carry an accessible name. The siblings get this
    // for free (the drawer defaults its label), so the modal only reports
    // the omission in dev mode instead of throwing.
    effect(() => {
      if (!this.ariaLabel() && !this.ariaLabelledby() && isDevMode()) {
        console.error(
          'ptah-native-modal requires an accessible name: pass ariaLabel or ariaLabelledby.',
        );
      }
    });
  }

  protected boxClass(): string {
    return SIZE_CLASSES[this.size()] ?? '';
  }

  /**
   * Escape: the browser fires `cancel` on a dialog opened with `showModal()`.
   * Forward the request only — the parent's `isOpen` drives the actual
   * `close()` through the effect above, and the native Esc path may also have
   * closed the dialog itself already.
   */
  protected onCancel(): void {
    this.closed.emit();
  }

  /** Backdrop click requests closure. */
  protected requestClose(): void {
    this.closed.emit();
  }

  ngOnDestroy(): void {
    const dialog = this.dialog()?.nativeElement;
    if (dialog?.open) {
      dialog.close();
      // The dialog just closed, so the parent's `isOpen` must not stay
      // stale. Emitting during teardown is safe: if the subscriber is
      // already gone, Angular drops the event silently.
      this.closed.emit();
    }
  }
}