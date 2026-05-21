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
    <div class="flex flex-col gap-3 p-3 text-sm">
      <section
        class="card bg-base-200 shadow-sm"
        aria-label="Last analyze run"
        data-test="panel-last-run"
      >
        <div class="card-body p-3">
          <h3 class="card-title text-xs">Last analyze run</h3>
          <p class="text-xs text-base-content/70">
            {{ formattedLastRun() }}
          </p>
        </div>
      </section>

      <section
        class="card bg-base-200 shadow-sm"
        aria-label="Last curator pass"
        data-test="panel-last-curator"
      >
        <div class="card-body p-3">
          <h3 class="card-title text-xs">Last curator pass</h3>
          <p class="text-xs text-base-content/70">
            {{ formattedLastCurator() }}
          </p>
        </div>
      </section>

      <section
        class="card bg-base-200 shadow-sm"
        aria-label="Sessions analyzed today"
        data-test="panel-sessions-today"
      >
        <div class="card-body p-3">
          <h3 class="card-title text-xs">
            Sessions analyzed today ({{ sessionsAnalyzedToday() }})
          </h3>
          <ptah-eligibility-histogram [histogram]="histogram()" />
        </div>
      </section>

      <section
        class="card bg-base-200 shadow-sm"
        aria-label="Candidates by status"
        data-test="panel-by-status"
      >
        <div class="card-body p-3">
          <h3 class="card-title text-xs">Candidates by status</h3>
          <div class="grid grid-cols-3 gap-2 text-xs">
            <div class="flex flex-col">
              <span class="text-base-content/60">Candidates</span>
              <span class="tabular-nums text-base font-semibold">
                {{ byStatus().totalCandidates }}
              </span>
            </div>
            <div class="flex flex-col">
              <span class="text-base-content/60">Promoted</span>
              <span class="tabular-nums text-base font-semibold">
                {{ byStatus().totalPromoted }}
              </span>
            </div>
            <div class="flex flex-col">
              <span class="text-base-content/60">Rejected</span>
              <span class="tabular-nums text-base font-semibold">
                {{ byStatus().totalRejected }}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section
        class="card bg-base-200 shadow-sm"
        aria-label="Recent events"
        data-test="panel-events"
      >
        <div class="card-body p-3">
          <h3 class="card-title text-xs">Recent events</h3>
          <ptah-skill-event-feed [events]="events()" />
        </div>
      </section>

      <section
        class="card bg-base-200 shadow-sm"
        aria-label="Triggers"
        data-test="panel-triggers"
      >
        <div class="card-body p-3">
          <h3 class="card-title text-xs">Triggers</h3>
          <div class="flex flex-col gap-2">
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
          </div>
        </div>
      </section>

      <section
        class="card bg-base-200 shadow-sm"
        aria-label="Actions"
        data-test="panel-actions"
      >
        <div class="card-body p-3">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="btn btn-sm btn-primary"
              [disabled]="loading()"
              (click)="onAnalyzeNow()"
            >
              Analyze current session
            </button>
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              (click)="onViewLogs()"
            >
              View logs
            </button>
            @if (error(); as err) {
              <span class="text-xs text-error truncate">{{ err }}</span>
            }
          </div>
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
    }
  }

  protected onAnalyzeNow(): void {
    void this.state.analyzeNow();
  }

  protected onViewLogs(): void {
    void this.state.refresh();
  }
}
