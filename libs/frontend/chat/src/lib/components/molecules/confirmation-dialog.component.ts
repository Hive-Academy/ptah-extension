import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import {
  ConfirmationDialogCheckbox,
  ConfirmationDialogOptions,
  ConfirmationDialogService,
} from '@ptah-extension/chat-state';

@Component({
  selector: 'ptah-confirmation-dialog',
  standalone: true,
  imports: [],
  template: `
    <dialog #dialog class="modal" [class.modal-open]="dialogService.isOpen()">
      <div class="modal-box max-w-sm">
        @if (dialogService.options(); as options) {
          <h3 class="font-bold text-lg">{{ options.title }}</h3>
          <p class="py-4 text-base-content/80">{{ options.message }}</p>
          @if (checkboxList().length > 0) {
            <div class="flex flex-col gap-2 pb-2">
              @for (cb of checkboxList(); track cb.id) {
                <label class="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm"
                    [checked]="checkboxState()[cb.id] ?? false"
                    (change)="onCheckboxChange(cb.id, $event)"
                  />
                  <span class="label-text">{{ cb.label }}</span>
                </label>
              }
            </div>
          }
          <div class="modal-action">
            <button
              class="btn btn-ghost"
              (click)="onCancel()"
            >
              {{ options.cancelLabel }}
            </button>
            <button
              class="btn"
              [class.btn-primary]="options.confirmStyle === 'primary'"
              [class.btn-error]="options.confirmStyle === 'error'"
              [class.btn-warning]="options.confirmStyle === 'warning'"
              (click)="onConfirm()"
            >
              {{ options.confirmLabel }}
            </button>
          </div>
        }
      </div>
      <form method="dialog" class="modal-backdrop">
        <button (click)="onCancel()">close</button>
      </form>
    </dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmationDialogComponent {
  protected readonly dialogService = inject(ConfirmationDialogService);

  private readonly _checkboxState = signal<Record<string, boolean>>({});
  protected readonly checkboxState = this._checkboxState.asReadonly();

  protected readonly checkboxList = computed<ConfirmationDialogCheckbox[]>(
    () => this.dialogService.options()?.checkboxes ?? [],
  );

  private lastSeenOptions: ConfirmationDialogOptions | null = null;

  constructor() {
    effect(() => {
      const options = this.dialogService.options();
      if (options === this.lastSeenOptions) {
        return;
      }
      this.lastSeenOptions = options;
      const initial: Record<string, boolean> = {};
      for (const cb of options?.checkboxes ?? []) {
        initial[cb.id] = cb.defaultChecked ?? false;
      }
      this._checkboxState.set(initial);
    });
  }

  protected onCheckboxChange(id: string, event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const checked = target?.checked ?? false;
    this._checkboxState.update((prev) => ({ ...prev, [id]: checked }));
  }

  protected onConfirm(): void {
    if (this.checkboxList().length > 0) {
      this.dialogService.handleConfirmWithState(this._checkboxState());
    } else {
      this.dialogService.handleConfirm();
    }
  }

  protected onCancel(): void {
    this.dialogService.handleCancel();
  }
}
