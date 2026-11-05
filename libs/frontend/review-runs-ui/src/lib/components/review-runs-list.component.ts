import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { ReviewRun } from '@ptah-extension/review-contracts';

@Component({
  selector: 'ptah-review-runs-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="list" aria-label="Review runs">
      @for (run of runs(); track run.attemptId) {
        <div role="listitem">
          <button type="button" class="grid w-full grid-cols-1 gap-2 border-t border-base-300 p-3 text-left hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary sm:grid-cols-[minmax(0,2fr)_100px_130px_90px] sm:items-center"
            [attr.aria-label]="'PR ' + run.prNumber + ', ' + run.status + ', ' + run.repo.owner + '/' + run.repo.name"
            (click)="open.emit(run.attemptId)" (keydown.arrowdown)="moveFocus($event, 1)" (keydown.arrowup)="moveFocus($event, -1)">
            <span class="min-w-0"><span class="block font-semibold">PR #{{ run.prNumber }}</span><span class="block text-xs text-base-content-muted">{{ run.repo.owner }}/{{ run.repo.name }}</span>
              @if (run.status === 'failed') { @if (run.failure; as failure) { <span class="block truncate text-xs text-error" [title]="failure.message">{{ failure.stage }}: {{ failure.message }}</span> } }
              @if (run.headRetry?.automaticRetriesStopped) { <span class="block text-xs text-warning">Automatic retries stopped</span> }
              @else if (run.headRetry?.nextEligibleAt; as retryAt) { <span class="block text-xs text-warning">Retry after {{ retryTime(retryAt) }}</span> }
            </span>
            <span class="font-mono text-xs">{{ run.headSha.slice(0, 10) }}<span class="block font-sans text-base-content-muted">{{ run.trigger }}</span></span>
            <span class="badge badge-outline" [class.badge-success]="run.status === 'succeeded'" [class.badge-warning]="run.status === 'partial' || run.status === 'superseded'" [class.badge-error]="run.status === 'failed'">
              {{ run.status === 'succeeded' ? 'Completed' : run.status === 'partial' ? 'Partial / coverage limited' : run.status === 'skipped' ? 'Skipped' : run.status }}
            </span>
            <span class="text-xs text-base-content-muted">{{ run.completedAt ? 'Finished' : run.startedAt ? 'In progress' : 'Waiting' }}</span>
          </button>
        </div>
      }
    </div>
  `,
})
export class ReviewRunsListComponent {
  retryTime(value: string): string { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }
  readonly runs = input.required<readonly ReviewRun[]>();
  readonly open = output<string>();

  moveFocus(event: Event, direction: number): void {
    event.preventDefault();
    const current = event.currentTarget;
    if (!(current instanceof HTMLButtonElement)) return;
    const buttons = Array.from(current.closest('[role="list"]')?.querySelectorAll<HTMLButtonElement>('[role="listitem"] > button') ?? []);
    buttons[buttons.indexOf(current) + direction]?.focus();
  }
}
