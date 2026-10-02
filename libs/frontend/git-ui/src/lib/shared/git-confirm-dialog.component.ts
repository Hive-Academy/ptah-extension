import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

/** `danger` destroys work that exists nowhere else; `warning` is recoverable. */
export type GitConfirmDialogTone = 'danger' | 'warning';

let nextDialogId = 0;

/**
 * The one confirmation primitive for git-ui's destructive actions: reject
 * hunk, discard file, drop stash, abort operation, remove worktree, disk
 * conflict, replace-unsaved and open outside the workspace.
 *
 * Extracted from the hunk-revert dialog in `DiffViewComponent` and kept
 * CDK-free on purpose (TASK_2026_576 plan §25, superseding design-spec §2's
 * CDK Dialog line): a native `<dialog>` opened with `showModal()` already sits
 * in the browser's top layer, outside every stacking context of the panels
 * that host it, and the rest of the contract is small enough to own here.
 *
 * Contract:
 * - `role="alertdialog"`, `aria-modal`, labelled by the title and described by
 *   the description;
 * - focus moves to the non-destructive Cancel on open;
 * - Escape cancels, whether it arrives as a keydown or as the UA's own
 *   `cancel` close request;
 * - Tab and Shift+Tab toggle between the two buttons and never leave;
 * - focus returns to the invoking control on every close;
 * - no backdrop dismiss: an accidental click-out must not resolve a
 *   destructive question;
 * - unmounting while open closes through the same path, so focus is never
 *   stranded on `<body>`.
 */
@Component({
  selector: 'ptah-git-confirm-dialog',
  standalone: true,
  template: `
    @if (isOpen()) {
      <dialog
        #dialog
        class="modal"
        role="alertdialog"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
        [attr.aria-describedby]="descriptionId"
        data-testid="git-confirm-dialog"
        (cancel)="onDialogCancel($event)"
        (keydown)="onDialogKeydown($event)"
      >
        <div class="modal-box max-w-sm">
          <h3 [id]="titleId" class="font-bold text-base">{{ title() }}</h3>
          <p [id]="descriptionId" class="py-3 text-sm text-base-content-muted">
            {{ description() }}
          </p>
          <div class="modal-action">
            <button
              #cancelButton
              type="button"
              class="btn btn-sm"
              data-testid="git-confirm-cancel"
              (click)="cancel()"
            >
              {{ cancelLabel() }}
            </button>
            <button
              #confirmButton
              type="button"
              [class]="confirmClass()"
              data-testid="git-confirm-confirm"
              (click)="confirm()"
            >
              {{ confirmLabel() }}
            </button>
          </div>
        </div>
        <!-- Inert on purpose: daisyUI's click-to-close backdrop must not exist here. -->
        <div class="modal-backdrop" aria-hidden="true"></div>
      </dialog>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GitConfirmDialogComponent {
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly confirmLabel = input.required<string>();
  readonly cancelLabel = input<string>('Cancel');
  readonly tone = input<GitConfirmDialogTone>('danger');

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  private readonly idBase = `ptah-git-confirm-${++nextDialogId}`;
  protected readonly titleId = `${this.idBase}-title`;
  protected readonly descriptionId = `${this.idBase}-desc`;

  protected readonly isOpen = signal(false);

  /**
   * Solid fills only. The danger confirm carries `.err-solid-text` because
   * daisyUI's own `error-content` on `error` fails AA in both themes
   * (design-spec §0); `btn-outline` error is worse still.
   */
  protected readonly confirmClass = computed(() =>
    this.tone() === 'danger'
      ? 'btn btn-sm btn-error err-solid-text'
      : 'btn btn-sm btn-warning',
  );

  private readonly dialog =
    viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private readonly cancelButton =
    viewChild<ElementRef<HTMLButtonElement>>('cancelButton');
  private readonly confirmButton =
    viewChild<ElementRef<HTMLButtonElement>>('confirmButton');

  private returnFocus: HTMLElement | null = null;

  constructor() {
    // Promote the dialog into the top layer once `@if` has rendered it, then
    // focus Cancel explicitly so the safe choice is a guarantee of this
    // component rather than of the button order.
    effect(() => {
      if (!this.isOpen()) return;
      const dialog = this.dialog()?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
      this.cancelButton()?.nativeElement.focus();
    });

    // A `<dialog>` removed while still `open` skips its close steps and leaves
    // focus on `<body>`. Close through the same path instead. No output is
    // emitted: the owner is gone, and so is the question it asked.
    inject(DestroyRef).onDestroy(() => {
      if (this.isOpen()) this.close();
    });
  }

  /**
   * Ask the question. `invoker` gets focus back on every close. A second call
   * while open is ignored, so a double click cannot re-target the restore.
   */
  open(invoker: HTMLElement): void {
    if (this.isOpen()) return;
    this.returnFocus = invoker;
    this.isOpen.set(true);
  }

  protected confirm(): void {
    if (!this.isOpen()) return;
    this.close();
    this.confirmed.emit();
  }

  protected cancel(): void {
    if (!this.isOpen()) return;
    this.close();
    this.cancelled.emit();
  }

  /**
   * Escape is stopped here rather than on `document`: focus is inside the
   * dialog whenever it is open, and a key that dismisses a dialog must not
   * also reach anything behind it. With exactly two focusable elements, Tab
   * and Shift+Tab are the same two-way toggle.
   */
  protected onDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const cancel = this.cancelButton()?.nativeElement;
    const confirm = this.confirmButton()?.nativeElement;
    if (!cancel || !confirm) return;
    event.preventDefault();
    (document.activeElement === cancel ? confirm : cancel).focus();
  }

  /**
   * The UA's own Escape route bypasses the keydown handler and would close the
   * element while `isOpen` stayed set. Cancelling the default and calling the
   * same `cancel()` the button calls keeps one close path.
   */
  protected onDialogCancel(event: Event): void {
    event.preventDefault();
    this.cancel();
  }

  private close(): void {
    // Leave the top layer before `@if` unmounts the node, and make the focus
    // restore the last word: `close()` returns focus to whatever `showModal()`
    // remembered, which is not necessarily the control that asked.
    const dialog = this.dialog()?.nativeElement;
    if (dialog?.open) dialog.close();
    this.isOpen.set(false);
    const target = this.returnFocus;
    this.returnFocus = null;
    if (target?.isConnected) target.focus();
  }
}
