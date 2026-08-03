import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ArrowLeft, LucideAngularModule } from 'lucide-angular';

import { AdminApiService } from '../../../services/admin-api.service';
import { EmptyState } from '@ptah-web/panel-ui';
import { StatTile, StatTileDeltaTone } from '@ptah-web/panel-ui';
import { StatusBadge } from '@ptah-web/panel-ui';
import type { BadgeVariant } from '@ptah-web/panel-ui';
import {
  computeCampaignRates,
  rateTone,
  RateTone,
} from '../../marketing-metrics';
import { segmentLabel } from '../../marketing-segment-labels';
import { asCampaignRow, CampaignRow, formatRate } from '../campaign-row';
import { relativeDate } from '../relative-time';

/** One Performance-card rate tile (§5.2). */
interface RateTile {
  label: string;
  value: string;
  delta: string | null;
  deltaTone: StatTileDeltaTone;
}

/** Short band word per tone for the tile's delta chip (§3.7). */
const TONE_BAND: Record<RateTone, string | null> = {
  success: 'Healthy',
  warning: 'Watch',
  error: 'Poor',
  neutral: null,
};

/**
 * CampaignDetail — bespoke read-only performance record for a single campaign
 * (design spec §5.2). Route `/admin/marketing-campaigns/:id`, fetched via the
 * generic `get('marketing-campaigns', id)` endpoint.
 *
 * Three stacked cards — Header (identity + status + subject + metadata),
 * Performance (three rate `StatTile`s over the shared `computeCampaignRates`,
 * raw counts as supporting detail), Audience (segment label or "Explicit
 * recipient list" + recipient count + a Compose deep-link when a segment is
 * present). Everything is built from today's stored row fields — no fabricated
 * roster or time-series.
 */
@Component({
  selector: 'ptah-admin-campaign-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    LucideAngularModule,
    StatTile,
    StatusBadge,
    EmptyState,
  ],
  templateUrl: './campaign-detail.html',
})
export class CampaignDetail {
  private readonly api = inject(AdminApiService);
  private readonly route = inject(ActivatedRoute);

  protected readonly ArrowLeftIcon = ArrowLeft;

  private readonly idParam = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  protected readonly campaignId = computed<string | null>(
    () => this.idParam()?.get('id') ?? null,
  );

  protected readonly campaign = signal<CampaignRow | null>(null);
  protected readonly loading = signal<boolean>(false);
  protected readonly loadError = signal<string | null>(null);

  /** Client-derived Sending/Completed status (§3.7). */
  protected readonly statusLabel = computed<string>(() =>
    this.campaign()?.completedAt ? 'Completed' : 'Sending',
  );
  protected readonly statusVariant = computed<BadgeVariant>(() =>
    this.campaign()?.completedAt ? 'success' : 'info',
  );

  /** Three Performance-card rate tiles (§5.2). */
  protected readonly rateTiles = computed<RateTile[]>(() => {
    const c = this.campaign();
    if (!c) return [];
    const rates = computeCampaignRates(c);
    const tile = (
      label: string,
      value: number | null,
      kind: 'delivery' | 'bounce' | 'complaint',
    ): RateTile => {
      const tone = rateTone(value, kind);
      return {
        label,
        value: formatRate(value),
        delta: TONE_BAND[tone],
        deltaTone: toDeltaTone(tone),
      };
    };
    return [
      tile('DELIVERY', rates.deliveryRate, 'delivery'),
      tile('BOUNCE', rates.bounceRate, 'bounce'),
      tile('COMPLAINTS', rates.complaintRate, 'complaint'),
    ];
  });

  /** Whether a real audience segment (vs. an explicit user-ID list) was targeted. */
  protected readonly hasSegment = computed<boolean>(
    () => !!this.campaign()?.segment,
  );
  protected readonly audienceLabel = computed<string>(() => {
    const seg = this.campaign()?.segment;
    return seg ? segmentLabel(seg) : 'Explicit recipient list';
  });

  public constructor() {
    effect(() => {
      const id = this.campaignId();
      if (id) this.load(id);
      else this.campaign.set(null);
    });
  }

  protected relative(iso: string | null): string {
    return relativeDate(iso);
  }

  protected retry(): void {
    const id = this.campaignId();
    if (id) this.load(id);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.campaign.set(null);
    this.api.get<Record<string, unknown>>('marketing-campaigns', id).subscribe({
      next: (rec) => {
        this.campaign.set(asCampaignRow(rec));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('Failed to load campaign.');
      },
    });
  }
}

/** Map a metric tone to a stat-tile delta tone (`neutral` bands stay muted). */
function toDeltaTone(tone: RateTone): StatTileDeltaTone {
  return tone === 'neutral' ? 'neutral' : tone;
}
