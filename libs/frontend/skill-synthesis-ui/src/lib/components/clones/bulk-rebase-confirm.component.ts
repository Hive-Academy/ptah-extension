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
 */
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
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
    </dialog>
  `,
})
export class BulkRebaseConfirmComponent {
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
}
