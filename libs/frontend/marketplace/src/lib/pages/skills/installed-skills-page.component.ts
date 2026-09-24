import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs';
import {
  LucideAngularModule,
  RefreshCw,
  Search,
  type LucideIconData,
} from 'lucide-angular';
import type { MarketplaceSkillSource } from '@ptah-extension/core';
import { NativeDrawerComponent } from '@ptah-extension/ui';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import { decodeSkillRef, type MarketplaceSkillKind } from '../../data/skill-ref';
import { MarketplaceLayout } from '../../layout/marketplace-layout';
import { marketplaceRouteLink } from '../../shell/marketplace-route-url';
import { DockedInspectorComponent } from '../../ui/docked-inspector.component';
import {
  SKILL_KIND_ICONS,
  SKILL_KIND_LABELS,
  filterInstalledSkillGroups,
  findInstalledSkill,
  installedSkillGroups,
  type InstalledSkillGroupId,
  type InstalledSkillRow,
  type InstalledSkillSlices,
} from './installed-skill-rows';
import { SkillsSectionHeaderComponent } from './skills-section-header.component';

/** The slices this page renders, in display order. */
const PAGE_SLICES: readonly InstalledSkillGroupId[] = [
  'plugins',
  'community',
  'marketplaces',
];

/** The route parameter of the detail child (plan D1). */
const SKILL_REF_PARAM = 'skillRef';

/** Frame title while the open ref names nothing on screen. */
const FALLBACK_DETAIL_HEADING = 'Skill details';

/** The keys that move the active row. */
const ROW_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/** Selector of every row's open link, in DOM order. */
const ROW_LINK_SELECTOR = '[data-testid="installed-skill-open"]';

/**
 * InstalledSkillsPageComponent — `/marketplace/skills` (plan C9
 * `InstalledSkillsPage`): every Ptah plugin, community skill and marketplace
 * plugin the user has, as three grouped lists.
 *
 * ## Data
 *
 * Ensures exactly the `plugins`, `community` and `marketplaces` slices. Each
 * group renders its own loading, error (with Retry) and empty state, so one
 * failed read never hides the other two lists. The section header's harness
 * badge adds its own cached `harness:health` read (it stays on this page: the
 * Overview's harness "Review" link lands here).
 *
 * ## Detail placement (the Task 13.1 rule)
 *
 * Opening a row navigates to the `:skillRef` child. Whether the detail is
 * open is read from ROUTER STATE (the active child's parameter), never from
 * outlet events, so the selection survives a tier flip and a reload of the
 * list. At wide the detail docks beside the list in a
 * {@link DockedInspectorComponent}, which never takes focus; below wide it is
 * a modal {@link NativeDrawerComponent}, which traps focus and restores it on
 * close. Closing navigates back to this page.
 *
 * ## Keyboard
 *
 * ↑/↓ (and Home/End) move between rows with a roving tab stop, Enter opens the
 * focused row (native link activation), Esc closes the docked detail and puts
 * focus back on its row; the drawer handles its own Esc. `/` is the shell's.
 */
@Component({
  selector: 'ptah-installed-skills-page',
  standalone: true,
  imports: [
    RouterLink,
    RouterOutlet,
    LucideAngularModule,
    NativeDrawerComponent,
    DockedInspectorComponent,
    SkillsSectionHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex h-full min-h-0 min-w-0',
    'data-testid': 'installed-skills-page',
    '(keydown)': 'onHostKeydown($event)',
  },
  template: `
    <div class="min-w-0 flex-1 overflow-y-auto p-4">
      <div class="space-y-4">
        <header class="flex flex-wrap items-start gap-3">
          <div class="min-w-0 flex-1">
            <h1 class="text-lg font-semibold text-base-content">
              Skills &amp; Plugins
            </h1>
            <p class="mt-1 text-sm text-base-content-muted">
              Everything installed or enabled for this workspace. The harness
              copies it to each CLI you use.
            </p>
          </div>
          <ptah-skills-section-header />
        </header>

        <label
          class="input input-sm input-bordered flex w-full max-w-sm items-center gap-2"
        >
          <lucide-angular
            [img]="SearchIcon"
            class="h-4 w-4 shrink-0 text-base-content-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            class="min-w-0 grow"
            placeholder="Search installed skills"
            aria-label="Search installed skills"
            data-testid="installed-skills-search"
            [value]="query()"
            (input)="onSearch($event)"
          />
        </label>

        <div class="space-y-4" (keydown)="onListKeydown($event)">
          @for (group of groups(); track group.id) {
            <section
              class="rounded-xl border border-base-300 bg-base-200"
              data-testid="installed-skills-group"
              [attr.data-group]="group.id"
              [attr.aria-labelledby]="'installed-skills-heading-' + group.id"
              [attr.aria-busy]="group.state === 'loading'"
            >
              <header
                class="flex items-center gap-2 border-b border-base-300 px-4 py-3"
              >
                <h2
                  class="text-sm font-semibold text-base-content"
                  [id]="'installed-skills-heading-' + group.id"
                >
                  {{ group.label }}
                </h2>
                @if (group.state === 'ready') {
                  <span
                    class="badge badge-ghost badge-sm tabular-nums"
                    data-testid="installed-skills-count"
                    >{{ group.total }}</span
                  >
                }
                <a
                  class="btn btn-ghost btn-xs ml-auto"
                  [routerLink]="sourceLink(group.browse.source)"
                  [attr.aria-label]="group.browse.label"
                  >Browse</a
                >
              </header>

              @if (group.actionError ?? pageErrors()[group.id]; as message) {
                <p
                  class="mx-4 mt-3 text-xs text-error"
                  role="alert"
                  data-testid="installed-skills-action-error"
                >
                  {{ message }}
                </p>
              }

              @if (group.state === 'error') {
                <div class="flex items-start gap-3 px-4 py-4">
                  <p
                    class="flex-1 text-xs text-error"
                    role="alert"
                    data-testid="installed-skills-error"
                  >
                    {{ group.error ?? 'Could not read this list.' }}
                  </p>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs gap-1"
                    data-testid="installed-skills-retry"
                    (click)="retry(group.id)"
                  >
                    <lucide-angular
                      [img]="RefreshIcon"
                      class="h-3 w-3"
                      aria-hidden="true"
                    />
                    Retry
                  </button>
                </div>
              } @else if (group.rows.length === 0 && group.state !== 'ready') {
                <div
                  class="space-y-2 px-4 py-4"
                  data-testid="installed-skills-loading"
                >
                  <span class="sr-only">Loading {{ group.label }}…</span>
                  @for (line of skeletonLines; track line) {
                    <div
                      class="flex items-center gap-3"
                      aria-hidden="true"
                    >
                      <div class="skeleton h-8 w-8 shrink-0 rounded-lg"></div>
                      <div class="flex-1 space-y-1.5">
                        <div class="skeleton h-3 w-2/5"></div>
                        <div class="skeleton h-2.5 w-1/4"></div>
                      </div>
                    </div>
                  }
                </div>
              } @else if (group.total === 0) {
                <div
                  class="px-4 py-5 text-center"
                  data-testid="installed-skills-empty"
                >
                  <p class="mb-2 text-xs text-base-content-muted">
                    Nothing installed yet.
                  </p>
                  <a
                    class="btn btn-primary btn-xs"
                    [routerLink]="sourceLink(group.browse.source)"
                    >{{ group.browse.label }}</a
                  >
                </div>
              } @else if (group.rows.length === 0) {
                <p
                  class="px-4 py-4 text-xs text-base-content-muted"
                  data-testid="installed-skills-no-match"
                >
                  No {{ group.label.toLowerCase() }} match “{{ query() }}”.
                </p>
              } @else {
                <ul class="divide-y divide-base-300" role="list">
                  @for (row of group.rows; track row.ref) {
                    <li
                      class="flex items-center gap-3 px-4 py-2.5"
                      [class.bg-base-300]="row.ref === openRef()"
                      data-testid="installed-skill-row"
                      [attr.data-ref]="row.ref"
                    >
                      <span
                        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-base-300 bg-base-100"
                        aria-hidden="true"
                      >
                        <lucide-angular
                          [img]="kindIcon(row.kind)"
                          class="h-4 w-4 text-base-content-muted"
                        />
                      </span>
                      <a
                        class="min-w-0 flex-1 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        data-testid="installed-skill-open"
                        [attr.data-ref]="row.ref"
                        [routerLink]="detailLinks().get(row.ref)"
                        [attr.tabindex]="row.ref === rovingRef() ? 0 : -1"
                        [attr.aria-current]="
                          row.ref === openRef() ? 'true' : null
                        "
                        [attr.aria-label]="rowLabel(row)"
                        (focus)="activeRef.set(row.ref)"
                      >
                        <span class="flex min-w-0 items-center gap-2">
                          <span
                            class="truncate text-sm font-medium text-base-content"
                            data-testid="installed-skill-name"
                            >{{ row.name }}</span
                          >
                          @if (row.version; as version) {
                            <span
                              class="shrink-0 text-xs tabular-nums text-base-content-muted"
                              data-testid="installed-skill-version"
                              >v{{ version }}</span
                            >
                          }
                        </span>
                        <span
                          class="block truncate text-xs text-base-content-muted"
                        >
                          {{ row.source
                          }}{{ row.detail ? ' · ' + row.detail : '' }}
                        </span>
                      </a>
                      @if (row.action === 'manage') {
                        <a
                          class="btn btn-ghost btn-xs shrink-0"
                          data-testid="installed-skill-manage"
                          [routerLink]="pluginsLink"
                          [attr.aria-label]="'Manage ' + row.name"
                          >Manage</a
                        >
                      } @else {
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs shrink-0 text-error"
                          data-testid="installed-skill-uninstall"
                          [disabled]="pendingIds().has(row.ref)"
                          [attr.aria-label]="'Uninstall ' + row.name"
                          (click)="uninstall(row)"
                        >
                          {{
                            pendingIds().has(row.ref)
                              ? 'Removing…'
                              : 'Uninstall'
                          }}
                        </button>
                      }
                    </li>
                  }
                </ul>
              }
            </section>
          }
        </div>
      </div>
    </div>

    @if (openRef() !== null) {
      @if (docked()) {
        <ptah-docked-inspector
          class="w-[400px] shrink-0"
          [heading]="detailHeading()"
          (closed)="close()"
        >
          <router-outlet />
        </ptah-docked-inspector>
      } @else {
        <ptah-native-drawer
          [isOpen]="true"
          widthClass="w-full max-w-md"
          [ariaLabel]="detailHeading()"
          (closed)="close()"
        >
          <h2
            drawer-header
            class="truncate text-sm font-semibold text-base-content"
            data-testid="skill-drawer-heading"
          >
            {{ detailHeading() }}
          </h2>
          <router-outlet />
        </ptah-native-drawer>
      }
    }
  `,
})
export class InstalledSkillsPageComponent {
  private readonly inventory = inject(MarketplaceInventoryStore);
  private readonly layout = inject(MarketplaceLayout);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly SearchIcon = Search;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly skeletonLines = [0, 1, 2] as const;

  private readonly skillsLink = marketplaceRouteLink({ page: 'skills' });

  protected readonly pluginsLink = marketplaceRouteLink({
    page: 'skills',
    source: 'ptah-plugins',
  });

  protected readonly pendingIds = this.inventory.pendingIds;

  /** The search text; page-local, kept while a detail is open. */
  protected readonly query = signal('');

  /**
   * Removal failures the page detects before any store call (a row whose
   * record is already gone), shown in the same inline alert as the store's
   * `actionError`, which takes precedence.
   */
  protected readonly pageErrors = signal<
    Partial<Record<InstalledSkillGroupId, string>>
  >({});

  /** The row that last had focus; the roving tab stop follows it. */
  protected readonly activeRef = signal<string | null>(null);

  private readonly slices = computed<InstalledSkillSlices>(() => ({
    plugins: this.inventory.plugins(),
    community: this.inventory.community(),
    marketplaces: this.inventory.marketplaces(),
  }));

  protected readonly groups = computed(() =>
    filterInstalledSkillGroups(installedSkillGroups(this.slices()), this.query()),
  );

  private readonly visibleRows = computed(() =>
    this.groups().flatMap((group) =>
      group.state === 'error' ? [] : group.rows,
    ),
  );

  /**
   * Absolute link commands per row. The ref must NOT be the first command:
   * the router splits a leading string on `/`, which would break an external
   * id (`external:<owner>/<repo>/<plugin>`) into several segments. As a later
   * command it stays one segment and the router percent-encodes its slashes
   * (R6).
   */
  protected readonly detailLinks = computed(
    () =>
      new Map(
        this.visibleRows().map((row) => [
          row.ref,
          [...this.skillsLink, row.ref],
        ]),
      ),
  );

  private readonly childRef = signal<string | null>(this.readChildRef());

  /** The raw `:skillRef` of the open detail, or `null` when none is open. */
  protected readonly openRef = this.childRef.asReadonly();

  /** Docked inspector at wide, modal drawer below. */
  protected readonly docked = computed(() => this.layout.tier() === 'wide');

  /** The frame title: the open item's name once it resolves. */
  protected readonly detailHeading = computed(() => {
    const ref = decodeSkillRef(this.openRef());
    if (ref === null) return FALLBACK_DETAIL_HEADING;
    return findInstalledSkill(ref, this.slices())?.row.name ?? FALLBACK_DETAIL_HEADING;
  });

  /**
   * The one row reachable with Tab: the last focused row, else the open one,
   * else the first. Falls through when that row is filtered out or removed.
   */
  protected readonly rovingRef = computed(() => {
    const refs = this.visibleRows().map((row) => row.ref);
    const active = this.activeRef();
    if (active !== null && refs.includes(active)) return active;
    const open = this.openRef();
    if (open !== null && refs.includes(open)) return open;
    return refs[0] ?? null;
  });

  private destroyed = false;

  public constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.childRef.set(this.readChildRef()));

    for (const slice of PAGE_SLICES) {
      void this.inventory.ensure(slice);
    }
  }

  protected kindIcon(kind: MarketplaceSkillKind): LucideIconData {
    return SKILL_KIND_ICONS[kind];
  }

  protected rowLabel(row: InstalledSkillRow): string {
    const version = row.version ? ` ${row.version}` : '';
    return `${row.name}${version}, ${SKILL_KIND_LABELS[row.kind]} from ${row.source}`;
  }

  protected sourceLink(source: MarketplaceSkillSource): string[] {
    return marketplaceRouteLink({ page: 'skills', source });
  }

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected retry(slice: InstalledSkillGroupId): void {
    void this.inventory.retry(slice);
  }

  /**
   * Uninstall a community skill or marketplace plugin. A failure is shown as
   * the group's inline `actionError` by the store; a success reloads the list,
   * and closes the detail if it was showing the removed item.
   */
  protected uninstall(row: InstalledSkillRow): void {
    void this.runUninstall(row);
  }

  private async runUninstall(row: InstalledSkillRow): Promise<void> {
    this.setPageError('community', null);
    this.setPageError('marketplaces', null);
    let removed = false;
    if (row.kind === 'community-skill') {
      removed =
        (await this.inventory.removeCommunitySkill(row.id)).status ===
        'removed';
    } else if (row.kind === 'marketplace-plugin') {
      const listing = this.inventory
        .marketplaces()
        .data.find((item) => item.id === row.id);
      if (listing === undefined) {
        // The row outlived its record (a reload landed between render and
        // click). Say so where removal failures appear, and re-read the list
        // so the row itself goes away.
        this.setPageError(
          'marketplaces',
          `"${row.name}" is no longer installed. The list has been refreshed.`,
        );
        void this.inventory.reload('marketplaces');
        return;
      }
      removed =
        (await this.inventory.removeMarketplacePlugin(listing)).status ===
        'removed';
    }
    if (removed && !this.destroyed && this.openRef() === row.ref) {
      await this.close();
    }
  }

  private setPageError(
    group: InstalledSkillGroupId,
    message: string | null,
  ): void {
    this.pageErrors.update((current) => {
      const next = { ...current };
      if (message === null) delete next[group];
      else next[group] = message;
      return next;
    });
  }

  /** Close the detail: back to this page's own route. */
  protected async close(): Promise<void> {
    const closing = this.openRef();
    const wasDocked = this.docked();
    await this.router.navigate(['.'], { relativeTo: this.route });
    // The drawer restores focus itself; the docked pane never took it, so
    // put the user back on the row they were reading — or, when that row is
    // gone (the item was just uninstalled), on the search field, the first
    // control of the list.
    if (wasDocked && closing !== null && !this.destroyed) {
      (this.rowLink(closing) ?? this.searchInput())?.focus();
    }
  }

  private searchInput(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(
      'input[type="search"]',
    );
  }

  /** Esc closes the docked detail. The drawer consumes its own Esc first. */
  protected onHostKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (this.openRef() === null || !this.docked()) return;
    event.preventDefault();
    void this.close();
  }

  /** ↑/↓/Home/End move focus between rows, from a row link or its action. */
  protected onListKeydown(event: KeyboardEvent): void {
    if (!ROW_KEYS.has(event.key) || event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const links = this.rowLinks();
    if (links.length === 0) return;

    const row = (event.target as HTMLElement | null)?.closest?.(
      '[data-testid="installed-skill-row"]',
    );
    if (!row) return;
    const current = links.findIndex(
      (link) => link.dataset['ref'] === (row as HTMLElement).dataset['ref'],
    );

    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = Math.min(links.length - 1, current + 1);
        break;
      case 'ArrowUp':
        next = Math.max(0, current - 1);
        break;
      case 'Home':
        next = 0;
        break;
      default:
        next = links.length - 1;
    }
    event.preventDefault();
    const target = links[next];
    this.activeRef.set(target.dataset['ref'] ?? null);
    target.focus();
  }

  private rowLinks(): HTMLElement[] {
    return Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(ROW_LINK_SELECTOR),
    );
  }

  private rowLink(ref: string): HTMLElement | undefined {
    return this.rowLinks().find((link) => link.dataset['ref'] === ref);
  }

  private readChildRef(): string | null {
    return this.route.firstChild?.snapshot.paramMap.get(SKILL_REF_PARAM) ?? null;
  }
}
