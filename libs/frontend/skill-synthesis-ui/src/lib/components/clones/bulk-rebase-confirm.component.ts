/**
 * BulkRebaseConfirmComponent — the consent gate in front of "Rebase all
 * diverged".
 *
 * Extracted from {@link SkillClonesViewComponent} under the facade rule: the
 * view kept its selector, its state and every behaviour, and this file took the
 * one nameable concern — asking the user to confirm a destructive batch — that
 * pushed the view past the 700-line ceiling. It is NOT a `helpers` split: it
 * has its own inputs, its own output and its own accessible dialog contract.
 *
 * Strictly presentational. It knows the count and whether a batch is already in
 * flight; it does not know what a rebase is, cannot decide eligibility, and
 * starts no write. Nothing happens until `confirmed` fires.
 *
 * Dismissal is real, not decorative: Escape, the backdrop and Cancel all emit
 * `cancelled`, focus starts on Cancel (the safe control) and returns to the
 * opener on destroy. What it does NOT have is a focus TRAP — Tab can still
 * leave the dialog, exactly as in `ptah-confirmation-dialog` and
 * `ptah-update-dialog`. Trapping needs `showModal()`, which this repository
 * rejects for Electron dialogs (top-layer conflict with the native file-ops
 * dialogs the e2e specs guard), or a shared CDK-based primitive that every
 * daisyUI modal here would move to at once.
 */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  input,
  output,
  viewChild,
} from '@angular/core';

import { BULK_REBASE_EXPLANATION } from './clone-action-gating';

@Component({
  selector: 'ptah-bulk-rebase-confirm',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      class="modal modal-open"
      role="dialog"
      aria-modal="true"
      aria-label="Rebase all diverged entries"
      data-testid="clones-bulk-modal"
      (keydown.escape)="cancelled.emit()"
    >
      <div class="modal-box">
        <h3 class="text-base font-semibold">
          Rebase all diverged &mdash;
          <span data-testid="clones-bulk-modal-count"
            >{{ count() }} {{ count() === 1 ? 'entry' : 'entries' }}</span
          >
        </h3>
        <p
          class="mt-2 text-sm text-base-content-muted"
          data-testid="clones-bulk-explanation"
        >
          {{ explanation }}
        </p>
        <div class="modal-action">
          <button
            #cancelButton
            type="button"
            class="btn btn-sm"
            data-testid="clones-bulk-cancel"
            (click)="cancelled.emit()"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-warning btn-sm"
            data-testid="clones-bulk-confirm"
            [attr.aria-label]="
              'Rebase all ' + count() + ' diverged entries in this kind'
            "
            [disabled]="busy()"
            (click)="confirmed.emit()"
          >
            Rebase {{ count() }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button
          type="button"
          data-testid="clones-bulk-backdrop"
          (click)="cancelled.emit()"
        >
          close
        </button>
      </form>
    </dialog>
  `,
})
export class BulkRebaseConfirmComponent implements OnDestroy {
  /** How many entries the batch will act on. Named in the heading and on Confirm. */
  public readonly count = input.required<number>();
  /** Another write is in flight — Confirm is locked, Cancel stays reachable. */
  public readonly busy = input<boolean>(false);

  public readonly confirmed = output<void>();
  /**
   * Dismissed without writing. Named `cancelled`, not `cancel`:
   * `@angular-eslint/no-output-native` rejects an output that shadows a
   * standard DOM event.
   */
  public readonly cancelled = output<void>();

  protected readonly explanation = BULK_REBASE_EXPLANATION;

  private readonly cancelButton =
    viewChild<ElementRef<HTMLButtonElement>>('cancelButton');

  /**
   * Whatever had focus when this dialog opened — the "Rebase all diverged"
   * control, in every reachable path. Restored on destroy so dismissing a
   * destructive confirmation does not drop a keyboard user at the top of the
   * document.
   */
  private readonly previouslyFocused =
    typeof document === 'undefined'
      ? null
      : (document.activeElement as HTMLElement | null);

  public constructor() {
    // Focus starts on the SAFE control. The dialog also needs focus inside it
    // for `(keydown.escape)` to reach the handler at all: this is a daisyUI
    // class-driven `<dialog>`, deliberately not `showModal()` (see
    // `update-dialog.component.ts` — the top layer competes with the native
    // file-ops dialogs the Electron e2e specs guard), so the browser delivers
    // neither automatic initial focus nor a native `cancel` event.
    afterNextRender(() => this.cancelButton()?.nativeElement.focus());
  }

  public ngOnDestroy(): void {
    const target = this.previouslyFocused;
    if (target?.isConnected) target.focus();
  }
}
