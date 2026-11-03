import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { StatusCardComponent } from '../shared/status-card.component';
import {
  PROPOSAL_SESSION_PRESENTATION,
  type ProposalSessionStatus,
} from './proposal-session-status';

@Component({
  selector: 'ptah-proposal-status-card',
  standalone: true,
  imports: [LucideAngularModule, StatusCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-status-card
      [tone]="presentation().tone"
      [label]="presentation().title"
      [busy]="status() === 'working'"
    >
      <lucide-angular
        statusIcon
        [img]="presentation().icon"
        class="size-5 motion-reduce:animate-none"
        [class.animate-spin]="status() === 'loading' || status() === 'working'"
        aria-hidden="true"
      />
      <span statusTitle>{{ presentation().title }}</span>
      <span statusSub>{{ subLine() }}</span>
      @if (meta()) {
        <span statusMeta>{{ meta() }}</span>
      }
      @if (status() === 'failed' && error()) {
        <p role="alert" class="mt-3 text-sm text-state-err">{{ error() }}</p>
      }
      @if (showActions()) {
        <div statusActions class="grid w-full grid-cols-2 gap-2 border-t border-base-300 pt-3">
          <button
            type="button"
            class="btn btn-sm col-span-2 disabled:!bg-base-200 disabled:!text-base-content-muted disabled:!opacity-100"
            [class.btn-primary]="canReview()"
            [class.btn-ghost]="!canReview()"
            [disabled]="!canReview()"
            [attr.aria-describedby]="!canReview() ? 'review-reason' : null"
            (click)="review.emit()"
          >Review</button>
          @if (!canReview()) {
            <p id="review-reason" class="col-span-2 text-sm text-base-content-muted">
              Review is available after a proposal is ready.
            </p>
          }
          @if (status() === 'failed' && canRetryBrief()) {
            <button type="button" class="btn btn-sm btn-primary col-span-2"
              (click)="retryBrief.emit()">Retry sending brief</button>
          }
          <button type="button" class="btn btn-sm btn-ghost border border-base-300"
            [disabled]="status() === 'stopping'" (click)="saveDraft.emit()">Save draft</button>
          <button type="button" class="btn btn-sm btn-ghost border border-base-300"
            [disabled]="status() === 'stopping'" (click)="saveAsPreset.emit()">Save as preset</button>
        </div>
      }
    </ptah-status-card>
  `,
})
export class ProposalStatusCardComponent {
  readonly status = input.required<ProposalSessionStatus>();
  readonly error = input<string | null>(null);
  readonly canRetryBrief = input(false);
  readonly reviewEligible = input(false);
  readonly meta = input('');
  readonly showActions = input(true);
  readonly review = output<void>();
  readonly saveDraft = output<void>();
  readonly saveAsPreset = output<void>();
  readonly retryBrief = output<void>();
  readonly presentation = computed(() => PROPOSAL_SESSION_PRESENTATION[this.status()]);
  readonly canReview = computed(
    () => this.status() === 'ready' && this.reviewEligible(),
  );
  readonly subLine = computed(() =>
    this.status() === 'ready' && this.meta().startsWith('Revision ')
      ? `${this.meta()} is complete. Review it, or keep refining.`
      : this.presentation().subLine,
  );
}
