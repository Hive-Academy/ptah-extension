import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { CompactSessionSummary } from './compact-session-summary';
import { CompactSessionStatsComponent } from './compact-session-stats.component';

/** Bounded, summary-only compact session body. */
@Component({
  selector: 'ptah-compact-session-activity',
  standalone: true,
  imports: [CompactSessionStatsComponent],
  host: {
    class: 'block h-full min-h-0 overflow-hidden',
  },
  template: `
    <section
      class="grid h-full min-h-0 grid-rows-[auto_auto_1fr_auto] overflow-hidden"
      aria-label="Compact session status"
      data-testid="compact-session-summary"
    >
      <div
        class="flex min-w-0 items-center gap-2 border-b border-base-content/10 px-3 py-2"
        data-zone="status"
      >
        <span
          class="h-2.5 w-2.5 shrink-0 rounded-full"
          [style.background-color]="summary().status.sessionColor"
          aria-hidden="true"
        ></span>
        <span class="shrink-0" aria-hidden="true">{{
          summary().status.icon
        }}</span>
        <span class="truncate text-xs font-semibold">{{
          summary().status.text
        }}</span>
        <span class="ml-auto truncate text-[10px] text-base-content-muted">
          {{ summary().status.workspaceLabel }}
        </span>
      </div>

      <div
        class="flex h-5 items-center gap-1 overflow-hidden px-3"
        role="list"
        aria-label="Recent semantic activity"
        data-zone="pulse"
      >
        @for (mark of summary().marks; track mark.id) {
          <span
            class="h-1.5 min-w-1.5 max-w-4 flex-1 rounded-full border border-base-content/10 motion-safe:transition-[opacity,transform] motion-safe:duration-150 motion-reduce:transition-none"
            [class.bg-primary]="mark.tone === 'live'"
            [class.bg-success]="mark.tone === 'success'"
            [class.bg-warning]="mark.tone === 'warning'"
            [class.bg-error]="mark.tone === 'error'"
            [class.bg-base-content/20]="mark.tone === 'idle'"
            role="listitem"
            [attr.aria-label]="mark.label"
            [title]="mark.label"
          ></span>
        }
      </div>

      <div
        class="flex min-h-0 items-center gap-3 border-y border-base-content/5 px-3 py-2"
        data-zone="content"
      >
        <p
          class="line-clamp-2 min-w-0 flex-1 whitespace-pre-line text-xs leading-relaxed"
          [class.text-error]="summary().content.kind === 'error'"
          [class.text-base-content-muted]="summary().content.kind !== 'error'"
        >
          {{ summary().content.text }}
          @if (summary().content.additionalPromptCount > 0) {
            <span class="font-semibold text-warning">
              +{{ summary().content.additionalPromptCount }} more
            </span>
          }
        </p>
        @if (summary().content.actionable) {
          <button
            type="button"
            class="btn btn-primary btn-xs shrink-0"
            (click)="openFullView.emit()"
          >
            Open full view
          </button>
        }
      </div>

      <ptah-compact-session-stats
        data-zone="metrics"
        [metrics]="summary().metrics"
      />
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactSessionActivityComponent {
  readonly summary = input.required<CompactSessionSummary>();
  readonly openFullView = output<void>();
}
