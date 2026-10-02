import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { SkillSynthesisEventWire } from '@ptah-extension/shared';

/**
 * One feed row: a run of consecutive events that share the grouping key
 * (see {@link groupConsecutiveEvents}). Identified by its newest member.
 */
export interface SkillEventGroup {
  /** Id of the newest event in the group; the row's stable identity. */
  readonly id: string;
  readonly kind: SkillSynthesisEventWire['kind'];
  readonly sessionId: string | null;
  readonly newestTimestamp: number;
  readonly oldestTimestamp: number;
  readonly count: number;
  /** The newest event in the group; its outcome is the one displayed. */
  readonly event: SkillSynthesisEventWire;
}

function sameGroup(
  a: SkillSynthesisEventWire,
  b: SkillSynthesisEventWire,
): boolean {
  if (a.kind !== b.kind) return false;
  if ((a.sessionId ?? null) !== (b.sessionId ?? null)) return false;
  // Distinct failures must stay visible as distinct rows.
  return a.kind !== 'error' || (a.error ?? null) === (b.error ?? null);
}

/**
 * Collapses consecutive events (input newest-first) with the same `kind` and
 * `sessionId` - and, for `error` events, the same `error` text - into one
 * group with a count. Returns at most `limit` groups, newest first.
 */
export function groupConsecutiveEvents(
  events: readonly SkillSynthesisEventWire[],
  limit: number,
): SkillEventGroup[] {
  const groups: SkillEventGroup[] = [];
  for (const ev of events) {
    const last = groups.at(-1);
    if (last !== undefined && sameGroup(last.event, ev)) {
      groups[groups.length - 1] = {
        ...last,
        count: last.count + 1,
        oldestTimestamp: ev.timestamp,
      };
      continue;
    }
    if (groups.length >= limit) break;
    groups.push({
      id: ev.id,
      kind: ev.kind,
      sessionId: ev.sessionId ?? null,
      newestTimestamp: ev.timestamp,
      oldestTimestamp: ev.timestamp,
      count: 1,
      event: ev,
    });
  }
  return groups;
}

interface FormattedRow {
  readonly id: string;
  readonly kind: string;
  readonly relative: string;
  readonly sessionId: string | null;
  readonly outcome: string;
  readonly count: number;
}

/**
 * Recent skill-synthesis activity.
 *
 * Input contract: `events` is NEWEST-FIRST (as `SkillDiagnosticsStateService`
 * keeps it). Consecutive repeats are grouped into one row with a count, and
 * `limit` counts rows, not raw events. Each row is tracked by the real id of
 * its newest event.
 */
@Component({
  selector: 'ptah-skill-event-feed',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length === 0) {
      <div class="text-xs text-base-content-muted">No recent events.</div>
    } @else {
      <ul class="flex flex-col gap-1 text-xs" role="list">
        @for (row of rows(); track row.id) {
          <li
            class="flex items-center gap-2 border-b border-base-300 py-1"
            [attr.data-event-id]="row.id"
          >
            <span class="badge badge-xs" [class]="badgeClass(row.kind)">
              {{ row.kind }}
            </span>
            @if (row.count > 1) {
              <span
                class="badge badge-xs badge-ghost font-mono"
                data-test="event-count"
              >
                <span aria-hidden="true">x{{ row.count }}</span>
                <span class="sr-only">{{ row.count }} events</span>
              </span>
            }
            <span class="font-mono text-[10px] text-base-content-muted">
              {{ row.relative }}
            </span>
            @if (row.sessionId) {
              <span
                class="font-mono text-[10px] text-base-content-muted truncate"
              >
                {{ row.sessionId }}
              </span>
            }
            <span
              class="text-base-content-muted truncate"
              [attr.title]="row.outcome"
              >{{ row.outcome }}</span
            >
          </li>
        }
      </ul>
    }
  `,
})
export class SkillEventFeedComponent {
  public readonly events = input.required<readonly SkillSynthesisEventWire[]>();
  public readonly limit = input<number>(10);

  protected readonly rows = computed<readonly FormattedRow[]>(() => {
    const groups = groupConsecutiveEvents(this.events(), this.limit());
    const now = Date.now();
    return groups.map<FormattedRow>((group) => ({
      id: group.id,
      kind: group.kind,
      relative: this.formatRelative(now - group.newestTimestamp),
      sessionId: group.sessionId,
      outcome: this.outcomeFor(group.event),
      count: group.count,
    }));
  });

  protected badgeClass(kind: string): string {
    switch (kind) {
      case 'analyze-run':
        return 'badge-success';
      case 'ineligible':
        return 'badge-warning';
      case 'error':
        return 'badge-error';
      case 'curator-pass':
        return 'badge-info';
      case 'subagent-stop':
        return 'badge-info';
      case 'edit-then-test':
        return 'badge-success';
      case 'rate-limited':
        return 'badge-warning';
      default:
        return 'badge-ghost';
    }
  }

  private outcomeFor(ev: SkillSynthesisEventWire): string {
    if (ev.error) return ev.error;
    if (ev.kind === 'rate-limited') return this.formatRateLimited(ev.stats);
    if (ev.kind === 'subagent-stop') {
      const subagent = ev.stats?.['subagent'];
      if (typeof subagent === 'string' && subagent.length > 0)
        return `subagent=${subagent}`;
    }
    if (ev.kind === 'edit-then-test') {
      const edits = ev.stats?.['editCount'];
      if (typeof edits === 'number') return `edits=${edits}, tests passed`;
    }
    return this.summarizeStats(ev.stats) ?? '—';
  }

  private formatRateLimited(stats: SkillSynthesisEventWire['stats']): string {
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

  private formatRelative(diffMs: number): string {
    if (!Number.isFinite(diffMs) || diffMs < 0) return '—';
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return sec + 's ago';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const days = Math.floor(hr / 24);
    return days + 'd ago';
  }

  private summarizeStats(
    stats:
      | Readonly<Record<string, number | string | boolean | null>>
      | undefined,
  ): string | null {
    if (!stats) return null;
    const entries = Object.entries(stats);
    if (entries.length === 0) return null;
    return entries
      .slice(0, 3)
      .map(([k, v]) => k + '=' + String(v))
      .join(', ');
  }
}
