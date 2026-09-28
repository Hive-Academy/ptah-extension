import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  RouterLink,
  RouterLinkActive,
  type IsActiveMatchOptions,
} from '@angular/router';
import {
  Database,
  LayoutGrid,
  Link,
  LucideAngularModule,
  Package,
  Plug,
  Puzzle,
  Server,
  Sparkles,
  Store,
  Users,
  type LucideIconData,
} from 'lucide-angular';
import {
  marketplaceRouteCommands,
  type MarketplaceRoute,
} from '@ptah-extension/core';
import {
  injectMarketplaceNavCounts,
  type MarketplaceNavCountKey,
} from './marketplace-nav-counts';
import { marketplaceRouteLink } from './marketplace-route-url';

/** One destination in the Marketplace nav. */
export interface MarketplaceNavItem {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIconData;
  readonly route: MarketplaceRoute;
  /** Present on the pages that list what the user has; absent on catalogues. */
  readonly countKey?: MarketplaceNavCountKey;
}

/** A labelled group of nav items. */
export interface MarketplaceNavGroup {
  readonly id: 'marketplace' | 'sources';
  readonly label: string;
  readonly items: readonly MarketplaceNavItem[];
}

/**
 * The two nav groups (plan C6). The Marketplace group lists what the user HAS;
 * the Sources group lists where more comes from.
 */
export const MARKETPLACE_NAV_GROUPS: readonly MarketplaceNavGroup[] = [
  {
    id: 'marketplace',
    label: 'Marketplace',
    items: [
      {
        id: 'overview',
        label: 'Overview',
        icon: LayoutGrid,
        route: { page: 'overview' },
      },
      {
        id: 'connectors',
        label: 'Connectors',
        icon: Plug,
        route: { page: 'connectors' },
        countKey: 'connectors',
      },
      {
        id: 'servers',
        label: 'MCP Servers',
        icon: Server,
        route: { page: 'servers' },
        countKey: 'servers',
      },
      {
        id: 'skills',
        label: 'Skills & Plugins',
        icon: Puzzle,
        route: { page: 'skills' },
        countKey: 'skills',
      },
    ],
  },
  {
    id: 'sources',
    label: 'Sources',
    items: [
      {
        id: 'smithery',
        label: 'Smithery',
        icon: Package,
        route: { page: 'servers', source: 'smithery' },
      },
      {
        id: 'registry',
        label: 'MCP Registry',
        icon: Database,
        route: { page: 'servers', source: 'registry' },
      },
      {
        id: 'custom-url',
        label: 'Custom URL',
        icon: Link,
        route: { page: 'servers', source: 'custom-url' },
      },
      {
        id: 'ptah-plugins',
        label: 'Ptah Plugins',
        icon: Sparkles,
        route: { page: 'skills', source: 'ptah-plugins' },
      },
      {
        id: 'community',
        label: 'Community',
        icon: Users,
        route: { page: 'skills', source: 'community' },
      },
      {
        id: 'marketplaces',
        label: 'Marketplaces',
        icon: Store,
        route: { page: 'skills', source: 'marketplaces' },
      },
    ],
  },
];

/** True for a source page (`servers/<source>`, `skills/<source>`). */
function isSourceRoute(route: MarketplaceRoute | null): boolean {
  return (
    route !== null &&
    (route.page === 'servers' || route.page === 'skills') &&
    route.source !== undefined
  );
}

function sameRoute(a: MarketplaceRoute, b: MarketplaceRoute): boolean {
  return (
    marketplaceRouteCommands(a).join('/') ===
    marketplaceRouteCommands(b).join('/')
  );
}

/**
 * The page name the shell breadcrumb shows: the nav label of the page `route`
 * addresses, or `null` when no Marketplace page is settled yet.
 */
export function marketplacePageLabel(
  route: MarketplaceRoute | null,
): string | null {
  if (route === null) return null;
  for (const group of MARKETPLACE_NAV_GROUPS) {
    const item = group.items.find((candidate) =>
      sameRoute(candidate.route, route),
    );
    if (item) return item.label;
  }
  return null;
}

/** `routerLinkActive` matching: a page stays active under its detail routes. */
const SUBSET_MATCH: IsActiveMatchOptions = {
  paths: 'subset',
  queryParams: 'ignored',
  fragment: 'ignored',
  matrixParams: 'ignored',
};

/** Used by an installed list while one of its own SOURCE pages is current. */
const EXACT_MATCH: IsActiveMatchOptions = {
  paths: 'exact',
  queryParams: 'ignored',
  fragment: 'ignored',
  matrixParams: 'ignored',
};

/**
 * MarketplaceNavComponent — the Marketplace's persistent navigation (plan C6).
 *
 * Two presentations, picked by the shell from the layout tier:
 *
 * - `compact` — a 56px icon rail. Every item carries `aria-label` and `title`,
 *   because the label is not visible.
 * - otherwise — a 240px sidebar with labels and counts.
 *
 * Items are plain `routerLink`s: the router owns location (plan D1), and
 * `routerLinkActive` with `ariaCurrentWhenActive="page"` marks the current one.
 *
 * ## One current item
 *
 * URL-subset matching keeps "MCP Servers" active on `servers/<serverRef>` (a
 * detail of the installed list), but would ALSO light it on
 * `servers/smithery`, where "Smithery" is the current page. While a source page
 * is current, the two installed-list items switch to exact matching, so
 * exactly one item carries `aria-current="page"`.
 *
 * ## Counts never load
 *
 * Counts come from {@link injectMarketplaceNavCounts}, which reads only slices
 * that are already `ready`. Before any page has loaded anything the nav renders
 * without counts.
 */
@Component({
  selector: 'ptah-marketplace-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full shrink-0',
  },
  styles: `
    .mp-nav {
      transition: width 150ms ease-out;
    }
    @media (prefers-reduced-motion: reduce) {
      .mp-nav {
        transition: none;
      }
    }
  `,
  template: `
    <nav
      aria-label="Marketplace"
      data-testid="marketplace-nav"
      class="mp-nav h-full overflow-y-auto overflow-x-hidden border-r border-base-300 bg-base-100"
      [class.w-14]="compact()"
      [class.w-60]="!compact()"
      [attr.data-variant]="compact() ? 'rail' : 'sidebar'"
    >
      @for (group of groups; track group.id; let first = $first) {
        @if (!first) {
          <div
            class="mx-2 my-2 border-t border-base-300"
            aria-hidden="true"
          ></div>
        }
        @if (!compact()) {
          <p
            [id]="'mp-nav-group-' + group.id"
            class="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-base-content-muted"
          >
            {{ group.label }}
          </p>
        }
        <ul
          class="flex flex-col gap-0.5 px-2"
          [class.pt-2]="compact()"
          [attr.aria-labelledby]="compact() ? null : 'mp-nav-group-' + group.id"
          [attr.aria-label]="compact() ? group.label : null"
        >
          @for (item of group.items; track item.id) {
            @let count = countOf(item);
            <li>
              <a
                [routerLink]="item.link"
                routerLinkActive="bg-primary/10 text-primary font-medium"
                [routerLinkActiveOptions]="matchOptionsOf(item)"
                ariaCurrentWhenActive="page"
                [attr.data-nav-id]="item.id"
                [attr.aria-label]="compact() ? item.label : null"
                [attr.title]="compact() ? item.label : null"
                class="flex h-9 items-center gap-2.5 rounded-md text-sm transition-colors duration-150 hover:bg-base-200 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                [class.justify-center]="compact()"
                [class.px-3]="!compact()"
              >
                <lucide-angular
                  [img]="item.icon"
                  class="h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                @if (!compact()) {
                  <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
                  @if (count !== null) {
                    <span
                      class="badge badge-ghost badge-sm tabular-nums"
                      data-testid="marketplace-nav-count"
                    >
                      {{ count }}
                    </span>
                  }
                }
              </a>
            </li>
          }
        </ul>
      }
    </nav>
  `,
})
export class MarketplaceNavComponent {
  /** Rail (true) or sidebar (false). The shell derives it from the tier. */
  public readonly compact = input.required<boolean>();

  /** The settled Marketplace page, for the one-current-item rule. */
  public readonly route = input<MarketplaceRoute | null>(null);

  /** The groups with each item's router commands built once. */
  protected readonly groups = MARKETPLACE_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      link: marketplaceRouteLink(item.route),
    })),
  }));

  private readonly counts = injectMarketplaceNavCounts();

  /**
   * Subset matching everywhere, except an installed list (a `servers` or
   * `skills` item without a source) while a source page is current.
   */
  protected matchOptionsOf(item: MarketplaceNavItem): IsActiveMatchOptions {
    const isInstalledList =
      (item.route.page === 'servers' || item.route.page === 'skills') &&
      item.route.source === undefined;
    return isInstalledList && isSourceRoute(this.route())
      ? EXACT_MATCH
      : SUBSET_MATCH;
  }

  /** The badge value; `null` hides the badge (a count of 0 still shows). */
  protected countOf(item: MarketplaceNavItem): number | null {
    return item.countKey === undefined ? null : this.counts()[item.countKey];
  }
}
