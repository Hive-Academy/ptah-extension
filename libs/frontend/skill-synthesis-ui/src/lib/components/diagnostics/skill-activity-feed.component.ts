import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';

import { SkillDiagnosticsStateService } from '../../services/skill-diagnostics-state.service';
import { SkillEventFeedComponent } from './event-feed.component';

const NO_SESSION_HINT = 'Open a session to analyze it manually';

/**
 * The Activity view's live section: the recent-events feed, the manual
 * "Analyze current session" action and the diagnostics error text.
 *
 * It owns the 30-second diagnostics poll while it is on screen: it refreshes
 * once on mount, starts the ref-counted poll, and releases it on destroy, so
 * the status card above it and this feed stay current while Activity is
 * shown and no request runs once the user leaves.
 */
@Component({
  selector: 'ptah-skill-activity-feed',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SkillEventFeedComponent],
  template: `
    <section
      class="surface-2 overflow-hidden rounded-xl px-4 py-3 text-sm"
      aria-label="Recent events"
      data-test="panel-events"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-semibold">Recent events</h2>
        <div class="flex flex-wrap items-center gap-2">
          @if (!hasActiveSession()) {
            <span
              class="text-xs text-base-content-muted"
              data-test="no-active-session-hint"
            >
              {{ noSessionHint }}
            </span>
          }
          <button
            type="button"
            class="btn btn-primary btn-sm transition-colors duration-150"
            [disabled]="loading() || !hasActiveSession()"
            [title]="hasActiveSession() ? '' : noSessionHint"
            (click)="onAnalyzeNow()"
            data-test="analyze-now"
          >
            Analyze current session
          </button>
        </div>
      </div>
      @if (error(); as err) {
        <p
          class="mt-2 break-words text-xs text-error"
          role="alert"
          data-test="activity-error"
        >
          {{ err }}
        </p>
      }
      <div class="mt-2">
        <ptah-skill-event-feed [events]="events()" />
      </div>
    </section>
  `,
})
export class SkillActivityFeedComponent implements OnInit, OnDestroy {
  private readonly state = inject(SkillDiagnosticsStateService);

  protected readonly events = this.state.recentEvents;
  protected readonly loading = this.state.loading;
  protected readonly error = this.state.error;
  protected readonly hasActiveSession = this.state.hasActiveSession;
  protected readonly noSessionHint = NO_SESSION_HINT;

  public ngOnInit(): void {
    void this.state.refresh();
    this.state.startPolling();
  }

  public ngOnDestroy(): void {
    this.state.stopPolling();
  }

  protected onAnalyzeNow(): void {
    void this.state.analyzeNow();
  }
}
