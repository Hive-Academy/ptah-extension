import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { assertNever } from '@ptah-extension/shared';
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
        class="border-b border-base-300 px-3 py-2 text-sm font-semibold text-base-content"
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
  if (ev.kind === 'rate-limited') return formatRateLimited(ev.stats);
  if (ev.kind === 'user-cue-trigger') {
    const cue = ev.stats?.['cue'];
    if (typeof cue === 'string' && cue.length > 0) return `cue=${cue}`;
  }
  if (ev.kind === 'commit-detect') {
    const sha = ev.stats?.['sha'];
    if (typeof sha === 'string' && sha.length > 0) return `commit ${sha}`;
  }
  if (ev.kind === 'tool-failure') {
    const tool = ev.stats?.['tool'];
    const error = ev.stats?.['error'];
    const toolText = typeof tool === 'string' ? tool : 'tool';
    const errorText =
      typeof error === 'string' && error.length > 0 ? ` — ${error}` : '';
    return `observed ${toolText} failure during session${errorText}`;
  }
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

function formatRateLimited(stats: MemoryCuratorEventWire['stats']): string {
  const limit = stats?.['limit'];
  const resetAt = stats?.['resetAt'];
  const limitText =
    typeof limit === 'number'
      ? `Limit ${limit}/hour reached`
      : 'Rate limit reached';
  if (typeof resetAt === 'number' && Number.isFinite(resetAt)) {
    const time = new Date(resetAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${limitText}, resets at ${time}`;
  }
  return limitText;
}

function toneFor(ev: MemoryCuratorEventWire): FeedRow['tone'] {
  switch (ev.kind) {
    case 'error':
    case 'curator-error':
      return 'error';
    case 'curator-run':
    case 'manual-run':
      return 'success';
    case 'idle-trigger':
    case 'turn-trigger':
    case 'turn-complete-trigger':
    case 'episode-trigger':
    case 'session-end-trigger':
    case 'user-cue-trigger':
    case 'commit-detect':
      return 'info';
    case 'curator-skipped-no-data':
    case 'decay-run':
    case 'boot-scan':
    case 'embedder-download':
      return 'info';
    case 'rate-limited':
    case 'tool-failure':
      return 'warning';
    default:
      return assertNever(ev.kind);
  }
}
