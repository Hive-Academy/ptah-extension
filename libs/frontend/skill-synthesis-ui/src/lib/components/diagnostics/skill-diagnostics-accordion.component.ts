import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
} from '@angular/core';

import { SkillDiagnosticsStateService } from '../../services/skill-diagnostics-state.service';
import { EligibilityHistogramComponent } from './eligibility-histogram.component';
import { SkillEventFeedComponent } from './event-feed.component';
import {
  SkillTriggerChange,
  SkillTriggerToggleComponent,
} from './skill-trigger-toggle.component';

@Component({
  selector: 'ptah-skill-diagnostics-accordion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EligibilityHistogramComponent,
    SkillEventFeedComponent,
    SkillTriggerToggleComponent,
  ],
  template: `
    <div class="space-y-4 text-sm">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section
          class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40 px-4 py-3"
          aria-label="Last analyze run"
          data-test="panel-last-run"
        >
          <h2 class="text-sm font-semibold">Last analyze run</h2>
          <p class="mt-1 text-xs text-base-content/70">
            {{ formattedLastRun() }}
          </p>
        </section>

        <section
          class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40 px-4 py-3"
          aria-label="Last curator pass"
          data-test="panel-last-curator"
        >
          <h2 class="text-sm font-semibold">Last curator pass</h2>
          <p class="mt-1 text-xs text-base-content/70">
            {{ formattedLastCurator() }}
          </p>
        </section>
      </div>

      <section
        class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40 px-4 py-3"
        aria-label="Sessions analyzed today"
        data-test="panel-sessions-today"
      >
        <h2 class="text-sm font-semibold">
          Sessions analyzed today ({{ sessionsAnalyzedToday() }})
        </h2>
        <div class="mt-2">
          <ptah-eligibility-histogram [histogram]="histogram()" />
        </div>
      </section>

      <section
        class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40 px-4 py-3"
        aria-label="Candidates by status"
        data-test="panel-by-status"
      >
        <h2 class="text-sm font-semibold">Candidates by status</h2>
        <div class="mt-2 flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <span class="text-base font-semibold tabular-nums">
              {{ byStatus().totalCandidates }}
            </span>
            <span class="block text-xs text-base-content/60">Candidates</span>
          </div>
          <div>
            <span class="text-base font-semibold tabular-nums">
              {{ byStatus().totalPromoted }}
            </span>
            <span class="block text-xs text-base-content/60">Promoted</span>
          </div>
          <div>
            <span class="text-base font-semibold tabular-nums">
              {{ byStatus().totalRejected }}
            </span>
            <span class="block text-xs text-base-content/60">Rejected</span>
          </div>
        </div>
      </section>

      <section
        class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40 px-4 py-3"
        aria-label="Recent events"
        data-test="panel-events"
      >
        <h2 class="text-sm font-semibold">Recent events</h2>
        <div class="mt-2">
          <ptah-skill-event-feed [events]="events()" />
        </div>
      </section>

      <section
        class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40 px-4 py-3"
        aria-label="Triggers"
        data-test="panel-triggers"
      >
        <h2 class="text-sm font-semibold">Triggers</h2>
        <div class="mt-2 flex flex-col gap-2">
          <ptah-skill-trigger-toggle
            key="sessionEnd"
            label="Session end"
            [enabled]="triggers().sessionEnd"
            (triggerChange)="onTriggerChange($event)"
          />
          <ptah-skill-trigger-toggle
            key="idleMs"
            label="Idle (ms)"
            [enabled]="triggers().idleMs > 0"
            [numericValue]="triggers().idleMs"
            (triggerChange)="onTriggerChange($event)"
          />
          <ptah-skill-trigger-toggle
            key="bootScan"
            label="Boot scan"
            [enabled]="triggers().bootScan"
            (triggerChange)="onTriggerChange($event)"
          />
          <ptah-skill-trigger-toggle
            key="subagentStop"
            label="Subagent stop"
            [enabled]="triggers().subagentStop?.enabled ?? false"
            (triggerChange)="onTriggerChange($event)"
          />
          <ptah-skill-trigger-toggle
            key="turnComplete"
            label="Turn complete"
            [enabled]="triggers().turnComplete?.enabled ?? false"
            (triggerChange)="onTriggerChange($event)"
          />
          <ptah-skill-trigger-toggle
            key="postToolUse"
            label="PostToolUse (edit+test)"
            [enabled]="triggers().postToolUse?.enabled ?? false"
            (triggerChange)="onTriggerChange($event)"
          />
          <ptah-skill-trigger-toggle
            key="postToolUseMinEditCount"
            label="Min edit count"
            [enabled]="triggers().postToolUse?.enabled ?? false"
            [numericValue]="triggers().postToolUse?.minEditCount ?? 0"
            [min]="1"
            [max]="20"
            (triggerChange)="onTriggerChange($event)"
          />
          <ptah-skill-trigger-toggle
            key="maxAnalyzesPerHour"
            label="Max analyzes per hour"
            [enabled]="(triggers().maxAnalyzesPerHour ?? 0) > 0"
            [numericValue]="triggers().maxAnalyzesPerHour ?? 0"
            [min]="0"
            [max]="1000"
            (triggerChange)="onTriggerChange($event)"
          />
        </div>
      </section>

      <section
        class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40 px-4 py-3"
        aria-label="Actions"
        data-test="panel-actions"
      >
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn btn-primary btn-sm transition-colors duration-150"
            [disabled]="loading() || !hasActiveSession()"
            [title]="
              !hasActiveSession() ? 'Open a session to analyze it manually' : ''
            "
            (click)="onAnalyzeNow()"
            data-test="analyze-now"
          >
            Analyze current session
          </button>
          @if (!hasActiveSession()) {
            <span
              class="text-xs text-base-content/60"
              data-test="no-active-session-hint"
            >
              Open a session to analyze it manually
            </span>
          }
          <button
            type="button"
            class="btn btn-ghost btn-sm transition-colors duration-150"
            (click)="onViewLogs()"
          >
            View logs
          </button>
          @if (error(); as err) {
            <span class="truncate text-xs text-error">{{ err }}</span>
          }
        </div>
      </section>
    </div>
  `,
})
export class SkillDiagnosticsAccordionComponent implements OnInit, OnDestroy {
  private readonly state = inject(SkillDiagnosticsStateService);

  protected readonly triggers = this.state.triggers;
  protected readonly histogram = this.state.eligibilityHistogram;
  protected readonly events = this.state.recentEvents;
  protected readonly byStatus = this.state.byStatus;
  protected readonly loading = this.state.loading;
  protected readonly error = this.state.error;
  protected readonly sessionsAnalyzedToday = this.state.sessionsAnalyzedToday;
  protected readonly hasActiveSession = this.state.hasActiveSession;

  protected readonly formattedLastRun = computed<string>(() => {
    const ts = this.state.lastAnalyzeRunAt();
    return ts ? new Date(ts).toLocaleString() : 'Never';
  });

  protected readonly formattedLastCurator = computed<string>(() => {
    const ts = this.state.lastCuratorPassAt();
    return ts ? new Date(ts).toLocaleString() : 'Never';
  });

  public ngOnInit(): void {
    void this.state.refresh();
    this.state.startPolling();
  }

  public ngOnDestroy(): void {
    this.state.stopPolling();
  }

  protected onTriggerChange(change: SkillTriggerChange): void {
    if (change.key === 'sessionEnd' && typeof change.value === 'boolean') {
      void this.state.setTriggers({ sessionEnd: change.value });
      return;
    }
    if (change.key === 'idleMs') {
      if (typeof change.value === 'boolean') {
        void this.state.setTriggers({ idleMs: change.value ? 600_000 : 0 });
        return;
      }
      void this.state.setTriggers({ idleMs: change.value });
      return;
    }
    if (change.key === 'bootScan' && typeof change.value === 'boolean') {
      void this.state.setTriggers({ bootScan: change.value });
      return;
    }
    if (change.key === 'subagentStop' && typeof change.value === 'boolean') {
      void this.state.setTriggers({
        subagentStop: { enabled: change.value },
      });
      return;
    }
    if (change.key === 'turnComplete' && typeof change.value === 'boolean') {
      void this.state.setTriggers({
        turnComplete: { enabled: change.value },
      });
      return;
    }
    if (change.key === 'postToolUse' && typeof change.value === 'boolean') {
      const current = this.triggers().postToolUse;
      void this.state.setTriggers({
        postToolUse: {
          enabled: change.value,
          minEditCount: current?.minEditCount ?? 1,
        },
      });
      return;
    }
    if (
      change.key === 'postToolUseMinEditCount' &&
      typeof change.value === 'number'
    ) {
      const current = this.triggers().postToolUse;
      void this.state.setTriggers({
        postToolUse: {
          enabled: current?.enabled ?? false,
          minEditCount: change.value,
        },
      });
      return;
    }
    if (change.key === 'maxAnalyzesPerHour') {
      if (typeof change.value === 'boolean') {
        void this.state.setTriggers({
          maxAnalyzesPerHour: change.value ? 60 : 0,
        });
        return;
      }
      void this.state.setTriggers({ maxAnalyzesPerHour: change.value });
    }
  }

  protected onAnalyzeNow(): void {
    void this.state.analyzeNow();
  }

  protected onViewLogs(): void {
    void this.state.refresh();
  }
}
