import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmationDialogService } from '../../services/confirmation-dialog.service';

/**
 * ConfirmationDialogComponent - DaisyUI modal for confirmations
 *
 * Purpose:
 * - Replaces window.confirm() which doesn't work in VS Code webviews
 * - Uses HTML dialog element with DaisyUI styling
 * - Reactive via signals from ConfirmationDialogService
 *
 * Usage:
 * Place once in your app shell:
 * ```html
 * <ptah-confirmation-dialog />
 * ```
 */
@Component({
  selector: 'ptah-confirmation-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    <dialog #dialog class="modal" [class.modal-open]="dialogService.isOpen()">
      <div class="modal-box max-w-sm">
        @if (dialogService.options(); as options) {
        <h3 class="font-bold text-lg">{{ options.title }}</h3>
        <p class="py-4 text-base-content/80">{{ options.message }}</p>
        <div class="modal-action">
          <button class="btn btn-ghost" (click)="dialogService.handleCancel()">
            {{ options.cancelLabel }}
          </button>
          <button
            class="btn"
            [class.btn-primary]="options.confirmStyle === 'primary'"
            [class.btn-error]="options.confirmStyle === 'error'"
            [class.btn-warning]="options.confirmStyle === 'warning'"
            (click)="dialogService.handleConfirm()"
          >
            {{ options.confirmLabel }}
          </button>
        </div>
        }
      </div>
      <!-- Click outside to cancel -->
      <form method="dialog" class="modal-backdrop">
        <button (click)="dialogService.handleCancel()">close</button>
      </form>
    </dialog>
  `,
})
export class ConfirmationDialogComponent {
  protected readonly dialogService = inject(ConfirmationDialogService);
}
