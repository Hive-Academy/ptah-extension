import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';

import {
  AdminApiService,
  AdminStatsResponse,
} from '../../../services/admin-api.service';

/**
 * AdminOverview — default admin landing view.
 *
 * Route: `/admin/overview`. Fetches `GET /api/v1/admin/stats` once on init
 * (with a manual retry affordance on error) and renders it as a row of stat
 * tiles: no chart library, just numbers + a couple of inline derived ratios
 * (conversion %, builders share of total members).
 */
@Component({
  selector: 'ptah-admin-overview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe],
  templateUrl: './overview.html',
  styleUrls: ['./overview.css'],
})
export class AdminOverview {
  private readonly api = inject(AdminApiService);

  protected readonly stats = signal<AdminStatsResponse | null>(null);
  protected readonly loading = signal<boolean>(false);
  protected readonly error = signal<string | null>(null);

  /** Waitlist conversion rate — converted / total, `null` when total is 0 (avoids 0/0 -> NaN%). */
  protected readonly conversionPct = computed<number | null>(() => {
    const s = this.stats();
    if (!s || s.waitlist.total === 0) return null;
    return (s.waitlist.converted / s.waitlist.total) * 100;
  });

  /** Total members across both tiers. */
  protected readonly totalMembers = computed<number>(() => {
    const s = this.stats();
    if (!s) return 0;
    return s.members.builders + s.members.community;
  });

  /** Builders' share of total members — `null` when there are no members yet. */
  protected readonly buildersSharePct = computed<number | null>(() => {
    const s = this.stats();
    const total = this.totalMembers();
    if (!s || total === 0) return null;
    return (s.members.builders / total) * 100;
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
