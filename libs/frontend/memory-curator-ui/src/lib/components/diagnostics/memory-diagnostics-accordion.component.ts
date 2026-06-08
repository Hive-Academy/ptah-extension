import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
} from '@angular/core';

import {
  MemoryDiagnosticsStateService,
  type LastRunSnapshot,
} from '../../services/memory-diagnostics-state.service';

import {
  MemoryTriggerToggleComponent,
  type TriggerToggleChange,
} from './memory-trigger-toggle.component';
import { DbHealthPanelComponent } from './db-health-panel.component';
import { EventFeedComponent } from './event-feed.component';
import {
  CuratorModelPickerComponent,
  type CuratorModelChange,
} from './curator-model-picker.component';

@Component({
  selector: 'ptah-memory-diagnostics-accordion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MemoryTriggerToggleComponent,
    DbHealthPanelComponent,
    EventFeedComponent,
    CuratorModelPickerComponent,
  ],
  template: `
    <div class="flex flex-col gap-3 p-3">
      <section class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div class="rounded-md border border-base-300 bg-base-100 px-3 py-2">
          <div
            class="text-xs font-semibold uppercase tracking-wide text-base-content/70"
          >
            Last curator run
          </div>
          <div class="mt-1 text-sm" data-testid="last-curator-run">
            {{ lastRunLabel() }}
          </div>
        </div>
        <div class="rounded-md border border-base-300 bg-base-100 px-3 py-2">
          <div
            class="text-xs font-semibold uppercase tracking-wide text-base-content/70"
          >
            Last decay sweep
          </div>
          <div class="mt-1 text-sm" data-testid="last-decay-run">
            {{ lastDecayLabel() }}
          </div>
        </div>
      </section>

      <section class="rounded-md border border-base-300 bg-base-100">
        <header
          class="border-b border-base-300 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-base-content/70"
        >
          Triggers
        </header>
        @if (triggers(); as t) {
          <div class="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2">
            <ptah-memory-trigger-toggle
              label="PreCompact hook"
              [enabled]="t.preCompact"
              (triggerChange)="onPreCompactChange($event)"
            />
            <ptah-memory-trigger-toggle
              label="Idle timer"
              [enabled]="t.idleMs > 0"
              [value]="t.idleMs"
              valueLabel="ms"
              (triggerChange)="onIdleChange($event)"
            />
            <ptah-memory-trigger-toggle
              label="Turn threshold"
              [enabled]="t.turnThreshold > 0"
              [value]="t.turnThreshold"
              valueLabel="turns"
              (triggerChange)="onTurnChange($event)"
            />
            <ptah-memory-trigger-toggle
              label="Boot scan"
              [enabled]="t.bootScan"
              (triggerChange)="onBootScanChange($event)"
            />
            <ptah-memory-trigger-toggle
              label="PostToolUse hook"
              [enabled]="t.postToolUse?.enabled ?? false"
              (triggerChange)="onPostToolUseChange($event)"
            />
            <ptah-memory-trigger-toggle
              label="Turn-complete (Stop hook)"
              [enabled]="t.turnComplete?.enabled ?? false"
              (triggerChange)="onTurnCompleteChange($event)"
            />
            <ptah-memory-trigger-toggle
              label="Error→recovery episodes"
              [enabled]="t.episode?.enabled ?? false"
              (triggerChange)="onEpisodeChange($event)"
            />
            <ptah-memory-trigger-toggle
              label="Session-end flush"
              [enabled]="t.sessionEnd?.enabled ?? false"
              (triggerChange)="onSessionEndChange($event)"
            />
            <ptah-memory-trigger-toggle
              label="UserPromptSubmit cues"
              [enabled]="t.userPromptSubmit?.enabled ?? false"
              [value]="t.userPromptSubmit?.minPromptLength ?? 0"
              valueLabel="min length"
              [min]="0"
              [max]="10000"
              (triggerChange)="onUserPromptSubmitChange($event)"
            />
            <ptah-memory-trigger-toggle
              label="Max curates per hour"
              [enabled]="(t.maxCuratesPerHour ?? 0) > 0"
              [value]="t.maxCuratesPerHour ?? 0"
              valueLabel="/hour"
              [min]="0"
              [max]="1000"
              (triggerChange)="onMaxCuratesChange($event)"
            />
          </div>
          <div class="border-t border-base-300 px-3 py-2">
            <label
              class="text-xs font-semibold uppercase tracking-wide text-base-content/70"
              for="memory-cue-list"
            >
              Cue list (read-only)
            </label>
            <textarea
              id="memory-cue-list"
              class="textarea textarea-bordered textarea-xs mt-1 w-full font-mono text-xs"
              readonly
              rows="3"
              data-testid="memory-cue-list"
              [value]="cueListText()"
            ></textarea>
          </div>
        } @else {
          <div class="px-3 py-3 text-xs text-base-content/60">
            Loading trigger settings…
          </div>
        }
      </section>

      @if (triggers(); as t) {
        <ptah-curator-model-picker
          [curatorProvider]="t.curatorProvider ?? ''"
          [curatorModel]="t.curatorModel ?? ''"
          (curatorChange)="onCuratorModelChange($event)"
        />
      }

      <ptah-event-feed [events]="recentEvents()" [now]="now()" />

      <ptah-db-health-panel [health]="dbHealth()" />

      @if (error(); as err) {
        <div class="alert alert-error py-2 text-xs" role="alert">
          {{ err }}
        </div>
      }

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn btn-sm btn-primary"
          [disabled]="loading() || !hasActiveSession()"
          [title]="
            !hasActiveSession() ? 'Open a session to run curator manually' : ''
          "
          (click)="onRunCuratorNow()"
          data-testid="run-curator-now"
        >
          @if (loading()) {
            <span class="loading loading-spinner loading-xs"></span>
          }
          Run curator now
        </button>
        @if (!hasActiveSession()) {
          <span
            class="text-xs text-base-content/60"
            data-testid="no-active-session-hint"
          >
            Open a session to run curator manually
          </span>
        }
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          [disabled]="loading()"
          (click)="onRefresh()"
          data-testid="refresh-diagnostics"
        >
          Refresh
        </button>
      </div>
    </div>
  `,
})
export class MemoryDiagnosticsAccordionComponent implements OnInit, OnDestroy {
  private readonly state = inject(MemoryDiagnosticsStateService);

  protected readonly triggers = this.state.triggers;
  protected readonly lastRun = this.state.lastRun;
  protected readonly lastDecay = this.state.lastDecay;
  protected readonly recentEvents = this.state.recentEvents;
  protected readonly dbHealth = this.state.dbHealth;
  protected readonly loading = this.state.loading;
  protected readonly error = this.state.error;
  protected readonly hasActiveSession = this.state.hasActiveSession;

  protected readonly now = computed(() => {
    this.recentEvents();
    return Date.now();
  });

  protected readonly lastRunLabel = computed(() =>
    formatSnapshot(this.lastRun()),
  );
  protected readonly lastDecayLabel = computed(() =>
    formatSnapshot(this.lastDecay()),
  );

  protected readonly cueListText = computed<string>(() => {
    const cues = this.triggers()?.userPromptSubmit?.cueList ?? [];
    return cues.join('\n');
  });

  public ngOnInit(): void {
    this.state.startPolling();
  }

  public ngOnDestroy(): void {
    this.state.stopPolling();
  }

  protected onRunCuratorNow(): void {
    void this.state.runNow();
  }

  protected onRefresh(): void {
    void this.state.refresh();
  }

  protected onPreCompactChange(c: TriggerToggleChange): void {
    void this.state.setTriggers({ preCompact: c.enabled });
  }

  protected onIdleChange(c: TriggerToggleChange): void {
    const idleMs = c.enabled ? (c.value ?? this.triggers()?.idleMs ?? 0) : 0;
    void this.state.setTriggers({ idleMs });
  }

  protected onTurnChange(c: TriggerToggleChange): void {
    const turnThreshold = c.enabled
      ? (c.value ?? this.triggers()?.turnThreshold ?? 0)
      : 0;
    void this.state.setTriggers({ turnThreshold });
  }

  protected onBootScanChange(c: TriggerToggleChange): void {
    void this.state.setTriggers({ bootScan: c.enabled });
  }

  protected onPostToolUseChange(c: TriggerToggleChange): void {
    void this.state.setTriggers({ postToolUse: { enabled: c.enabled } });
  }

  protected onTurnCompleteChange(c: TriggerToggleChange): void {
    void this.state.setTriggers({ turnComplete: { enabled: c.enabled } });
  }

  protected onEpisodeChange(c: TriggerToggleChange): void {
    void this.state.setTriggers({ episode: { enabled: c.enabled } });
  }

  protected onSessionEndChange(c: TriggerToggleChange): void {
    void this.state.setTriggers({ sessionEnd: { enabled: c.enabled } });
  }

  protected onUserPromptSubmitChange(c: TriggerToggleChange): void {
    const current = this.triggers()?.userPromptSubmit;
    const cueList = current?.cueList ?? [];
    const minPromptLength = c.value ?? current?.minPromptLength ?? 0;
    void this.state.setTriggers({
      userPromptSubmit: {
        enabled: c.enabled,
        cueList,
        minPromptLength,
      },
    });
  }

  protected onMaxCuratesChange(c: TriggerToggleChange): void {
    const value = c.enabled
      ? (c.value ?? this.triggers()?.maxCuratesPerHour ?? 0)
      : 0;
    void this.state.setTriggers({ maxCuratesPerHour: value });
  }

  protected onCuratorModelChange(change: CuratorModelChange): void {
    void this.state.setTriggers({
      curatorProvider: change.curatorProvider,
      curatorModel: change.curatorModel,
    });
  }
}

function formatSnapshot(snapshot: LastRunSnapshot | null): string {
  if (!snapshot) return 'never';
  let when: string;
  try {
    when = new Date(snapshot.at).toLocaleString();
  } catch {
    when = String(snapshot.at);
  }
  const stats = snapshot.stats;
  if (!stats) return when;
  const summary = Object.entries(stats)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`)
    .slice(0, 3)
    .join(', ');
  return summary.length > 0 ? `${when} · ${summary}` : when;
}
