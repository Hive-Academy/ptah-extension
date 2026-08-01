import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  AdminApiService,
  AdminStatsResponse,
} from '../services/admin-api.service';
import { StatTile } from '../components/stat-tile/stat-tile';
import { NeedsAttentionQueue } from './needs-attention-queue/needs-attention-queue';
import { WaitlistFunnel } from './waitlist-funnel/waitlist-funnel';

/**
 * AdminOverview — command-center landing view (design spec §3).
 *
 * Route: `/admin/overview`. Fetches `GET /api/v1/admin/stats` once on init
 * (with a manual retry affordance on error) and re-composes it, top-to-bottom,
 * into: a Needs-Attention action queue → the hero Waitlist funnel → a Members +
 * Cohorts row of `StatTile`s. Leads with what needs attention *today* rather
 * than a flat wall of equal-weight tiles. No charting library.
 */
@Component({
  selector: 'ptah-admin-overview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    NeedsAttentionQueue,
    WaitlistFunnel,
    StatTile,
  ],
  templateUrl: './overview.html',
  styleUrls: ['./overview.css'],
})
export class AdminOverview {
  private readonly api = inject(AdminApiService);

  /** Query-param intent read client-side by the Licenses view (spec §3.5). */
  protected readonly buildersLinkParams = {
    plan: 'builders',
    status: 'active',
  };

  protected readonly stats = signal<AdminStatsResponse | null>(null);
  protected readonly loading = signal<boolean>(false);
  protected readonly error = signal<string | null>(null);

  /** Total members across both tiers. */
  protected readonly totalMembers = computed<number>(() => {
    const s = this.stats();
    if (!s) return 0;
    return s.members.builders + s.members.community;
  });

  /**
   * Waitlist-not-yet-invited — always client-computable, feeds the queue's
   * first row (`total - notified`, floored at 0 for safety).
   */
  protected readonly waitlistUninvited = computed<number>(() => {
    const s = this.stats();
    if (!s) return 0;
    return Math.max(s.waitlist.total - s.waitlist.notified, 0);
  });

  /** Builders' share of total members as a delta-chip string — `null` when no members. */
  protected readonly buildersDelta = computed<string | null>(() => {
    const s = this.stats();
    const total = this.totalMembers();
    if (!s || total === 0) return null;
    return `${((s.members.builders / total) * 100).toFixed(1)}% of members`;
  });

  public constructor() {
    this.fetch();
  }

  protected fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getStats().subscribe({
      next: (res) => {
        this.stats.set(res);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(this.extractErrorMessage(err));
      },
    });
  }

  private extractErrorMessage(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const anyErr = err as { error?: { message?: string }; message?: string };
      return (
        anyErr.error?.message ?? anyErr.message ?? 'Failed to load admin stats.'
      );
    }
    return 'Failed to load admin stats.';
  }
}
