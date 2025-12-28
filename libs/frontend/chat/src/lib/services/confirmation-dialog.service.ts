import { Injectable, signal } from '@angular/core';

/**
 * Confirmation dialog options
 */
export interface ConfirmationDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmStyle?: 'primary' | 'error' | 'warning';
}

/**
 * ConfirmationDialogService - Manages confirmation dialogs in VS Code webview
 *
 * Purpose:
 * - Replaces window.confirm() which doesn't work in VS Code webviews (sandboxed)
 * - Provides a signal-based, async confirmation dialog
 * - Uses DaisyUI modal styling
 *
 * Usage:
 * ```typescript
 * const confirmed = await confirmationDialog.confirm({
 *   title: 'Close Tab?',
 *   message: 'This session has unsaved changes. Are you sure?',
 *   confirmLabel: 'Close',
 *   confirmStyle: 'error'
 * });
 * if (confirmed) { ... }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class ConfirmationDialogService {
  // ============================================================================
  // STATE SIGNALS
  // ============================================================================

  private readonly _isOpen = signal(false);
  private readonly _options = signal<ConfirmationDialogOptions | null>(null);

  // Public readonly signals
  readonly isOpen = this._isOpen.asReadonly();
  readonly options = this._options.asReadonly();

  // Promise resolver for async confirmation
  private resolvePromise: ((value: boolean) => void) | null = null;

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Show a confirmation dialog and wait for user response
   * @param options - Dialog options
   * @returns Promise that resolves to true if confirmed, false if cancelled
   */
  confirm(options: ConfirmationDialogOptions): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this._options.set({
        confirmLabel: 'Confirm',
        cancelLabel: 'Cancel',
        confirmStyle: 'primary',
        ...options,
      });
      this._isOpen.set(true);
    });
  }

  /**
   * Called when user clicks confirm button
   */
  handleConfirm(): void {
    this._isOpen.set(false);
    this._options.set(null);
    if (this.resolvePromise) {
      this.resolvePromise(true);
      this.resolvePromise = null;
    }
  }

  /**
   * Called when user clicks cancel button or closes dialog
   */
  handleCancel(): void {
    this._isOpen.set(false);
    this._options.set(null);
    if (this.resolvePromise) {
      this.resolvePromise(false);
      this.resolvePromise = null;
    }
  }
}
