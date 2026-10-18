import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  type AfterRenderRef,
} from '@angular/core';

import {
  ConfirmationDialogCheckbox,
  ConfirmationDialogOptions,
  ConfirmationDialogService,
} from '@ptah-extension/chat-state';
import { wrapTabWithin } from '../../utils/focus-wrap.utils';

let nextId = 0;

/**
 * The global confirm dialog. While open it is a modal layer: it is named by
 * its title, described by its message, keeps Tab inside its panel, cancels on
 * Escape, starts on Cancel (the safe choice for a destructive confirm) and
 * gives focus back to the opener after the close renders (TASK_2026_679,
 * plan component 6a).
 */
@Component({
  selector: 'ptah-confirmation-dialog',
  standalone: true,
  imports: [],
  template: `
    <dialog
      #dialog
      class="modal"
      [class.modal-open]="dialogService.isOpen()"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="messageId"
      (keydown)="onKeydown($event)"
    >
      <div #panel class="modal-box max-w-sm">
        @if (dialogService.options(); as options) {
          <h3 [id]="titleId" class="font-bold text-lg">{{ options.title }}</h3>
          <p [id]="messageId" class="py-4 text-base-content-muted">
            {{ options.message }}
          </p>
          @if (checkboxList().length > 0) {
            <div class="flex flex-col gap-2 pb-2">
              @for (cb of checkboxList(); track cb.id) {
                <label class="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm"
                    [checked]="checkboxState()[cb.id]"
                    (change)="onCheckboxChange(cb.id, $event)"
                  />
                  <span class="label-text">{{ cb.label }}</span>
                </label>
              }
            </div>
          }
          <div class="modal-action">
            <button #cancelButton class="btn btn-ghost" (click)="onCancel()">
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
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  private readonly idSuffix = nextId++;
  protected readonly titleId = `confirmation-dialog-title-${this.idSuffix}`;
  protected readonly messageId = `confirmation-dialog-message-${this.idSuffix}`;

  private readonly _checkboxState = signal<Record<string, boolean>>({});
  protected readonly checkboxState = this._checkboxState.asReadonly();

  protected readonly checkboxList = computed<ConfirmationDialogCheckbox[]>(
    () => this.dialogService.options()?.checkboxes ?? [],
  );

  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly cancelButton =
    viewChild<ElementRef<HTMLButtonElement>>('cancelButton');

  private lastSeenOptions: ConfirmationDialogOptions | null = null;
  private wasOpen = false;
  /** The element focused when the dialog opened; focus returns to it on close. */
  private opener: HTMLElement | null = null;
  /** The single-shot focus move scheduled by the last open or close. */
  private pendingFocus: AfterRenderRef | null = null;

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

    // Focus in on open, and back to the opener once the close has rendered
    // (R2: by then the layer below is no longer inert).
    effect(() => {
      const open = this.dialogService.isOpen();
      untracked(() => this.onOpenChange(open));
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.dialogService.isOpen()) return;
    if (event.key === 'Escape') {
      if (event.isComposing) return;
      event.preventDefault();
      // A document-level Escape listener (canvas) must not also fire (R4).
      event.stopPropagation();
      this.onCancel();
      return;
    }
    wrapTabWithin(this.panel().nativeElement, event);
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

  private onOpenChange(open: boolean): void {
    if (open === this.wasOpen) return;
    this.wasOpen = open;
    this.pendingFocus?.destroy();
    if (open) {
      // A reopen before the last close rendered keeps the first opener.
      this.opener ??= this.focusedElement();
      this.pendingFocus = afterNextRender(
        () => {
          this.pendingFocus = null;
          this.cancelButton()?.nativeElement.focus();
        },
        { injector: this.injector },
      );
      return;
    }
    const opener = this.opener;
    this.pendingFocus = afterNextRender(
      () => {
        this.pendingFocus = null;
        this.opener = null;
        // Gone or still inert: leave focus alone; the caller owns the fallback.
        if (opener?.isConnected && !opener.closest('[inert]')) opener.focus();
      },
      { injector: this.injector },
    );
  }

  /** The focused element, or null when nothing but the page itself has focus. */
  private focusedElement(): HTMLElement | null {
    const active = this.document.activeElement;
    const view = this.document.defaultView;
    if (!view || !(active instanceof view.HTMLElement)) return null;
    return active === this.document.body ? null : active;
  }
}
