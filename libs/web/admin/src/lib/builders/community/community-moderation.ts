import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MessagesSquare } from 'lucide-angular';

import { FIRST_PAGE, type Paged } from '@ptah-contracts/community';
import {
  DetailDrawer,
  EmptyState,
  SelectionToolbar,
  StatusBadge,
  TagChip,
  ThreadRow,
} from '@ptah-web/panel-ui';

import {
  AdminBuildersApiService,
  type AdminCategory,
  type AdminTopicSummary,
  type ModerateTopicRequest,
} from '../../services/admin-builders-api.service';

/**
 * CommunityModeration — `/admin/builders/community` (R8.2, R8.5, §3.3).
 *
 * ⚠️ THIS IS A NEW SURFACE, NOT A RESTORATION, AND THE DIFFERENCE IS WRITES.
 * The screen that used to live at this route (`community-view`, deleted whole
 * in TASK_2026_177 P1b, commit `fd1b4557e`) was a READ-ONLY triage list over the
 * EXTERNAL forum, reading `GET /v1/admin/community/{topics,review-queue}` — two
 * endpoints that no longer exist. Structural test G5 asserted that read-only
 * property and was deleted with it, deliberately, because the native surface
 * OWNS moderation: pin, lock, move, soft-delete and restore all happen here.
 * Do not restore G5, and do not treat this file as a port of the old one — it
 * shares no contract, no endpoint and no capability with it.
 *
 * ⚠️ IT READS THREE CONTROLLERS, NOT ONE. `…/community/categories`,
 * `…/community/topics` and `…/community/posts` are three DISJOINT LITERAL
 * prefixes at depth 4 (RISK-J: `route-map.spec.ts` RI-1 fails the build if one
 * controller prefix becomes a path-prefix of another's, and both
 * `PREFIX_EXCEPTIONS` and `KNOWN_PREFIX_DEBT` are empty arrays). There is
 * nothing mounted at the bare `…/community` prefix and there must not be.
 *
 * ⚠️ TOMBSTONES ARE INVISIBLE UNTIL ASKED FOR. Every read in the forum filters
 * `deletedAt IS NULL` (AD-5); `?includeDeleted=true` is the single declared
 * exemption and it is what this screen's "Show deleted" toggle sends. The rows
 * it adds carry `deletedAt` and `deletedBy`, which is what makes R8.5's ≥30-day
 * restore window judgeable — the window is measured from `deletedAt`, never
 * from `updatedAt`, so a later edit to a deleted row cannot extend it.
 *
 * ⚠️ IT REUSES `ThreadRow` FROM `@ptah-web/panel-ui`, AND THAT REUSE IS WHAT
 * LICENSES THE PROMOTION. §5.3's rule is that a primitive earns a place in that
 * lib when a SECOND panel actually renders it. The member feed is the first
 * consumer; this is the second. If this screen is ever deleted, `ThreadRow` and
 * `TagChip` go back to being private to `libs/web/members` rather than staying
 * behind as a speculative extraction.
 *
 * ⚠️ THE ADMIN PANEL IS `operator-admin`, NOT A MEMBER THEME. Nothing here
 * imports `MemberThemeService` or reads `ptah.members.theme` — that key has
 * exactly one writer (AD-13). `libs/web/admin` also sits OUTSIDE the Task 4.7
 * NFR-U2 lint rule's `libs/web/members/**` scope, so token discipline in this
 * file is manual; `docs/design-system/panel-theme-spec.md` is still the
 * authority and `base-300` is a fill, never a border.
 *
 * ⚠️ NO MARKDOWN IS RENDERED ON THIS SCREEN. An operator triages titles,
 * authors and state; a post body reaches them through the member thread view.
 * Rendering member-authored markdown on an admin surface would put a second
 * consumer on the `'member'` preset that NFR-S2's chokepoint spec — which is
 * scoped to `libs/web/members` — does not police.
 */
@Component({
  selector: 'ptah-admin-community-moderation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DetailDrawer,
    EmptyState,
    SelectionToolbar,
    StatusBadge,
    TagChip,
    ThreadRow,
  ],
  templateUrl: './community-moderation.html',
})
export class CommunityModeration {
  private readonly api = inject(AdminBuildersApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly MessagesSquareIcon = MessagesSquare;
  protected readonly firstPage = FIRST_PAGE;

  protected readonly categories = signal<readonly AdminCategory[]>([]);
  private readonly _page = signal<Paged<AdminTopicSummary> | null>(null);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  /** Set while a write is in flight, so the row's controls disable. */
  protected readonly busyId = signal<string | null>(null);

  protected readonly categoryFilter = signal<string>('');
  protected readonly includeDeleted = signal(false);
  /** Draft search text — applied on submit, not per keystroke. */
  protected readonly searchDraft = signal<string>('');
  protected readonly appliedSearch = signal<string>('');

  /** Multi-select for the bulk lock/unlock actions. */
  protected readonly selectedIds = signal<readonly string[]>([]);

  /** The row open in the drawer, by id — re-resolved so it follows a reload. */
  private readonly drawerId = signal<string | null>(null);

  protected readonly topics = computed<readonly AdminTopicSummary[]>(
    () => this._page()?.items ?? [],
  );
  protected readonly page = computed<number>(
    () => this._page()?.page ?? FIRST_PAGE,
  );
  protected readonly hasMore = computed<boolean>(
    () => this._page()?.hasMore ?? false,
  );
  protected readonly total = computed<number>(() => this._page()?.total ?? 0);
  protected readonly showPager = computed<boolean>(() => {
    const paged = this._page();
    return paged !== null && (paged.hasMore || paged.page > FIRST_PAGE);
  });

  /**
   * Resolved from the CURRENT rows rather than held as a snapshot, so a row
   * that is reloaded after a pin/lock updates the open drawer too. Holding the
   * object would show an operator the state they clicked on rather than the
   * state that resulted.
   */
  protected readonly drawerTopic = computed<AdminTopicSummary | null>(() => {
    const id = this.drawerId();
    if (id === null) return null;
    return this.topics().find((topic) => topic.id === id) ?? null;
  });

  protected readonly selectedCount = computed(() => this.selectedIds().length);

  public constructor() {
    this.loadCategories();
    this.load(FIRST_PAGE);
  }

  /* ---------------------------------------------------------------------- */
  /* Filters                                                                 */
  /* ---------------------------------------------------------------------- */

  protected onCategoryChange(event: Event): void {
    this.categoryFilter.set((event.target as HTMLSelectElement).value);
    this.load(FIRST_PAGE);
  }

  protected onSearchInput(event: Event): void {
    this.searchDraft.set((event.target as HTMLInputElement).value);
  }

  protected applySearch(event: Event): void {
    event.preventDefault();
    this.appliedSearch.set(this.searchDraft().trim());
    this.load(FIRST_PAGE);
  }

  protected toggleDeleted(): void {
    this.includeDeleted.update((value) => !value);
    this.load(FIRST_PAGE);
  }

  protected goToPage(page: number): void {
    if (page < FIRST_PAGE) return;
    this.load(page);
  }

  /* ---------------------------------------------------------------------- */
  /* Selection                                                               */
  /* ---------------------------------------------------------------------- */

  protected isSelected(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  protected toggleSelection(id: string): void {
    this.selectedIds.update((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  protected clearSelection(): void {
    this.selectedIds.set([]);
  }

  /**
   * Bulk lock/unlock.
   *
   * ⚠️ SEQUENTIAL PATCHES, NOT A BULK ENDPOINT, BECAUSE THERE IS NO BULK
   * ENDPOINT. Each one writes its own audit row inside its own transaction
   * (PRE-6), which is the property that matters more than the round-trip count:
   * a bulk route that recorded one audit entry for twelve topics would make the
   * log useless for the case it exists for. Selection is capped by the page
   * size, so this is at most 50 requests initiated by an explicit click.
   */
  protected bulkSetLocked(locked: boolean): void {
    const ids = this.selectedIds();
    if (ids.length === 0) return;

    let remaining = ids.length;
    this.clearSelection();

    for (const id of ids) {
      this.api
        .moderateCommunityTopic(id, { locked })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            remaining -= 1;
            if (remaining === 0) this.load(this.page());
          },
          error: (failure: unknown) => {
            remaining -= 1;
            this.error.set(describe(failure, 'One or more updates failed.'));
            if (remaining === 0) this.load(this.page());
          },
        });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Single-row moderation                                                   */
  /* ---------------------------------------------------------------------- */

  protected togglePin(topic: AdminTopicSummary): void {
    this.moderate(topic.id, { pinned: !topic.pinned });
  }

  protected toggleLock(topic: AdminTopicSummary): void {
    this.moderate(topic.id, { locked: !topic.locked });
  }

  protected move(topic: AdminTopicSummary, event: Event): void {
    const categoryId = (event.target as HTMLSelectElement).value;
    if (!categoryId || categoryId === topic.categoryId) return;
    this.moderate(topic.id, { categoryId });
  }

  protected remove(topic: AdminTopicSummary): void {
    this.busyId.set(topic.id);
    this.api
      .deleteCommunityTopic(topic.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.load(this.page());
        },
        error: (failure: unknown) => this.fail(failure, 'Delete failed.'),
      });
  }

  protected restore(topic: AdminTopicSummary): void {
    this.busyId.set(topic.id);
    this.api
      .restoreCommunityTopic(topic.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.load(this.page());
        },
        error: (failure: unknown) => this.fail(failure, 'Restore failed.'),
      });
  }

  /* ---------------------------------------------------------------------- */
  /* Drawer                                                                  */
  /* ---------------------------------------------------------------------- */

  protected openDrawer(topic: AdminTopicSummary): void {
    this.drawerId.set(topic.id);
  }

  protected closeDrawer(): void {
    this.drawerId.set(null);
  }

  /* ---------------------------------------------------------------------- */

  protected deletedVariant(topic: AdminTopicSummary): 'error' | 'success' {
    return topic.deletedAt === null ? 'success' : 'error';
  }

  protected stateLabel(topic: AdminTopicSummary): string {
    return topic.deletedAt === null ? 'Live' : 'Deleted';
  }

  private moderate(id: string, body: ModerateTopicRequest): void {
    this.busyId.set(id);
    this.error.set(null);

    this.api
      .moderateCommunityTopic(id, body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          // Re-read rather than patch the row locally: the server returns the
          // list of fields it ACTUALLY changed, and a move can also change
          // `categoryName`, which no local patch would know.
          this.load(this.page());
        },
        error: (failure: unknown) => this.fail(failure, 'Update failed.'),
      });
  }

  private fail(failure: unknown, fallback: string): void {
    this.busyId.set(null);
    this.error.set(describe(failure, fallback));
  }

  private loadCategories(): void {
    this.api
      .listCommunityCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (categories) => this.categories.set(categories),
        // A failed category list disables the move control and the filter; it
        // does not blank the moderation queue, which is the actual content.
        error: () => this.categories.set([]),
      });
  }

  private load(page: number): void {
    this.loading.set(true);
    this.error.set(null);

    this.api
      .listCommunityTopics({
        includeDeleted: this.includeDeleted(),
        categoryId: this.categoryFilter() || undefined,
        search: this.appliedSearch() || undefined,
        page,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (paged) => {
          this._page.set(paged);
          this.loading.set(false);
        },
        error: (failure: unknown) => {
          this.loading.set(false);
          this.error.set(
            describe(failure, 'We could not load the moderation queue.'),
          );
        },
      });
  }
}

/**
 * ⚠️ NEVER SURFACES A RAW SERVER MESSAGE. `HttpErrorResponse` implements `Error`
 * but does not extend it, so an HTTP failure falls through to `fallback` and its
 * "Http failure response for /api/…: 500" never reaches the screen. A
 * boundary-parse failure from `validate()` IS a real `Error` and its message
 * names the endpoint and field, which is exactly what an operator wants.
 */
function describe(failure: unknown, fallback: string): string {
  return failure instanceof Error && failure.message
    ? failure.message
    : fallback;
}
