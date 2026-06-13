import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
} from '@angular/core';
import type { ThothActiveTabId } from '@ptah-extension/core';
import {
  LucideAngularModule,
  Brain,
  Sparkles,
  Clock3,
  RadioTower,
} from 'lucide-angular';
import { ThothStatusService } from '../../services/thoth-status.service';
import type { ThothGatewayBadge } from '../../services/thoth-status.service';
import { formatCompact } from '../../utils/format.utils';

type PillarId = ThothActiveTabId;

interface ThothTile {
  readonly id: PillarId;
  readonly label: string;
  readonly icon: typeof Brain;
  readonly accent: string;
  readonly value: string;
  readonly unit: string;
  readonly desc: string;
  readonly available: boolean;
  readonly platforms: readonly {
    readonly platform: string;
    readonly state: ThothGatewayBadge;
    readonly lastError?: string;
  }[];
  readonly error: string | null;
}

interface PillarMeta {
  readonly id: PillarId;
  readonly label: string;
  readonly icon: typeof Brain;
  readonly accent: string;
}

const PILLARS: readonly PillarMeta[] = [
  { id: 'memory', label: 'Memory', icon: Brain, accent: 'text-primary' },
  { id: 'skills', label: 'Skills', icon: Sparkles, accent: 'text-secondary' },
  { id: 'cron', label: 'Cron', icon: Clock3, accent: 'text-info' },
  { id: 'gateway', label: 'Gateway', icon: RadioTower, accent: 'text-accent' },
];

/**
 * ThothStatusCardComponent
 *
 * Four daisyUI stat tiles summarising the Thoth pillars (memory, skills, cron,
 * gateway) with a big primary number and a secondary detail line. Rendered at
 * the top of the Thoth page as read-only status; tiles are not interactive.
 * Data comes from {@link ThothStatusService.summary}; a one-shot lazy refresh
 * fires on init (no polling).
 */
@Component({
  selector: 'ptah-thoth-status-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './thoth-status-card.component.html',
})
export class ThothStatusCardComponent implements OnInit {
  private readonly thothStatus = inject(ThothStatusService);

  readonly summary = this.thothStatus.summary;
  readonly isLoading = computed(() => this.summary().isLoading);

  readonly tiles = computed<readonly ThothTile[]>(() => {
    const s = this.summary();
    return PILLARS.map((p): ThothTile => {
      const base = {
        id: p.id,
        label: p.label,
        icon: p.icon,
        accent: p.accent,
        platforms: [],
        error: s.errors[p.id],
      } as const;

      switch (p.id) {
        case 'memory': {
          const m = s.memory;
          if (!m.available) {
            return {
              ...base,
              value: '—',
              unit: '',
              desc: 'Unavailable',
              available: false,
            };
          }
          return {
            ...base,
            value: formatCompact(m.totalFacts),
            unit: m.totalFacts === 1 ? 'fact' : 'facts',
            desc:
              m.queueLength > 0
                ? `${formatCompact(m.queueLength)} queued for curation`
                : 'All curated',
            available: true,
          };
        }
        case 'skills': {
          const sk = s.skills;
          if (!sk.available) {
            return {
              ...base,
              value: '—',
              unit: '',
              desc: 'Unavailable',
              available: false,
            };
          }
          return {
            ...base,
            value: formatCompact(sk.pendingCandidates),
            unit: 'pending',
            desc:
              sk.pendingCandidates > 0
                ? `candidate${sk.pendingCandidates === 1 ? '' : 's'} to review`
                : 'No skills awaiting review',
            available: true,
          };
        }
        case 'cron': {
          const c = s.cron;
          if (!c.available) {
            return {
              ...base,
              value: '—',
              unit: '',
              desc:
                c.reason === 'desktop-only' ? 'Desktop only' : 'Unavailable',
              available: false,
            };
          }
          return {
            ...base,
            value: formatCompact(c.totalJobs),
            unit: c.totalJobs === 1 ? 'job' : 'jobs',
            desc:
              c.nextRunAt !== null
                ? `next run ${formatRelativeFuture(c.nextRunAt)}`
                : 'no upcoming runs',
            available: true,
          };
        }
        case 'gateway':
        default: {
          const g = s.gateway;
          if (!g.available) {
            return {
              ...base,
              value: '—',
              unit: '',
              desc:
                g.reason === 'desktop-only' ? 'Desktop only' : 'Unavailable',
              available: false,
            };
          }
          const runningCount = g.platforms.filter(
            (p) => p.state === 'running',
          ).length;
          return {
            ...base,
            value: formatCompact(runningCount),
            unit: 'running',
            desc:
              g.pendingBindings > 0
                ? `${formatCompact(g.pendingBindings)} pending approval`
                : 'no pending approvals',
            available: true,
            platforms: g.platforms,
          };
        }
      }
    });
  });

  ngOnInit(): void {
    void this.thothStatus.refreshIfNeeded();
  }

  badgeClassFor(state: ThothGatewayBadge): string {
    switch (state) {
      case 'running':
        return 'badge badge-success badge-xs';
      case 'enabled':
        return 'badge badge-info badge-xs';
      case 'error':
        return 'badge badge-error badge-xs';
      case 'disabled':
      default:
        return 'badge badge-ghost badge-xs';
    }
  }
}

function formatRelativeFuture(timestamp: number): string {
  const diffMs = timestamp - Date.now();
  if (diffMs <= 0) return 'now';
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}
