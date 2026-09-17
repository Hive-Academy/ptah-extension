/**
 * CloneBulkToolbarComponent — the Library's per-kind bulk-action toolbar.
 *
 * Second facade-rule extraction out of {@link SkillClonesViewComponent}, which
 * kept its selector, its state and every behaviour. This file owns one nameable
 * concern: the row that lets the user narrow the list to diverged entries, tells
 * them how many of those can be rebased, and offers the batch. It is the only
 * place the count is turned into English.
 *
 * Presentational. It receives counts already derived by `clone-action-gating`
 * and emits intent; it decides no eligibility rule and starts no write.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import type { BulkRebaseProgress } from '../../services/clone-bulk-rebase.service';

@Component({
  selector: 'ptah-clone-bulk-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="mb-3 flex flex-wrap items-center justify-between gap-2"
      data-testid="clones-bulk-bar"
    >
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        data-testid="clones-diverged-filter"
        [class.btn-active]="divergedOnly()"
        [attr.aria-pressed]="divergedOnly()"
        (click)="divergedOnlyToggled.emit(!divergedOnly())"
      >
        Show diverged only
      </button>

      <div class="flex flex-wrap items-center justify-end gap-2">
        <span
          class="text-xs text-base-content-muted"
          data-testid="clones-bulk-count"
          >{{ countLabel() }}</span
        >
        <button
          type="button"
          class="btn btn-warning btn-xs"
          data-testid="clones-bulk-rebase-btn"
          [attr.aria-label]="buttonLabel()"
          [attr.aria-describedby]="
            disabledReason() ? 'clones-bulk-reason' : null
          "
          [disabled]="eligibleCount() === 0 || locked()"
          (click)="bulkRebaseRequested.emit()"
        >
          {{ buttonText() }}
        </button>
      </div>

      @if (disabledReason(); as reason) {
        <p
          id="clones-bulk-reason"
          class="w-full text-right text-[11px] text-base-content-muted"
          data-testid="clones-bulk-disabled-reason"
        >
          {{ reason }}
        </p>
      }
    </div>
  `,
})
export class CloneBulkToolbarComponent {
  /** Eligible entries in the VISIBLE kind — what the batch would act on. */
  public readonly eligibleCount = input.required<number>();
  /** Eligible entries in the other kind tabs. Reported, never acted on. */
  public readonly otherKindCount = input<number>(0);
  public readonly divergedOnly = input<boolean>(false);
  /** A write is in flight — the batch control locks, the filter does not. */
  public readonly locked = input<boolean>(false);
  public readonly progress = input<BulkRebaseProgress | null>(null);

  public readonly divergedOnlyToggled = output<boolean>();
  public readonly bulkRebaseRequested = output<void>();

  /**
   * The residual clause exists so a user who cleared one tab does not believe
   * they are finished. It offers no action by design.
   */
  protected readonly countLabel = computed<string>(() => {
    const n = this.eligibleCount();
    const head =
      n === 1
        ? '1 diverged entry can be rebased'
        : `${n} diverged entries can be rebased`;
    const other = this.otherKindCount();
    return other > 0 ? `${head} (${other} in other kinds)` : head;
  });

  /** Accessible name — states the count even mid-batch, when the text changes. */
  protected readonly buttonLabel = computed<string>(
    () => `Rebase all ${this.eligibleCount()} diverged entries in this kind`,
  );

  protected readonly buttonText = computed<string>(() => {
    const p = this.progress();
    if (p !== null) return `Rebasing ${p.done + 1} of ${p.total}…`;
    return `Rebase all diverged (${this.eligibleCount()})`;
  });

  /**
   * R1.1: at zero eligible the control stays rendered and DISABLED with the
   * reason stated — silently absent reads as a missing feature.
   */
  protected readonly disabledReason = computed<string | null>(() =>
    this.eligibleCount() === 0
      ? 'Nothing to rebase in this kind — no diverged entry here has an ' +
        'upstream to rebase onto.'
      : null,
  );
}
