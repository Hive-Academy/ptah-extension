import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
} from '@angular/core';

import { SkillDiagnosticsStateService } from '../../services/skill-diagnostics-state.service';
import { SKILLS_PAUSED_REASON } from '../../services/skill-synthesis-state.service';
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
 *
 * While the Skills switch is paused ({@link paused}) the manual analyze is
 * greyed out with the paused reason; a `PAUSED` refusal from the host is shown
 * as a paused notice and reported through {@link pausedRefusal}.
 */
@Component({
  selector: 'ptah-skill-activity-feed',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SkillEventFeedComponent],
  template: `
    <section
      class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40 px-4 py-3 text-sm"
      aria-label="Recent events"
      data-test="panel-events"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-semibold">Recent events</h2>
        <div class="flex flex-wrap items-center gap-2">
          @if (paused()) {
            <span
              class="text-xs text-base-content-muted"
              data-test="analyze-paused-hint"
            >
              {{ pausedReason }}
            </span>
          } @else if (!hasActiveSession()) {
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
            [disabled]="loading() || !hasActiveSession() || paused()"
            [title]="analyzeTitle()"
            (click)="onAnalyzeNow()"
            data-test="analyze-now"
          >
            Analyze current session
          </button>
        </div>
      </div>
      @if (pausedNotice(); as notice) {
        <p
          class="mt-2 rounded border border-warning/60 bg-warning/10 px-3 py-2 text-xs text-base-content"
          role="status"
          data-test="analyze-paused-notice"
        >
          {{ notice }}
        </p>
      }
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

  /** The Skills switch is paused: manual analysis is unavailable. */
  public readonly paused = input<boolean>(false);
  /** The host refused an analysis with `PAUSED` (Skills paused elsewhere). */
  public readonly pausedRefusal = output<void>();

  protected readonly events = this.state.recentEvents;
  protected readonly loading = this.state.loading;
  protected readonly error = this.state.error;
  protected readonly hasActiveSession = this.state.hasActiveSession;
  protected readonly noSessionHint = NO_SESSION_HINT;
  protected readonly pausedReason = SKILLS_PAUSED_REASON;
  /** Hidden once Skills is on again, so a stale refusal does not linger. */
  protected readonly pausedNotice = computed(() =>
    this.paused() ? this.state.pausedNotice() : null,
  );

  protected readonly analyzeTitle = computed(() => {
    if (this.paused()) return SKILLS_PAUSED_REASON;
    return this.hasActiveSession() ? '' : NO_SESSION_HINT;
  });

  public ngOnInit(): void {
    void this.state.refresh();
    this.state.startPolling();
  }

  public ngOnDestroy(): void {
    this.state.stopPolling();
  }

  protected async onAnalyzeNow(): Promise<void> {
    if (this.paused()) return;
    const outcome = await this.state.analyzeNow();
    if (outcome === 'paused') this.pausedRefusal.emit();
  }
}
