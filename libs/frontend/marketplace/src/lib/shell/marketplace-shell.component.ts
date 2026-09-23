import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs';
import { ArrowLeft, LucideAngularModule, Store } from 'lucide-angular';
import {
  AppStateManager,
  VSCodeService,
  type MarketplaceRoute,
} from '@ptah-extension/core';
import { MarketplaceInventoryStore } from '../data/marketplace-inventory.store';
import { ConnectorLinksStore } from '../data/connector-links.store';
import { MarketplaceLayout } from '../layout/marketplace-layout';
import {
  MarketplaceNavComponent,
  marketplacePageLabel,
} from './marketplace-nav.component';
import {
  marketplaceRouteLink,
  marketplaceRouteOfUrl,
} from './marketplace-route-url';
import { MarketplaceStatusBarComponent } from './marketplace-status-bar.component';

/**
 * The element `/` focuses: the first search field of the active page.
 *
 * A page opts in by rendering its search as `<input type="search">` (or a
 * `role="searchbox"` element), which it should do anyway for its accessible
 * role, so no marketplace-specific marker is needed.
 */
const PAGE_SEARCH_SELECTOR =
  'input[type="search"]:not([disabled]), [role="searchbox"]:not([aria-disabled="true"])';

/**
 * True when a keystroke belongs to a field the user is typing into, so `/`
 * must stay a character: any input, textarea or select, and any element inside
 * a contenteditable region.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  if (target.isContentEditable) return true;
  // jsdom and some hosts do not implement `isContentEditable`; the attribute
  // is the ground truth it is computed from.
  const editable = target.closest('[contenteditable]');
  return (
    editable !== null && editable.getAttribute('contenteditable') !== 'false'
  );
}

/**
 * MarketplaceShellComponent — the frame of every Marketplace page (plan C6).
 *
 * ## What it owns
 *
 * - **The shell-scoped stores.** `MarketplaceInventoryStore` and
 *   `ConnectorLinksStore` are provided HERE, so they live exactly as long as
 *   one Marketplace visit and every page under the outlet shares them (plan
 *   D4). Neither loads on construction; pages call `ensure()` for what they
 *   render, and the nav and status bar only read. Mounting the shell alone
 *   fires no RPC.
 * - **The layout tier.** `MarketplaceLayout` is provided with a factory (it is
 *   not `@Injectable`) and observes this host element, so every page reads one
 *   tier measured on the Marketplace's own box, not the window (plan D3).
 * - **Host chrome.** The header renders in BOTH hosts: the Marketplace mark and
 *   a breadcrumb `Marketplace / <page>`. The shell renders NO `<h1>`: every
 *   page renders its own single `<h1>`. The back-to-chat button renders only
 *   in VS Code; in Electron the surface is opened from the global
 *   configuration menu (TASK_2026_540), and the header stays one slim row.
 * - **The scroll owner.** `<main>` scrolls and is the `ptah-mp-content`
 *   inline-size container that cosmetic `@container` rules measure against.
 * - **Route memory.** Every settled navigation inside the Marketplace is
 *   recorded through `AppStateManager.rememberMarketplaceRoute` — after the
 *   router lands, never ahead of it (Batch 2: `openMarketplace` does not
 *   store the route).
 * - **Keyboard scope.** `/` focuses the active page's search field unless the
 *   user is typing in a field. The handler is on the host, never `document`,
 *   so it cannot steal keys from the chat panel beside the Marketplace.
 */
@Component({
  selector: 'ptah-marketplace-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    LucideAngularModule,
    MarketplaceNavComponent,
    MarketplaceStatusBarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    MarketplaceInventoryStore,
    ConnectorLinksStore,
    {
      provide: MarketplaceLayout,
      useFactory: () => new MarketplaceLayout(inject(DestroyRef)),
    },
  ],
  host: {
    class: 'block h-full w-full min-w-0 overflow-hidden',
    'data-testid': 'marketplace-shell',
    '[attr.data-tier]': 'tier()',
    '(keydown)': 'onKeyDown($event)',
  },
  styles: `
    .mp-content {
      container: ptah-mp-content / inline-size;
    }
  `,
  templateUrl: './marketplace-shell.component.html',
})
export class MarketplaceShellComponent {
  private readonly appState = inject(AppStateManager);
  private readonly vscode = inject(VSCodeService);
  private readonly router = inject(Router);
  private readonly layout = inject(MarketplaceLayout);

  protected readonly StoreIcon = Store;
  protected readonly ArrowLeftIcon = ArrowLeft;

  /**
   * The breadcrumb root crumb's target. Deliberately the Overview, not derived
   * from `route()`: a section-root crumb goes to the section's home page.
   */
  protected readonly overviewLink = marketplaceRouteLink({ page: 'overview' });

  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');

  /** The layout tier, measured on this host. */
  protected readonly tier = this.layout.tier;

  /** Rail at compact, sidebar at regular and wide. */
  protected readonly compact = computed(() => this.tier() === 'compact');

  /** VS Code gets a back-to-chat button; Electron has the global menu. */
  protected readonly showBack = computed(() => !this.vscode.isElectron);

  private readonly _route = signal<MarketplaceRoute | null>(
    marketplaceRouteOfUrl(this.router, this.router.url),
  );

  /** The settled Marketplace page, or `null` before one settles. */
  protected readonly route = this._route.asReadonly();

  /** The breadcrumb's last crumb, or `null` when only "Marketplace" shows. */
  protected readonly pageLabel = computed(() =>
    marketplacePageLabel(this.route()),
  );

  public constructor() {
    this.layout.observe(
      inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
    );

    // Subscribed during construction, which happens while the router is
    // activating this shell, so the NavigationEnd of the very navigation that
    // opened the Marketplace is recorded too.
    this.router.events
      .pipe(
        filter(
          (event): event is NavigationEnd => event instanceof NavigationEnd,
        ),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        const route = marketplaceRouteOfUrl(
          this.router,
          event.urlAfterRedirects,
        );
        this._route.set(route);
        if (route !== null) this.appState.rememberMarketplaceRoute(route);
      });
  }

  /** Back to chat — the hub's `goBack` behaviour, VS Code only. */
  public goBack(): void {
    this.appState.setCurrentView('chat');
  }

  /**
   * `/` focuses the active page's search field. Ignored with a modifier, when
   * something else already handled the key, while typing in a field, and when
   * the page has no search — in every one of those cases the key does what it
   * would have done without the Marketplace.
   */
  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key !== '/' || event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditableTarget(event.target)) return;

    const search = this.pageSearch();
    if (search === null) return;
    event.preventDefault();
    search.focus();
  }

  private pageSearch(): HTMLElement | null {
    const candidates =
      this.main().nativeElement.querySelectorAll<HTMLElement>(
        PAGE_SEARCH_SELECTOR,
      );
    for (const candidate of Array.from(candidates)) {
      if (candidate.closest('[hidden], [inert]') === null) return candidate;
    }
    return null;
  }
}
