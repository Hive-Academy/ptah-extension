import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  Activity,
  CircleAlert,
  LucideAngularModule,
  Network,
  Plug,
  Plus,
  Puzzle,
  RefreshCw,
} from 'lucide-angular';

import { needsAttention } from '../../data/attention';
import { ConnectorLinksStore } from '../../data/connector-links.store';
import { buildCoverageMatrix } from '../../data/coverage';
import { injectProviderRows } from '../../data/installed-provider-rows';
import {
  MarketplaceInventoryStore,
  type InventorySliceId,
} from '../../data/marketplace-inventory.store';
import { harnessChipPresentation } from '../../harness/harness-chip-presentation';
import { HarnessHealthStore } from '../../harness/harness-health.store';
import { MarketplaceLayout } from '../../layout/marketplace-layout';
import { marketplaceRouteLink } from '../../shell/marketplace-route-url';
import { CoverageMatrixComponent } from '../../ui/coverage-matrix.component';
import { NeedsAttentionComponent } from '../../ui/needs-attention.component';
import { StatCardComponent } from '../../ui/stat-card.component';
import { TargetMarksComponent } from '../../ui/target-marks.component';
// Shared with the Installed servers page: both show the same "live" figure.
import { liveInLastSession } from '../servers/installed-servers-page.component';
import { ProviderListViewComponent } from '../servers/provider-list-view.component';
import {
  combinedWidgetState,
  connectorsKpi,
  harnessChips,
  harnessKpi,
  harnessStaleError,
  harnessWidgetState,
  serversKpi,
  skillsErrorText,
  skillsKpi,
  widgetStateOf,
} from './overview-kpis';

/** Every inventory slice the Overview reads (plan C7, performance list). */
const OVERVIEW_SLICES: readonly InventorySliceId[] = [
  'installed',
  'plugins',
  'community',
  'marketplaces',
];

/** The slices behind the Skills & plugins card, with the name an error uses. */
const SKILL_SLICES = [
  { id: 'plugins', label: 'Ptah plugins' },
  { id: 'community', label: 'Community skills' },
  { id: 'marketplaces', label: 'Marketplace plugins' },
] as const satisfies readonly {
  readonly id: InventorySliceId;
  readonly label: string;
}[];

/**
 * OverviewPageComponent — `/marketplace/overview` (plan C7 `OverviewPage`).
 *
 * The dashboard: a header (the page's one `<h1>`, Refresh, "Add connection"),
 * four KPI cards, the needs-attention panel and the coverage matrix (regular
 * and wide only), and the installed-servers list reused from the Installed
 * page (not grouped by origin; its search field is the page's `/` target and
 * it owns ↑/↓/Enter/Esc).
 *
 * ## Data (plan R5: exactly these reads)
 *
 * On mount it ensures the four inventory slices (`listInstalled`, the plugin
 * catalogue, `skillsSh:listInstalled`, `plugins:list-marketplaces`), the
 * connector links (`listOAuthConnected`, `oauthStatus` per record,
 * `listSmitheryConnections`) and, only when no report is held yet, the cached
 * `harness:health`. Nothing else loads here.
 *
 * ## Failure isolation
 *
 * Each widget reads its own source's state: a failed slice puts only the
 * widgets built on it into their error state, with a Retry that re-reads that
 * source alone, and every other widget keeps rendering.
 *
 * Session-derived figures (connector rows, "N live in last session") come only
 * from the newest session OF THE ACTIVE WORKSPACE (plan Revision 3), through
 * the store's `newestSessionStatus`.
 */
@Component({
  selector: 'ptah-overview-page',
  standalone: true,
  imports: [
    RouterLink,
    LucideAngularModule,
    StatCardComponent,
    TargetMarksComponent,
    NeedsAttentionComponent,
    CoverageMatrixComponent,
    ProviderListViewComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block',
    'data-testid': 'overview-page',
    '[attr.data-tier]': 'tier()',
  },
  templateUrl: './overview-page.component.html',
  styles: `
    .ptah-overview__kpis {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 0.75rem;
    }

    @container ptah-mp-content (width >= 480px) {
      .ptah-overview__kpis {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @container ptah-mp-content (width >= 960px) {
      .ptah-overview__kpis {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }
  `,
})
export class OverviewPageComponent {
  private readonly inventory = inject(MarketplaceInventoryStore);
  private readonly links = inject(ConnectorLinksStore);
  private readonly harness = inject(HarnessHealthStore);
  private readonly layout = inject(MarketplaceLayout);
  private readonly rows = injectProviderRows();

  protected readonly RefreshIcon = RefreshCw;
  protected readonly AlertIcon = CircleAlert;
  protected readonly AddIcon = Plus;
  protected readonly ServersIcon = Network;
  protected readonly ConnectorsIcon = Plug;
  protected readonly SkillsIcon = Puzzle;
  protected readonly HarnessIcon = Activity;

  protected readonly connectorsLink = marketplaceRouteLink({
    page: 'connectors',
  });

  protected readonly tier = this.layout.tier;

  /** Needs attention and the coverage matrix need room: regular and wide. */
  protected readonly showInsights = computed(() => this.tier() !== 'compact');

  // ── Apps & MCP servers ─────────────────────────────────────────────────────

  protected readonly installedState = computed(() =>
    widgetStateOf(this.inventory.installed().state),
  );
  protected readonly installedError = computed(
    () => this.inventory.installed().error ?? null,
  );
  /** The live figure only while a session of the active workspace reported. */
  protected readonly serversFigure = computed(() => {
    const rows = this.rows();
    const live =
      this.inventory.newestSessionStatus() === null
        ? null
        : liveInLastSession(rows);
    return serversKpi(rows, live);
  });
  protected readonly serverCount = computed(() => this.rows().length);

  // ── Connectors ─────────────────────────────────────────────────────────────

  protected readonly connectorsState = computed(() =>
    widgetStateOf(this.links.state()),
  );
  protected readonly connectorsError = this.links.loadError;
  protected readonly connectorsFigure = computed(() =>
    connectorsKpi(this.links.links()),
  );

  // ── Skills & plugins ───────────────────────────────────────────────────────

  private readonly skillSlices = computed(() =>
    SKILL_SLICES.map(({ id, label }) => ({
      label,
      slice: this.inventory[id](),
    })),
  );
  protected readonly skillsState = computed(() =>
    combinedWidgetState(this.skillSlices().map(({ slice }) => slice.state)),
  );
  /** Every failed source, labelled — not only the first. */
  protected readonly skillsError = computed(() =>
    skillsErrorText(
      this.skillSlices()
        .filter(({ slice }) => slice.state === 'error')
        .map(({ label, slice }) => ({ label, error: slice.error })),
    ),
  );
  protected readonly skillsFigure = computed(() =>
    skillsKpi({
      ptah: this.inventory.plugins().data.length,
      community: this.inventory.community().data.length,
      marketplace: this.inventory.marketplaces().data.length,
    }),
  );

  // ── Harness health ─────────────────────────────────────────────────────────

  protected readonly harnessState = computed(() =>
    harnessWidgetState(
      this.harness.health(),
      this.harness.loading(),
      this.harness.error(),
    ),
  );
  protected readonly harnessError = this.harness.error;
  /** A failed call while an older report is shown: kept figures + this line. */
  protected readonly harnessStale = computed(() =>
    harnessStaleError(this.harness.health(), this.harness.error()),
  );
  protected readonly harnessFigure = computed(() =>
    harnessKpi(this.harness.health()),
  );
  /** Per-CLI chips: the mark item, the label and the state's word and icon. */
  protected readonly harnessChipViews = computed(() =>
    harnessChips(this.harness.health()).map((chip) => ({
      chip,
      marks: [{ target: chip.target, label: chip.label }],
      presentation: harnessChipPresentation(chip.state),
    })),
  );

  // ── Needs attention and coverage ───────────────────────────────────────────

  protected readonly attentionItems = computed(() => {
    const health = this.harness.health();
    return needsAttention({
      rows: this.rows(),
      harness:
        health === null
          ? null
          : { summary: this.harness.summary(), targets: health.targets },
      smitheryConnections: this.links.smitheryConnections(),
      sessionServers: this.inventory.newestSessionStatus()?.servers ?? [],
    });
  });

  protected readonly coverage = computed(() =>
    buildCoverageMatrix(this.rows(), this.harness.targets()),
  );

  public constructor() {
    for (const id of OVERVIEW_SLICES) void this.inventory.ensure(id);
    void this.links.ensure();
    if (this.harness.health() === null) void this.harness.refresh();
  }

  /** Re-read everything this page shows. The harness read stays the cached one. */
  protected refresh(): void {
    for (const id of OVERVIEW_SLICES) void this.inventory.reload(id);
    void this.links.reload();
    void this.harness.refresh();
  }

  protected retryInstalled(): void {
    void this.inventory.retry('installed');
  }

  protected retryConnectors(): void {
    void this.links.reload();
  }

  /** Only the failed slices re-read (`retry` is a no-op for the others). */
  protected retrySkills(): void {
    for (const { id } of SKILL_SLICES) void this.inventory.retry(id);
  }

  protected retryHarness(): void {
    void this.harness.refresh();
  }
}
