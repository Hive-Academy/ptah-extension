import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  OnDestroy,
  OnInit,
  computed,
  inject,
} from '@angular/core';
import { formatDate } from '@angular/common';
import type {
  MemoryCuratorEventWire,
  MemoryCuratorRunOutcome,
} from '@ptah-extension/shared';
import {
  AppStateManager,
  ProvidersSettingsStateService,
  injectWallClock,
} from '@ptah-extension/core';
import { SurfaceCardComponent } from '@ptah-extension/ui';

import {
  MEMORY_PAUSED_REASON,
  MemoryDiagnosticsStateService,
  type LastRunSnapshot,
  type ManualRunResult,
} from '../../services/memory-diagnostics-state.service';

import {
  MemoryTriggerToggleComponent,
  type TriggerToggleChange,
} from './memory-trigger-toggle.component';
import { DbHealthPanelComponent } from './db-health-panel.component';
import { StorageHealthPanelComponent } from './storage-health-panel.component';
import { EventFeedComponent } from './event-feed.component';

@Component({
  selector: 'ptah-memory-diagnostics-accordion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MemoryTriggerToggleComponent,
    DbHealthPanelComponent,
    StorageHealthPanelComponent,
    EventFeedComponent,
    SurfaceCardComponent,
  ],
  template: `
    <div
      class="flex flex-col gap-3"
      data-testid="thoth-section-memory-diagnostics"
    >
      <section class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div class="surface-2 rounded-xl px-4 py-3">
          <div class="text-xs text-base-content-muted">Last curator run</div>
          <div class="mt-1 text-sm" data-testid="last-curator-run">
            {{ lastRunLabel() }}
          </div>
        </div>
      </section>

      <section class="surface-2 rounded-xl">
        <header
          class="border-b border-surface-border px-4 py-2.5 text-sm font-medium text-base-content-muted"
        >
          Triggers
        </header>
        @if (triggers(); as t) {
          <div class="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2">
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
          <div class="border-t border-base-300 px-4 py-2.5">
            <label
              class="text-xs text-base-content-muted"
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
          <div class="px-3 py-3 text-xs text-base-content-muted">
            Loading trigger settings…
          </div>
        }
      </section>

      @if (triggers(); as t) {
        <ptah-surface-card aria-label="Curator model" class="block">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="text-sm font-semibold">Curator model</h3>
              <p class="mt-1 text-sm text-base-content">
                {{ t.curatorProvider || 'Follows main agent' }} →
                {{
                  t.curatorModel ||
                    (t.curatorProvider
                      ? 'Provider haiku tier'
                      : resolvedCuratorModel())
                }}
              </p>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-xs min-h-7 px-1 text-primary underline underline-offset-2 focus-visible:outline-2"
              (click)="manageCurator()"
            >
              Change
            </button>
          </div>
        </ptah-surface-card>
      }

      @if (curatorError(); as ce) {
        <div
          class="alert alert-error flex flex-wrap items-center gap-2 py-2 text-xs"
          role="alert"
          data-testid="curator-error"
        >
          <span class="flex-1">{{ ce.text }}</span>
          @if (ce.showSettings) {
            <button
              type="button"
              class="btn btn-xs"
              (click)="manageCurator()"
              data-testid="curator-error-open-settings"
            >
              Open model settings
            </button>
          }
        </div>
      }

      <ptah-event-feed [events]="recentEvents()" [now]="now()" />

      <ptah-db-health-panel [health]="dbHealth()" />

      <ptah-storage-health-panel [storage]="storage()" [now]="now()" />

      @if (error(); as err) {
        <div class="alert alert-error py-2 text-xs" role="alert">
          {{ err }}
        </div>
      }

      @if (pausedNotice(); as notice) {
        <p
          class="rounded border border-warning/60 bg-warning/10 px-3 py-2 text-xs text-base-content"
          role="status"
          data-testid="memory-paused-notice"
        >
          {{ notice }}
        </p>
      }

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn btn-sm btn-primary"
          [disabled]="curatorRunning() || !hasActiveSession() || paused()"
          [attr.aria-busy]="curatorRunning()"
          [title]="runNowTitle()"
          (click)="onRunCuratorNow()"
          data-testid="run-curator-now"
        >
          @if (curatorRunning()) {
            <span
              class="loading loading-spinner loading-xs"
              aria-hidden="true"
            ></span>
          }
          Run curator now
        </button>
        @if (paused()) {
          <span
            class="text-xs text-base-content-muted"
            data-testid="run-curator-paused-hint"
          >
            {{ pausedReason }}
          </span>
        } @else if (!hasActiveSession()) {
          <span
            class="text-xs text-base-content-muted"
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

      @if (manualRunStatus(); as status) {
        @if (status.alert) {
          <p
            class="text-xs text-error"
            role="alert"
            data-testid="manual-run-status"
          >
            {{ status.text }}
          </p>
        } @else {
          <p
            class="text-xs text-base-content"
            role="status"
            data-testid="manual-run-status"
          >
            {{ status.text }}
          </p>
        }
      }

      <details class="text-xs">
        <summary class="cursor-pointer font-medium">How this works</summary>
        <p
          class="mt-1 text-base-content-muted"
          data-testid="curator-how-it-works"
        >
          The curator reads a chat session's transcript and the observations
          hooks captured, asks the Memory curator model to extract durable
          facts, and merges them with similar memories. It runs on the triggers
          below, at most the hourly limit; Run curator now curates the active
          session once. If the provider is rate-limited, unreachable or
          unsupported, the pass is skipped and its observations are kept for
          the next pass.
        </p>
      </details>
    </div>
  `,
})
export class MemoryDiagnosticsAccordionComponent implements OnInit, OnDestroy {
  private readonly state = inject(MemoryDiagnosticsStateService);

  protected readonly triggers = this.state.triggers;
  protected readonly lastRun = this.state.lastRun;
  protected readonly recentEvents = this.state.recentEvents;
  protected readonly dbHealth = this.state.dbHealth;
  protected readonly storage = this.state.storage;
  protected readonly loading = this.state.loading;
  /** Manual run in flight; a poll or Refresh never changes it. */
  protected readonly curatorRunning = this.state.curatorRunning;
  protected readonly error = this.state.error;
  protected readonly hasActiveSession = this.state.hasActiveSession;
  protected readonly paused = this.state.memoryPaused;
  protected readonly pausedNotice = this.state.pausedNotice;
  protected readonly pausedReason = MEMORY_PAUSED_REASON;

  protected readonly runNowTitle = computed(() => {
    if (this.paused()) return MEMORY_PAUSED_REASON;
    return this.hasActiveSession()
      ? ''
      : 'Open a session to run curator manually';
  });

  protected readonly now = injectWallClock('coarse');

  private readonly locale = inject(LOCALE_ID);

  protected readonly lastRunLabel = computed(() =>
    formatSnapshot(this.lastRun(), this.locale),
  );

  /** Status line under "Run curator now" for the last manual run. */
  protected readonly manualRunStatus = computed<{
    readonly text: string;
    readonly alert: boolean;
  } | null>(() => {
    const run = this.state.lastManualRun();
    if (!run) return null;
    return {
      text: describeRun(run, formatDate(run.at, 'shortTime', this.locale)),
      alert: !run.success,
    };
  });

  /**
   * The newest `curator-error` event, when it is newer than the last pass
   * that ran. "Open model settings" appears only when a setting can fix it.
   */
  protected readonly curatorError = computed<{
    readonly text: string;
    readonly showSettings: boolean;
  } | null>(() => {
    const events = this.recentEvents();
    const newestError = newestOf(events, (ev) => ev.kind === 'curator-error');
    if (!newestError) return null;
    if (newestError.timestamp <= lastRanAt(events, this.lastRun())) {
      return null;
    }
    const reasons = [
      newestError.stats?.['reason'],
      this.lastRun()?.stats?.['reason'],
      this.state.lastManualRun()?.reason,
    ];
    return {
      text: newestError.error || CURATOR_ERROR_FALLBACK,
      showSettings: reasons.some(
        (r) => typeof r === 'string' && SETTINGS_FIXABLE_REASONS.has(r),
      ),
    };
  });
  protected readonly cueListText = computed<string>(() => {
    const cues = this.triggers()?.userPromptSubmit?.cueList ?? [];
    return cues.join('\n');
  });

  public ngOnInit(): void {
    this.state.startPolling();
    void this.providers.refreshRoute();
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

  private readonly appState = inject(AppStateManager);
  private readonly providers = inject(ProvidersSettingsStateService);
  protected readonly resolvedCuratorModel = computed(() => {
    const route = this.providers.route();
    if (route.status !== 'ready') return 'Main agent route not checked';
    const model = route.data?.resolvedModel;
    return model?.kind === 'model'
      ? model.id
      : model?.kind === 'tier'
        ? `${model.tier} tier`
        : 'Model unresolved';
  });
  protected manageCurator(): void {
    this.appState.requestSettingsTab({
      tab: 'orchestration',
      section: 'background-models',
    });
    this.appState.setCurrentView('settings');
  }
}

const LOGS_FALLBACK = 'See the logs for details.';
const CURATOR_ERROR_FALLBACK =
  'The curator run failed. See the logs for details.';
/** Reasons a change in Settings > Background model roles can fix. */
const SETTINGS_FIXABLE_REASONS: ReadonlySet<string> = new Set([
  'provider-unsupported',
  'auth-required',
]);

/** The fields the run wording reads, from a manual run or `lastRunStats`. */
type RunSummary = Pick<
  ManualRunResult,
  'outcome' | 'extracted' | 'merged' | 'created' | 'error'
>;

/**
 * One wording for a pass: ran with or without new memories, did not run, or
 * failed. `error` is the backend's fixed sentence; it is never provider text.
 */
function describeRun(run: RunSummary, when: string): string {
  switch (run.outcome) {
    case 'stalled':
      return `Did not run · ${run.error || LOGS_FALLBACK}`;
    case 'failed':
      return `Failed · ${run.error || LOGS_FALLBACK}`;
    case 'ran':
      return run.created + run.merged > 0
        ? `Learned ${run.created} new, merged ${run.merged} (extracted ${run.extracted}) · ${when}`
        : `Ran · nothing new to learn · ${when}`;
  }
}

function formatSnapshot(
  snapshot: LastRunSnapshot | null,
  locale: string,
): string {
  if (!snapshot) return 'never';
  const when = formatDate(snapshot.at, 'short', locale);
  const stats = snapshot.stats;
  if (!stats) return when;
  return describeRun(
    {
      outcome: toOutcome(stats['outcome']),
      extracted: toCount(stats['extracted']),
      merged: toCount(stats['merged']),
      created: toCount(stats['created']),
      error: typeof stats['error'] === 'string' ? stats['error'] : null,
    },
    when,
  );
}

function toOutcome(value: unknown): MemoryCuratorRunOutcome {
  return value === 'stalled' || value === 'failed' ? value : 'ran';
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function newestOf(
  events: readonly MemoryCuratorEventWire[],
  match: (ev: MemoryCuratorEventWire) => boolean,
): MemoryCuratorEventWire | null {
  let newest: MemoryCuratorEventWire | null = null;
  for (const ev of events) {
    if (match(ev) && (newest === null || ev.timestamp > newest.timestamp)) {
      newest = ev;
    }
  }
  return newest;
}

/** Timestamp of the newest pass that ran (events or the last-run snapshot). */
function lastRanAt(
  events: readonly MemoryCuratorEventWire[],
  lastRun: LastRunSnapshot | null,
): number {
  const ran = newestOf(
    events,
    (ev) =>
      ev.kind === 'curator-run' ||
      (ev.kind === 'manual-run' && ev.stats?.['outcome'] === 'ran'),
  );
  const snapshotRan =
    lastRun !== null && toOutcome(lastRun.stats?.['outcome']) === 'ran'
      ? lastRun.at
      : 0;
  return Math.max(ran?.timestamp ?? 0, snapshotRan);
}
