import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { FileDecision } from '@ptah-extension/shared';
import {
  BULK_GROUP_LABEL,
  bulkCountLabel,
  controllableCount,
  type DecisionKind,
  type DecisionRow,
} from './preview-decisions.state';

/**
 * C4 BulkDecisionBar: "Keep all" / "Replace all" above the file list.
 *
 * Hidden when no row can be replaced. It only emits the choice; the surface
 * applies it with `setAllDecisions`, which never changes a forced-keep row.
 * No second confirmation: nothing is written until Confirm, whose label counts
 * the replacements.
 */
@Component({
  selector: 'ptah-bulk-decision-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (count() > 0) {
      <div
        role="group"
        class="mb-2 flex flex-wrap items-center gap-2 border-b border-surface-border pb-2 pt-1.5 text-xs"
        data-testid="bulk-decision-bar"
        [attr.aria-label]="groupLabel"
      >
        <strong class="flex-1">{{ countLabel() }}</strong>
        <button
          type="button"
          class="btn btn-ghost btn-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          data-testid="bulk-keep"
          [disabled]="disabled()"
          (click)="applyAll.emit('keep')"
        >
          Keep all
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          data-testid="bulk-replace"
          [disabled]="disabled()"
          (click)="applyAll.emit('replace')"
        >
          Replace all
        </button>
      </div>
    }
  `,
})
export class BulkDecisionBarComponent {
  public readonly rows = input.required<readonly DecisionRow[]>();
  public readonly kind = input.required<DecisionKind>();
  public readonly disabled = input(false);

  public readonly applyAll = output<FileDecision>();

  protected readonly groupLabel = BULK_GROUP_LABEL;
  protected readonly count = computed(() => controllableCount(this.rows()));
  protected readonly countLabel = computed(() =>
    bulkCountLabel(this.kind(), this.count()),
  );
}
