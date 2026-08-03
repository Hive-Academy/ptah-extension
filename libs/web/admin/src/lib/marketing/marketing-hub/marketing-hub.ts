import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ChevronRight,
  FileText,
  LucideAngularModule,
  Megaphone,
  Plus,
} from 'lucide-angular';

import {
  AdminApiService,
  MarketingSegmentKey,
  MarketingSegmentsResponse,
  MarketingTemplate,
} from '../../services/admin-api.service';
import { EmptyState } from '@ptah-web/panel-ui';
import { StatTile, StatTileDeltaTone } from '@ptah-web/panel-ui';
import { StatusBadge } from '@ptah-web/panel-ui';
import {
  asCampaignRow,
  CampaignRow,
  CampaignRowVm,
  toCampaignRowVm,
} from '../campaign-history/campaign-row';
import { relativeDate } from '../campaign-history/relative-time';
import { computeCampaignRates, rateTone, RateTone } from '../marketing-metrics';
import { SEGMENT_LABELS } from '../marketing-segment-labels';

/** One Audience-panel card (§3.5). */
interface AudienceCard {
  key: MarketingSegmentKey;
  label: string;
  optedIn: number;
  total: number;
}

/** Fixed display order for the four Audience cards (§3.5). */
const SEGMENT_ORDER: readonly MarketingSegmentKey[] = [
  'all',
  'buildersActive',
  'communityActive',
  'subscriptionPastDue',
];

/** Band copy for the delta chip under each rate stat (§3.3). */
const DELIVERY_BAND: Record<RateTone, string | null> = {
  success: 'Healthy',
  warning: 'Watch',
  error: 'Low',
  neutral: null,
};
const BOUNCE_BAND: Record<RateTone, string | null> = {
  success: 'Healthy',
  warning: 'Elevated',
  error: 'High',
  neutral: null,
};

/** How many campaigns the last-N rate averages are computed over (§3.1). */
const RATE_WINDOW = 10;

/**
 * MarketingHub — landing page for the marketing cluster (design spec §3).
 *
 * Route `/admin/marketing`. Leads with send *performance* (rates, not counts)
 * and audience reach, then routes into Compose / History / Templates. Three
 * parallel real requests, zero backend change:
 *   - `list('marketing-campaigns', …last 10…)` → Recent list + last-10 rate
 *     averages + lifetime `.total` count.
 *   - `getMarketingSegments()` → Audience panel.
 *   - `list('marketing-campaign-templates', …last 5…)` → Templates strip + count.
 *
 * Averages are honestly labelled "LAST 10" (client-computed over the fetched
 * window); only `.total` is a true server-computed lifetime figure.
 */
@Component({
  selector: 'ptah-admin-marketing-hub',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideAngularModule, StatTile, StatusBadge, EmptyState],
  templateUrl: './marketing-hub.html',
})
export class MarketingHub {
  private readonly api = inject(AdminApiService);

  protected readonly MegaphoneIcon = Megaphone;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly FileTextIcon = FileText;
  protected readonly PlusIcon = Plus;

  // --- Campaigns (drives Recent list + rate averages + lifetime count) -----
  private readonly campaigns = signal<CampaignRow[] | null>(null);
  private readonly campaignsTotal = signal<number>(0);
  protected readonly campaignsLoading = signal<boolean>(true);
  protected readonly campaignsError = signal<boolean>(false);

  // --- Segments (Audience panel) -------------------------------------------
  private readonly segments = signal<MarketingSegmentsResponse | null>(null);
  protected readonly segmentsLoading = signal<boolean>(true);

  // --- Templates (Templates strip + count) ---------------------------------
  private readonly templates = signal<MarketingTemplate[] | null>(null);
  protected readonly templatesTotal = signal<number>(0);
  protected readonly templatesLoading = signal<boolean>(true);

  /** True lifetime campaign count (server-computed envelope `.total`). */
  protected readonly lifetimeCount = computed<number>(() =>
    this.campaignsTotal(),
  );

  /** Zero-campaign hub → collapse the stat row into a single empty state. */
  protected readonly noCampaigns = computed<boolean>(
    () => !this.campaignsLoading() && this.lifetimeCount() === 0,
  );

  /** Up to 5 recent campaigns as compact row view-models (§3.4). */
  protected readonly recentRows = computed<CampaignRowVm[]>(() =>
    (this.campaigns() ?? []).slice(0, 5).map(toCampaignRowVm),
  );

  private readonly avgDelivery = computed<number | null>(() =>
    this.averageRate('delivery'),
  );
  private readonly avgBounce = computed<number | null>(() =>
    this.averageRate('bounce'),
  );

  /** `98.2%` display for the Avg Delivery tile (§3.3), em-dash when unknown. */
  protected readonly avgDeliveryValue = computed<string | null>(() => {
    const v = this.avgDelivery();
    return v === null ? null : `${v.toFixed(1)}%`;
  });
  protected readonly avgBounceValue = computed<string | null>(() => {
    const v = this.avgBounce();
    return v === null ? null : `${v.toFixed(1)}%`;
  });

  protected readonly deliveryDeltaTone = computed<StatTileDeltaTone>(() =>
    toDeltaTone(rateTone(this.avgDelivery(), 'delivery')),
  );
  protected readonly bounceDeltaTone = computed<StatTileDeltaTone>(() =>
    toDeltaTone(rateTone(this.avgBounce(), 'bounce')),
  );
  protected readonly deliveryDelta = computed<string | null>(
    () => DELIVERY_BAND[rateTone(this.avgDelivery(), 'delivery')],
  );
  protected readonly bounceDelta = computed<string | null>(
    () => BOUNCE_BAND[rateTone(this.avgBounce(), 'bounce')],
  );

  /** Four Audience cards in fixed order (§3.5). */
  protected readonly audienceCards = computed<AudienceCard[]>(() => {
    const s = this.segments();
    if (!s) return [];
    return SEGMENT_ORDER.map((key) => ({
      key,
      label: SEGMENT_LABELS[key],
      optedIn: s[key].optedIn,
      total: s[key].total,
    }));
  });

  /** Up to 4 most-recently-updated templates (§3.6). */
  protected readonly recentTemplates = computed<MarketingTemplate[]>(() =>
    (this.templates() ?? []).slice(0, 4),
  );
  protected readonly noTemplates = computed<boolean>(
    () => !this.templatesLoading() && (this.templates() ?? []).length === 0,
  );

  /** Placeholder arrays for skeleton loading rows/cards. */
  protected readonly skeletonRows = Array.from({ length: 3 });
  protected readonly skeletonCards = Array.from({ length: 4 });

  public constructor() {
    this.loadCampaigns();
    this.loadSegments();
    this.loadTemplates();
  }

  protected relative(iso: string | null): string {
    return relativeDate(iso);
  }

  private loadCampaigns(): void {
    this.campaignsLoading.set(true);
    this.campaignsError.set(false);
    this.api
      .list<Record<string, unknown>>('marketing-campaigns', {
        pageSize: RATE_WINDOW,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      })
      .subscribe({
        next: (res) => {
          this.campaigns.set(res.data.map(asCampaignRow));
          this.campaignsTotal.set(res.total);
          this.campaignsLoading.set(false);
        },
        error: () => {
          this.campaignsError.set(true);
          this.campaignsLoading.set(false);
        },
      });
  }

  private loadSegments(): void {
    this.segmentsLoading.set(true);
    this.api.getMarketingSegments().subscribe({
      next: (res) => {
        this.segments.set(res);
        this.segmentsLoading.set(false);
      },
      error: () => this.segmentsLoading.set(false),
    });
  }

  private loadTemplates(): void {
    this.templatesLoading.set(true);
    this.api
      .list<MarketingTemplate>('marketing-campaign-templates', {
        pageSize: 5,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      })
      .subscribe({
        next: (res) => {
          this.templates.set(res.data);
          this.templatesTotal.set(res.total);
          this.templatesLoading.set(false);
        },
        error: () => this.templatesLoading.set(false),
      });
  }

  /**
   * Mean of the non-null delivery/bounce rates across the fetched window
   * (up to {@link RATE_WINDOW} campaigns). `null` when no campaign in the
   * window has a computable rate — never a fabricated 0%.
   */
  private averageRate(kind: 'delivery' | 'bounce'): number | null {
    const rows = this.campaigns();
    if (!rows || rows.length === 0) return null;
    const values: number[] = [];
    for (const row of rows) {
      const rates = computeCampaignRates(row);
      const v = kind === 'delivery' ? rates.deliveryRate : rates.bounceRate;
      if (v !== null) values.push(v);
    }
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
}

/** Map a metric tone to a stat-tile delta tone (`neutral` bands stay muted). */
function toDeltaTone(tone: RateTone): StatTileDeltaTone {
  return tone === 'neutral' ? 'neutral' : tone;
}
