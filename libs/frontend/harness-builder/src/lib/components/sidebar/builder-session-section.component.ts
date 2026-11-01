import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import {
  SessionStatsSummaryComponent,
  sessionContextCue,
  type LiveModelStats,
} from '@ptah-extension/chat-ui';
import type { SessionStatsEntry } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-builder-session-section',
  standalone: true,
  imports: [SessionStatsSummaryComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (initialized()) {
      <section
        aria-labelledby="builder-session-title"
        class="p-4 border-b border-surface-border"
      >
        <button
          type="button"
          class="w-full text-left flex items-center justify-between"
          [attr.aria-expanded]="sessionOpen()"
          aria-controls="builder-session-content"
          (click)="sessionOpen.set(!sessionOpen())"
        >
          <span
            id="builder-session-title"
            class="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-base-content-muted"
            >Session</span
          ><span class="text-[11px] text-base-content-muted">{{
            sessionSummary()
          }}</span>
        </button>
        @if (sessionOpen()) {
          <div id="builder-session-content" class="mt-2">
            <ptah-session-stats-summary
              [snapshot]="statsSnapshot()"
              [liveModelStats]="liveModelStats()"
            />
          </div>
        }
      </section>
    }
  `,
})
export class BuilderSessionSectionComponent {
  readonly initialized = input(false);
  readonly statsSnapshot = input<SessionStatsEntry | null>(null);
  readonly liveModelStats = input<LiveModelStats | null>(null);
  protected readonly sessionOpen = signal(false);
  protected readonly sessionSummary = computed(() => {
    const contextLabel = sessionContextCue(this.liveModelStats()).label;
    return `Context ${contextLabel} · ${this.statsSnapshot()?.totalCost === null || this.statsSnapshot()?.totalCost === undefined ? 'Cost unavailable' : '$' + this.statsSnapshot()?.totalCost?.toFixed(2)}`;
  });
}
