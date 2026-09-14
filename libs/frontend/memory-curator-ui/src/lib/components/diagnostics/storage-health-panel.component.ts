import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type {
  MemoryRetentionRunDto,
  MemoryStorageHealthDto,
} from '@ptah-extension/shared';
import { NativeCardComponent, type NativeCardTone } from '@ptah-extension/ui';

const NULL_TEXT = '—';

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * Format a byte count with binary (1024) steps. `null` means the backend could
 * not measure the value, and renders as `—` rather than a misleading zero.
 *
 * Local PURE function: no shared byte formatter exists, and the marketplace
 * one is private to that surface.
 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return NULL_TEXT;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded =
    value >= 100 ? value.toFixed(0) : value.toFixed(2).replace(/\.?0+$/, '');
  return `${rounded} ${units[unitIndex]}`;
}

/**
 * Format a count, `null` → `—`. Locale pinned so the grouped output is
 * identical on every machine and CI locale.
 */
export function formatCount(value: number | null): string {
  if (value === null) return NULL_TEXT;
  return value.toLocaleString('en-US');
}

function formatSpan(ms: number): string {
  if (ms < MS_PER_MINUTE) {
    return `${Math.max(1, Math.round(ms / MS_PER_SECOND))} s`;
  }
  if (ms < MS_PER_HOUR) return `${Math.round(ms / MS_PER_MINUTE)} min`;
  if (ms < MS_PER_DAY) return `${Math.round(ms / MS_PER_HOUR)} h`;
  return `${Math.round(ms / MS_PER_DAY)} days`;
}

/**
 * Format a timestamp relative to `now`, past or future ("3 days ago",
 * "in 40 min"). `null` → `—`.
 */
export function formatRelativeTime(
  at: number | null,
  now: number,
): string {
  if (at === null) return NULL_TEXT;
  const diff = now - at;
  if (diff >= 0) return `${formatSpan(diff)} ago`;
  return `in ${formatSpan(-diff)}`;
}

interface LastRunView {
  readonly outcome: MemoryRetentionRunDto['outcome'];
  readonly finishedText: string;
  readonly purgedText: string;
  readonly quarantinedText: string;
  readonly pagesText: string;
  readonly detailLabel: string;
  readonly detailText: string | null;
}

interface StorageViewModel {
  readonly dbSizeText: string;
  readonly reclaimableText: string;
  readonly pendingRowsText: string;
  readonly pendingBytesText: string;
  readonly oldestPendingText: string;
  readonly stuckRowsText: string;
  readonly quarantineLedgerRowsText: string;
  readonly processedRowsText: string;
  readonly processedBytesText: string;
  readonly retentionEnabled: boolean;
  readonly processedDaysText: string;
  readonly stuckDaysText: string;
  readonly nextDueText: string;
  readonly lastRun: LastRunView | null;
  readonly lastRunTone: NativeCardTone;
  readonly lastSkip: { readonly atText: string; readonly reason: string } | null;
  readonly readErrors: readonly string[];
}

const RUN_TONE: Record<MemoryRetentionRunDto['outcome'], NativeCardTone> = {
  completed: 'success',
  partial: 'warning',
  failed: 'error',
};

@Component({
  selector: 'ptah-storage-health-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NativeCardComponent],
  template: `
    <section class="flex flex-col gap-2" aria-label="Storage and retention">
      <header class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-semibold text-base-content">
          Storage and Retention
        </h3>
        @if (vm(); as v) {
          <span
            class="badge badge-sm"
            [class.badge-success]="v.retentionEnabled"
            [class.badge-ghost]="!v.retentionEnabled"
            data-testid="storage-retention-badge"
          >
            {{ v.retentionEnabled ? 'retention on' : 'retention off' }}
          </span>
        }
      </header>

      @if (vm(); as v) {
        <div class="grid gap-2 sm:grid-cols-2">
          <ptah-native-card [spine]="true" density="compact">
            <div card-header class="text-xs font-medium">Database size</div>
            <p class="text-sm tabular-nums" data-testid="storage-db-size">
              {{ v.dbSizeText }}
            </p>
            <div card-footer class="text-xs text-base-content-muted">
              Reclaimable: {{ v.reclaimableText }}
            </div>
          </ptah-native-card>

          <ptah-native-card [spine]="true" density="compact">
            <div card-header class="text-xs font-medium">
              Pending observations
            </div>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt class="text-base-content-muted">Rows</dt>
              <dd class="tabular-nums" data-testid="storage-pending-rows">
                {{ v.pendingRowsText }}
              </dd>
              <dt class="text-base-content-muted">Size</dt>
              <dd class="tabular-nums" data-testid="storage-pending-bytes">
                {{ v.pendingBytesText }}
              </dd>
              <dt class="text-base-content-muted">Oldest pending</dt>
              <dd data-testid="storage-oldest-pending">
                {{ v.oldestPendingText }}
              </dd>
            </dl>
          </ptah-native-card>

          <ptah-native-card [spine]="true" density="compact">
            <div card-header class="text-xs font-medium">Quarantine</div>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt class="text-base-content-muted">Stuck eligible</dt>
              <dd class="tabular-nums" data-testid="storage-stuck-rows">
                {{ v.stuckRowsText }}
              </dd>
              <dt class="text-base-content-muted">Ledger rows</dt>
              <dd class="tabular-nums">{{ v.quarantineLedgerRowsText }}</dd>
            </dl>
          </ptah-native-card>

          <ptah-native-card [spine]="true" density="compact">
            <div card-header class="text-xs font-medium">
              Processed observations
            </div>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt class="text-base-content-muted">Rows</dt>
              <dd class="tabular-nums" data-testid="storage-processed-rows">
                {{ v.processedRowsText }}
              </dd>
              <dt class="text-base-content-muted">Size</dt>
              <dd class="tabular-nums">{{ v.processedBytesText }}</dd>
            </dl>
            <div card-footer class="text-xs text-base-content-muted">
              as of last retention run · estimate
            </div>
          </ptah-native-card>

          <ptah-native-card
            [spine]="true"
            density="compact"
            [tone]="v.lastRunTone"
          >
            <div card-header class="flex items-center justify-between gap-2">
              <span class="text-xs font-medium">Last retention run</span>
              @if (v.lastRun; as run) {
                <span
                  class="badge badge-sm"
                  [class.badge-success]="run.outcome === 'completed'"
                  [class.badge-warning]="run.outcome === 'partial'"
                  [class.badge-error]="run.outcome === 'failed'"
                  data-testid="storage-run-badge"
                >
                  {{ run.outcome }}
                </span>
              }
            </div>
            @if (v.lastRun; as run) {
              <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt class="text-base-content-muted">Finished</dt>
                <dd>{{ run.finishedText }}</dd>
                <dt class="text-base-content-muted">Purged</dt>
                <dd class="tabular-nums">{{ run.purgedText }}</dd>
                <dt class="text-base-content-muted">Quarantined</dt>
                <dd class="tabular-nums">{{ run.quarantinedText }}</dd>
                <dt class="text-base-content-muted">Pages reclaimed</dt>
                <dd class="tabular-nums">{{ run.pagesText }}</dd>
              </dl>
              @if (run.detailText; as detail) {
                <p
                  class="text-xs"
                  [class.text-warning]="run.outcome === 'partial'"
                  [class.text-error]="run.outcome === 'failed'"
                  data-testid="storage-run-detail"
                >
                  {{ run.detailLabel }}: {{ detail }}
                </p>
              }
            } @else {
              <p class="text-xs text-base-content-muted">
                No retention run recorded yet.
              </p>
            }
          </ptah-native-card>

          <ptah-native-card [spine]="true" density="compact">
            <div card-header class="text-xs font-medium">
              Retention settings
            </div>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt class="text-base-content-muted">Processed after</dt>
              <dd>{{ v.processedDaysText }} days</dd>
              <dt class="text-base-content-muted">Stuck after</dt>
              <dd>{{ v.stuckDaysText }} days</dd>
              <dt class="text-base-content-muted">Next run</dt>
              <dd data-testid="storage-next-due">{{ v.nextDueText }}</dd>
            </dl>
            @if (v.lastSkip; as skip) {
              <div card-footer class="text-xs text-base-content-muted">
                Last skipped {{ skip.atText }} — {{ skip.reason }}
              </div>
            }
          </ptah-native-card>
        </div>

        @if (v.readErrors.length > 0) {
          <div
            class="rounded-xl border border-base-300 bg-base-200/40 px-3 py-2"
            data-testid="storage-read-errors"
          >
            <ul class="list-disc space-y-0.5 pl-5">
              @for (err of v.readErrors; track err) {
                <li class="font-mono text-[10px] text-base-content-muted">
                  {{ err }}
                </li>
              }
            </ul>
          </div>
        }
      } @else {
        <div
          class="rounded-xl border border-base-300 bg-base-200/40 px-3 py-3 text-xs text-base-content-muted"
          data-testid="storage-empty"
        >
          No storage data yet.
        </div>
      }
    </section>
  `,
})
export class StorageHealthPanelComponent {
  public readonly storage = input<MemoryStorageHealthDto | null>(null);

  /**
   * Clock for relative-time rendering, bound by the accordion's shared `now`
   * computed (same contract as `EventFeedComponent.now`). `0` = use the real
   * clock.
   */
  public readonly now = input<number>(0);

  protected readonly vm = computed<StorageViewModel | null>(() => {
    const s = this.storage();
    if (!s) return null;
    const now = this.now() || Date.now();
    const run = s.retention.lastRun;
    const lastRun: LastRunView | null = run
      ? {
          outcome: run.outcome,
          finishedText: formatRelativeTime(run.finishedAt, now),
          purgedText: formatCount(run.processedPurged),
          quarantinedText: formatCount(run.stuckQuarantined),
          pagesText: formatCount(run.pagesReclaimed),
          detailLabel: run.outcome === 'failed' ? 'Error' : 'Reason',
          detailText:
            run.outcome === 'failed' ? run.error : run.reason,
        }
      : null;
    const skipAt = s.retention.lastSkippedAt;
    const skipReason = s.retention.lastSkipReason;
    const lastSkip =
      skipAt !== null || skipReason !== null
        ? {
            atText: formatRelativeTime(skipAt, now),
            reason: skipReason ?? NULL_TEXT,
          }
        : null;
    return {
      dbSizeText: formatBytes(s.dbBytes),
      reclaimableText: formatBytes(s.reclaimableBytes),
      pendingRowsText: formatCount(s.observations.pendingRows),
      pendingBytesText: formatBytes(s.observations.pendingBytes),
      oldestPendingText: formatRelativeTime(
        s.observations.oldestPendingAt,
        now,
      ),
      stuckRowsText: formatCount(s.observations.stuckEligibleRows),
      quarantineLedgerRowsText: formatCount(
        s.observations.quarantineLedgerRows,
      ),
      processedRowsText: formatCount(s.observations.processedRows),
      processedBytesText: formatBytes(s.observations.processedBytesEstimate),
      retentionEnabled: s.retention.enabled,
      processedDaysText: formatCount(s.retention.processedDays),
      stuckDaysText: formatCount(s.retention.stuckDays),
      nextDueText:
        s.retention.nextDueAt !== null
          ? formatRelativeTime(s.retention.nextDueAt, now)
          : 'at the next idle hourly check',
      lastRun,
      lastRunTone: lastRun ? RUN_TONE[lastRun.outcome] : 'neutral',
      lastSkip,
      readErrors: s.readErrors ?? [],
    };
  });
}