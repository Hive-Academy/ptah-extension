import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import { NgClass } from '@angular/common';

/**
 * ConfirmationModalComponent - Reusable DaisyUI modal for confirmations and alerts
 *
 * Purpose:
 * - Replace window.confirm() and alert() which don't work in VS Code webviews
 * - Provide promise-based API for async/await usage
 * - Support both confirm mode (two buttons) and alert mode (one button)
 *
 * Features:
 * - DaisyUI modal styling
 * - Modal closes on backdrop click or ESC key
 * - Signal-based inputs for reactivity
 * - Output events for confirmed/cancelled actions
 * - Flexible button text customization
 * - Optional confirmClass for different button styles (primary, error, etc.)
 *
 * Usage (Confirm Mode):
 * ```typescript
 *
 * async onDelete() {
 *   this.confirmModal.show();
 *   const confirmed = await new Promise<boolean>((resolve) => {
 *     const confirmedSub = this.confirmModal.confirmed.subscribe(() => {
 *       resolve(true);
 *       confirmedSub.unsubscribe();
 *       cancelledSub.unsubscribe();
 *     });
 *     const cancelledSub = this.confirmModal.cancelled.subscribe(() => {
 *       resolve(false);
 *       confirmedSub.unsubscribe();
 *       cancelledSub.unsubscribe();
 *     });
 *   });
 *   if (confirmed) {
 *     // User confirmed
 *   }
 * }
 * ```
 *
 * Usage (Alert Mode):
 * ```typescript
 *
 * async showInfo() {
 *   this.alertModal.show();
 *   await new Promise<void>((resolve) => {
 *     const sub = this.alertModal.confirmed.subscribe(() => {
 *       resolve();
 *       sub.unsubscribe();
 *     });
 *   });
 * }
 * ```
 *
 * Template:
 * ```html
 * <ptah-confirmation-modal
 *   #confirmModal
 *   [title]="'Delete Item?'"
 *   [message]="'This action cannot be undone.'"
 *   [confirmText]="'Delete'"
 *   [cancelText]="'Cancel'"
 *   [confirmClass]="'btn-error'"
 *   (confirmed)="onConfirmed()"
 *   (cancelled)="onCancelled()"
 * />
 *
 * <!-- Alert mode example -->
 * <ptah-confirmation-modal
 *   #alertModal
 *   [title]="'Information'"
 *   [message]="'Feature coming soon!'"
 *   [mode]="'alert'"
 *   [confirmText]="'OK'"
 *   (confirmed)="onOkClicked()"
 * />
 * ```
 */
@Component({
  selector: 'ptah-confirmation-modal',
  standalone: true,
  imports: [NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #modal class="modal">
      <div class="modal-box">
        <h3 class="font-bold text-lg">{{ title() }}</h3>
        <p class="py-4">{{ message() }}</p>
        <div class="modal-action">
          @if (mode() !== 'alert') {
          <button class="btn btn-ghost" (click)="onCancel()">
            {{ cancelText() }}
          </button>
          }
          <button
            class="btn"
            [ngClass]="mode() === 'alert' ? 'btn-primary' : confirmClass()"
            (click)="onConfirm()"
          >
            {{ confirmText() }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button (click)="onCancel()">close</button>
      </form>
    </dialog>
  `,
})
export class ConfirmationModalComponent {
  readonly modal = viewChild.required<ElementRef<HTMLDialogElement>>('modal');

  // Inputs
  public readonly title = input.required<string>();
  public readonly message = input.required<string>();
  public readonly confirmText = input<string>('Confirm');
  public readonly cancelText = input<string>('Cancel');
  public readonly mode = input<'confirm' | 'alert'>('confirm');
  public readonly confirmClass = input<string>('btn-primary');

  // Outputs
  confirmed = output<void>();
  cancelled = output<void>();

  /**
   * Show the modal
   */
  show(): void {
    this.modal().nativeElement.showModal();
  }

  /**
   * Hide the modal
   */
  hide(): void {
    this.modal().nativeElement.close();
  }

  /**
   * Handle confirm button click
   */
  protected onConfirm(): void {
    this.confirmed.emit();
    this.hide();
  }

  /**
   * Handle cancel button click or backdrop close
   */
  protected onCancel(): void {
    this.cancelled.emit();
    this.hide();
  }
}
