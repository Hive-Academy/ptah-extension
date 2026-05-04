import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
} from '@angular/core';
import { AppStateManager, type ThothActiveTabId } from '@ptah-extension/core';
import {
  LucideAngularModule,
  Brain,
  Sparkles,
  Clock3,
  RadioTower,
  ChevronRight,
} from 'lucide-angular';
import { ThothStatusService } from '../../services/thoth-status.service';
import type {
  ThothGatewayBadge,
  ThothStatusSummary,
} from '../../services/thoth-status.service';

interface ThothRow {
  readonly id: ThothActiveTabId;
  readonly label: string;
  readonly icon: typeof Brain;
}

const ROWS: readonly ThothRow[] = [
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'cron', label: 'Cron', icon: Clock3 },
  { id: 'gateway', label: 'Gateway', icon: RadioTower },
];

/**
 * ThothStatusCardComponent
 *
 * Dashboard card summarising the four Thoth pillars (memory, skills, cron,
 * gateway). Each row is keyboard-reachable and clickable; activating a row
 * sets `activeView='thoth'` AND `thothActiveTab=<row.id>` via
 * {@link AppStateManager}, so the user lands directly on the corresponding
 * tab inside the Thoth shell.
 *
 * Data source: {@link ThothStatusService.summary} computed signal. The card
 * triggers a one-shot lazy refresh on init via `refreshIfNeeded()` — there
 * is no polling.
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
  private readonly appState = inject(AppStateManager);

  readonly ChevronRightIcon = ChevronRight;
  readonly RadioTowerIcon = RadioTower;

  readonly rows = ROWS;

  readonly summary = this.thothStatus.summary;
  readonly isLoading = computed(() => this.summary().isLoading);

  readonly memoryDescription = computed(() => {
    const m = this.summary().memory;
    if (!m.available) return 'Unavailable';
    return `${formatCount(m.totalFacts)} facts · ${formatCount(m.queueLength)} queued`;
  });

  readonly skillsDescription = computed(() => {
    const s = this.summary().skills;
    if (!s.available) return 'Unavailable';
    return `${formatCount(s.pendingCandidates)} pending candidate${
      s.pendingCandidates === 1 ? '' : 's'
    }`;
  });

  readonly cronDescription = computed(() => {
    const c = this.summary().cron;
    if (!c.available) {
      return c.reason === 'desktop-only' ? 'Desktop only' : 'Unavailable';
    }
    const next =
      c.nextRunAt !== null
        ? formatRelativeFuture(c.nextRunAt)
        : 'no upcoming runs';
    return `${formatCount(c.totalJobs)} job${c.totalJobs === 1 ? '' : 's'} · ${next}`;
  });

  readonly gatewayDescription = computed(() => {
    const g = this.summary().gateway;
    if (!g.available) {
      return g.reason === 'desktop-only' ? 'Desktop only' : 'Unavailable';
    }
    return `${formatCount(g.pendingBindings)} pending binding${
      g.pendingBindings === 1 ? '' : 's'
    }`;
  });

  readonly gatewayPlatforms = computed(() => {
    const g = this.summary().gateway;
    return g.available ? g.platforms : [];
  });

  ngOnInit(): void {
    void this.thothStatus.refreshIfNeeded();
  }

  openTab(tabId: ThothActiveTabId): void {
    this.appState.setThothActiveTab(tabId);
    this.appState.setCurrentView('thoth');
  }

  onRowKeydown(event: KeyboardEvent, tabId: ThothActiveTabId): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.openTab(tabId);
    }
  }

  errorFor(pillar: 'memory' | 'skills' | 'cron' | 'gateway'): string | null {
    return this.summary().errors[pillar];
  }

  badgeClassFor(state: ThothGatewayBadge): string {
    switch (state) {
      case 'running':
        return 'badge badge-success badge-sm';
      case 'enabled':
        return 'badge badge-info badge-sm';
      case 'error':
        return 'badge badge-error badge-sm';
      case 'disabled':
      default:
        return 'badge badge-ghost badge-sm';
    }
  }

  isUnavailable(
    pillarSummary: ThothStatusSummary['cron'] | ThothStatusSummary['gateway'],
  ): boolean {
    return !pillarSummary.available;
  }
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
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
