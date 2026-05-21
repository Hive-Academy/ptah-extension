import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { MemoryCuratorEventWire } from '@ptah-extension/shared';

interface FeedRow {
  readonly key: string;
  readonly kind: string;
  readonly relative: string;
  readonly outcome: string;
  readonly tone: 'success' | 'warning' | 'info' | 'error';
}

const MAX_ROWS = 10;

@Component({
  selector: 'ptah-event-feed',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rounded-md border border-base-300 bg-base-100">
      <header
        class="border-b border-base-300 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-base-content/70"
      >
        Recent events
      </header>
      @if (rows().length === 0) {
        <div
          class="px-3 py-3 text-xs text-base-content/60"
          data-testid="event-feed-empty"
        >
          No recent events
        </div>
      } @else {
        <ul class="divide-y divide-base-200">
          @for (row of rows(); track row.key) {
            <li
              class="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
            >
              <span
                class="badge badge-sm"
                [class.badge-success]="row.tone === 'success'"
                [class.badge-warning]="row.tone === 'warning'"
                [class.badge-info]="row.tone === 'info'"
                [class.badge-error]="row.tone === 'error'"
                >{{ row.kind }}</span
              >
              <span class="flex-1 truncate">{{ row.outcome }}</span>
              <span class="tabular-nums text-base-content/60">{{
                row.relative
              }}</span>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class EventFeedComponent {
  public readonly events = input<readonly MemoryCuratorEventWire[]>([]);
  public readonly now = input<number>(0);

  protected readonly rows = computed<readonly FeedRow[]>(() => {
    const list = [...this.events()]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_ROWS);
    const referenceNow = this.now() || Date.now();
    return list.map((ev, idx) => ({
      key: `${ev.timestamp}-${ev.kind}-${idx}`,
      kind: ev.kind,
      relative: formatRelative(referenceNow - ev.timestamp),
      outcome: buildOutcome(ev),
      tone: toneFor(ev),
    }));
  });
}

function formatRelative(deltaMs: number): string {
  if (deltaMs < 0) return 'just now';
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function buildOutcome(ev: MemoryCuratorEventWire): string {
  if (ev.error) return ev.error;
  const stats = ev.stats;
  if (stats) {
    const entries = Object.entries(stats)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}=${String(v)}`)
      .slice(0, 3);
    if (entries.length > 0) return entries.join(', ');
  }
  if (ev.sessionId) return `session=${ev.sessionId}`;
  return ev.kind;
}

function toneFor(ev: MemoryCuratorEventWire): FeedRow['tone'] {
  if (ev.kind === 'error') return 'error';
  if (ev.kind === 'curator-run' || ev.kind === 'manual-run') return 'success';
  if (ev.kind === 'idle-trigger' || ev.kind === 'turn-trigger') return 'info';
  return 'warning';
}
