import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type {
  CompactCallout,
  CompactPermissionCallout,
} from './compact-lane.types';

/** Fixed-height attention slot for the compact card. */
@Component({
  selector: 'ptah-compact-session-callout',
  standalone: true,
  host: { class: 'block h-20 min-w-0 shrink-0' },
  template: `
    @if (permission(); as request) {
      <div
        class="flex h-20 min-w-0 flex-col gap-1.5 rounded border border-warning/30 bg-warning/10 p-2 text-xs"
        role="group"
        aria-label="Permission request"
        data-testid="cs-callout-permission"
      >
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="min-w-0 flex-1 truncate" [title]="request.text">{{
            request.text
          }}</span>
          @if (request.moreCount) {
            <span class="shrink-0 text-base-content-muted"
              >+{{ request.moreCount }} more</span
            >
          }
        </div>
        <div class="flex gap-1.5">
          <button
            type="button"
            class="btn btn-xs btn-success"
            (click)="allow.emit(request)"
          >
            Allow
          </button>
          <button
            type="button"
            class="btn btn-xs btn-error btn-outline"
            (click)="deny.emit(request)"
          >
            Deny
          </button>
          <button
            type="button"
            class="btn btn-xs btn-ghost"
            (click)="openRequest.emit(request)"
          >
            Open
          </button>
        </div>
      </div>
    } @else if (question(); as request) {
      <div
        class="flex h-20 min-w-0 flex-col gap-1.5 rounded border border-warning/30 bg-warning/10 p-2 text-xs"
        role="group"
        aria-label="Question request"
        data-testid="cs-callout-question"
      >
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="min-w-0 flex-1 truncate" [title]="request.text">{{
            request.text
          }}</span>
          @if (request.moreCount) {
            <span class="shrink-0 text-base-content-muted"
              >+{{ request.moreCount }} more</span
            >
          }
        </div>
        <button
          type="button"
          class="btn btn-xs btn-primary self-start"
          (click)="answer.emit()"
        >
          Answer
        </button>
      </div>
    } @else if (error(); as issue) {
      <div
        class="flex h-20 min-w-0 flex-col gap-1.5 rounded border border-error/30 bg-error/10 p-2 text-xs"
        role="group"
        aria-label="Session error"
        data-testid="cs-callout-error"
      >
        <span class="truncate text-error" [title]="issue.text">{{
          issue.text
        }}</span>
        <div class="flex gap-1.5">
          @if (issue.canRetry) {
            <button
              type="button"
              class="btn btn-xs btn-outline"
              (click)="retry.emit()"
            >
              Retry
            </button>
          }
          <button
            type="button"
            class="btn btn-xs btn-ghost"
            (click)="showOutput.emit()"
          >
            Show output
          </button>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactSessionCalloutComponent {
  readonly callout = input<CompactCallout>(null);
  readonly allow = output<CompactPermissionCallout>();
  readonly deny = output<CompactPermissionCallout>();
  readonly answer = output<void>();
  readonly openRequest = output<CompactPermissionCallout>();
  readonly retry = output<void>();
  readonly showOutput = output<void>();

  readonly permission = computed(() => {
    const value = this.callout();
    return value?.kind === 'permission' ? value : null;
  });
  readonly question = computed(() => {
    const value = this.callout();
    return value?.kind === 'question' ? value : null;
  });
  readonly error = computed(() => {
    const value = this.callout();
    return value?.kind === 'error' ? value : null;
  });
}
