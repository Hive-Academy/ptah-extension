import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { SkillSynthesisEventWire } from '@ptah-extension/shared';

interface FormattedEvent {
  readonly kind: string;
  readonly timestamp: string;
  readonly relative: string;
  readonly sessionId: string | null;
  readonly outcome: string;
}

@Component({
  selector: 'ptah-skill-event-feed',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (formatted().length === 0) {
      <div class="text-xs text-base-content/60">No recent events.</div>
    } @else {
      <ul class="flex flex-col gap-1 text-xs" role="list">
        @for (ev of formatted(); track ev.timestamp + '-' + ev.kind) {
          <li class="flex items-center gap-2 border-b border-base-300 py-1">
            <span class="badge badge-xs" [class]="badgeClass(ev.kind)">
              {{ ev.kind }}
            </span>
            <span class="font-mono text-[10px] text-base-content/60">
              {{ ev.relative }}
            </span>
            @if (ev.sessionId) {
              <span class="font-mono text-[10px] text-base-content/40 truncate">
                {{ ev.sessionId }}
              </span>
            }
            <span class="text-base-content/80 truncate">{{ ev.outcome }}</span>
          </li>
        }
      </ul>
    }
  `,
})
export class SkillEventFeedComponent {
  public readonly events = input.required<readonly SkillSynthesisEventWire[]>();
  public readonly limit = input<number>(10);

  protected readonly formatted = computed<readonly FormattedEvent[]>(() => {
    const events = this.events();
    const limit = this.limit();
    const now = Date.now();
    return events.slice(0, limit).map<FormattedEvent>((ev) => ({
      kind: ev.kind,
      timestamp: new Date(ev.timestamp).toISOString(),
      relative: this.formatRelative(now - ev.timestamp),
      sessionId: ev.sessionId ?? null,
      outcome: ev.error ?? this.summarizeStats(ev.stats) ?? '—',
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
      default:
        return 'badge-ghost';
    }
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
