import { Injectable, signal } from '@angular/core';

export interface ConfirmationDialogCheckbox {
  id: string;
  label: string;
  defaultChecked?: boolean;
}

export interface ConfirmationDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmStyle?: 'primary' | 'error' | 'warning';
  checkboxes?: ConfirmationDialogCheckbox[];
}

export type ConfirmationDialogResult =
  | { confirmed: true; checkboxes: Record<string, boolean> }
  | { confirmed: false };

type BooleanResolver = (value: boolean) => void;
type ResultResolver = (value: ConfirmationDialogResult) => void;

@Injectable({ providedIn: 'root' })
export class ConfirmationDialogService {
  private readonly _isOpen = signal(false);
  private readonly _options = signal<ConfirmationDialogOptions | null>(null);
  readonly isOpen = this._isOpen.asReadonly();
  readonly options = this._options.asReadonly();

  private resolveBoolean: BooleanResolver | null = null;
  private resolveResult: ResultResolver | null = null;

  confirm(options: ConfirmationDialogOptions): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolveBoolean = resolve;
      this.resolveResult = null;
      this._options.set({
        confirmLabel: 'Confirm',
        cancelLabel: 'Cancel',
        confirmStyle: 'primary',
        ...options,
      });
      this._isOpen.set(true);
    });
  }

  confirmWithCheckboxes(
    options: ConfirmationDialogOptions,
  ): Promise<ConfirmationDialogResult> {
    return new Promise((resolve) => {
      this.resolveResult = resolve;
      this.resolveBoolean = null;
      this._options.set({
        confirmLabel: 'Confirm',
        cancelLabel: 'Cancel',
        confirmStyle: 'primary',
        ...options,
      });
      this._isOpen.set(true);
    });
  }

  handleConfirm(): void {
    this._isOpen.set(false);
    this._options.set(null);
    if (this.resolveBoolean) {
      this.resolveBoolean(true);
      this.resolveBoolean = null;
    }
    if (this.resolveResult) {
      this.resolveResult({ confirmed: true, checkboxes: {} });
      this.resolveResult = null;
    }
  }

  handleConfirmWithState(checkboxes: Record<string, boolean>): void {
    this._isOpen.set(false);
    this._options.set(null);
    if (this.resolveResult) {
      this.resolveResult({ confirmed: true, checkboxes: { ...checkboxes } });
      this.resolveResult = null;
    }
    if (this.resolveBoolean) {
      this.resolveBoolean(true);
      this.resolveBoolean = null;
    }
  }

  handleCancel(): void {
    this._isOpen.set(false);
    this._options.set(null);
    if (this.resolveBoolean) {
      this.resolveBoolean(false);
      this.resolveBoolean = null;
    }
    if (this.resolveResult) {
      this.resolveResult({ confirmed: false });
      this.resolveResult = null;
    }
  }
}
