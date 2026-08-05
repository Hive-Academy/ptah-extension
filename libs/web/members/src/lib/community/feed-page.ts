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
import { RouterLink } from '@angular/router';
import {
  AlertTriangle,
  LucideAngularModule,
  MessagesSquare,
  Plus,
} from 'lucide-angular';

import {
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  type MemberCategory,
  type MemberTopicSummary,
  type Paged,
} from '@ptah-contracts/community';
import { EmptyState, TagChip, ThreadRow } from '@ptah-web/panel-ui';

import { MemberCommunityApiService } from '../services/member-community-api.service';
import { TopicComposer, type TopicDraft } from './components/topic-composer';
import { UnreadPill } from './components/unread-pill';

/**
 * FeedPage — `/members/community` (R1.1, R1.2).
 *
 * ⚠️ TWO REQUESTS ON LOAD, AND THAT IS CORRECT. R6.2's one-request budget is the
 * HUB's, and it exists because the hub is an aggregate of five unrelated
 * sections on the first screen a paying member sees. This page is one domain
 * with two lists whose shapes genuinely differ — a category rail that changes
 * rarely and a topic page that changes on every filter and every page step. An
 * aggregate here would re-send the rail on every pagination click, which is
 * strictly worse than the second request it saves.
 *
 * ⚠️ THE SERVER DECIDES ORDER, THIS PAGE DOES NOT RE-SORT.
 *   · Categories arrive in admin-defined `sortOrder` ascending (R1.1.4).
 *   · Topics arrive pinned-first, then `lastPostedAt` descending (R1.2.5),
 *     served by the `@@index([categoryId, pinned, lastPostedAt])` composite.
 * Re-sorting client-side would reorder only the current PAGE, which looks like
 * working software and silently breaks the moment a member reaches page 2.
 *
 * ⚠️ IT PAGINATES, IT DOES NOT ACCUMULATE (NFR-U6). The server already returns
 * `Paged<T>` with `hasMore`; unbounded DOM growth on a feed is the named
 * failure, and virtualization would be a bigger machine than this needs.
 *
 * ⚠️ EVERY EMPTY SURFACE IS AN `EmptyState`, NEVER A BARE ZERO (R1.7.3, R6.3).
 * A "0 results" string tells a member a query ran; it does not tell them what to
 * do, and on a brand-new community "0" is the normal state, not a failure.
 *
 * ⚠️ NOTHING HERE FILTERS BY VISIBILITY. Both lists were filtered in the SQL
 * (`buildCategoryVisibilityWhere`), so a category a member cannot see is one
 * they never learn exists (R1.1.3). `MemberCategory.visibility` is rendered as a
 * `TagChip` LABEL — the UI saying "cohort only" about access the member
 * demonstrably already has.
 *
 * NFR-U2: `base-100`/`base-200` surfaces, `border-hairline` boundaries,
 * `bg-surface-high` hover. No `border-base-300` — `base-300` is a fill. The Task
 * 4.7 lint rule enforces this for `libs/web/members/**` and will fail the build.
 */
@Component({
  selector: 'ptah-feed-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    LucideAngularModule,
    EmptyState,
    TagChip,
    ThreadRow,
    TopicComposer,
    UnreadPill,
  ],
  template: `
    <div class="flex flex-col gap-6">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1
            class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl"
          >
            Community
          </h1>
          <p class="mt-1 text-sm text-base-content/60">
            Ask, answer and share what you are building.
          </p>
        </div>
        <button
          type="button"
          class="btn btn-primary btn-sm gap-1 normal-case"
          [disabled]="categories().length === 0"
          [attr.aria-expanded]="composerOpen()"
          (click)="toggleComposer()"
        >
          <lucide-angular [img]="PlusIcon" class="h-4 w-4" aria-hidden="true" />
          {{ composerOpen() ? 'Close composer' : 'Start a thread' }}
        </button>
      </header>

      @if (composerOpen()) {
        <ptah-topic-composer
          [categories]="categories()"
          [initialCategoryId]="selectedCategoryId()"
          [submitting]="creating()"
          [errorMessage]="createError()"
          (submitted)="createTopic($event)"
          (cancelled)="toggleComposer()"
        />
      }

      <div class="grid gap-6 lg:grid-cols-4">
        <!-- Category rail — admin-defined order, never re-sorted here. -->
        <nav class="lg:col-span-1" aria-label="Categories">
          <ul class="flex flex-col gap-1">
            <li>
              <button
                type="button"
                class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-surface-high"
                [class.bg-surface-high]="selectedCategoryId() === null"
                [class.font-semibold]="selectedCategoryId() === null"
                [attr.aria-current]="selectedCategoryId() === null"
                (click)="selectCategory(null)"
              >
                <span class="text-base-content">All threads</span>
              </button>
            </li>
            @for (category of categories(); track category.id) {
              <li>
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-surface-high"
                  [class.bg-surface-high]="selectedCategoryId() === category.id"
                  [class.font-semibold]="selectedCategoryId() === category.id"
                  [attr.aria-current]="selectedCategoryId() === category.id"
                  (click)="selectCategory(category.id)"
                >
                  <span class="flex min-w-0 flex-col gap-1">
                    <span class="truncate text-base-content">
                      {{ category.name }}
                    </span>
                    <span class="flex items-center gap-1">
                      <span class="font-mono text-xs text-base-content/60">
                        {{ category.topicCount }}
                      </span>
                      @if (category.visibility !== 'member') {
                        <ptah-tag-chip [label]="visibilityLabel(category)" />
                      }
                    </span>
                  </span>
                  <!--
                    noun="thread" is load-bearing: MemberCategory.unreadCount
                    counts TOPICS with unread activity, while the per-row pill
                    in the list below counts POSTS. Both render "N new"; only
                    the accessible label tells them apart.
                  -->
                  <ptah-unread-pill
                    [count]="category.unreadCount"
                    noun="thread"
                  />
                </button>
              </li>
            }
          </ul>
        </nav>

        <section class="lg:col-span-3" aria-label="Threads">
          @if (errorMessage(); as message) {
            <div
              class="rounded-xl border border-hairline bg-base-200 p-6 text-center"
              role="alert"
            >
              <lucide-angular
                [img]="AlertTriangleIcon"
                class="mx-auto h-8 w-8 text-warning"
                aria-hidden="true"
              />
              <p class="mt-3 text-sm text-base-content">{{ message }}</p>
              <button
                type="button"
                class="btn btn-primary btn-sm mt-4 normal-case"
                (click)="reload()"
              >
                Try again
              </button>
            </div>
          } @else if (loading()) {
            <div
              class="flex flex-col gap-2"
              aria-busy="true"
              aria-live="polite"
            >
              <span class="sr-only">Loading threads</span>
              @for (row of skeletonRows; track row) {
                <div class="h-16 animate-pulse rounded-lg bg-base-200"></div>
              }
            </div>
          } @else if (topics().length === 0) {
            <div class="rounded-xl border border-hairline bg-base-200">
              <ptah-empty-state
                [icon]="MessagesSquareIcon"
                [message]="emptyMessage()"
                hint="Threads you and other Builders start show up here, newest activity first."
              >
                <button
                  type="button"
                  class="btn btn-primary btn-sm normal-case"
                  [disabled]="categories().length === 0"
                  (click)="openComposer()"
                >
                  Start the first thread
                </button>
              </ptah-empty-state>
            </div>
          } @else {
            <ul
              class="divide-y divide-hairline rounded-xl border border-hairline bg-base-200 px-4"
            >
              @for (topic of topics(); track topic.id) {
                <li>
                  <a
                    class="-mx-2 block rounded-lg px-2 transition-colors hover:bg-surface-high"
                    [routerLink]="['/members/community/topics', topic.slug]"
                  >
                    <ptah-thread-row
                      [title]="topic.title"
                      [author]="topic.authorName"
                      [replyCount]="topic.replyCount"
                      [unreadCount]="topic.unreadCount"
                      [pinned]="topic.pinned"
                      [locked]="topic.locked"
                      [accepted]="topic.hasAcceptedAnswer"
                    >
                      <span aria-hidden="true">·</span>
                      <ptah-tag-chip [label]="topic.categoryName" />
                      <span aria-hidden="true">·</span>
                      <time [attr.datetime]="topic.lastPostedAt">
                        {{ topic.lastPostedAt | date: 'MMM d, HH:mm' }}
                      </time>
                    </ptah-thread-row>
                  </a>
                </li>
              }
            </ul>

            @if (showPager()) {
              <nav
                class="mt-4 flex items-center justify-between gap-3"
                aria-label="Pagination"
              >
                <button
                  type="button"
                  class="btn btn-ghost btn-sm normal-case"
                  [disabled]="page() <= firstPage"
                  (click)="goToPage(page() - 1)"
                >
                  Previous
                </button>
                <p class="font-mono text-xs text-base-content/60">
                  {{ pageLabel() }}
                </p>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm normal-case"
                  [disabled]="!hasMore()"
                  (click)="goToPage(page() + 1)"
                >
                  Next
                </button>
              </nav>
            }
          }
        </section>
      </div>
    </div>
  `,
})
export class FeedPage {
  private readonly api = inject(MemberCommunityApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly MessagesSquareIcon = MessagesSquare;
  protected readonly PlusIcon = Plus;
  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  protected readonly firstPage = FIRST_PAGE;

  private readonly _categories = signal<readonly MemberCategory[]>([]);
  private readonly _page = signal<Paged<MemberTopicSummary> | null>(null);

  protected readonly categories = this._categories.asReadonly();
  protected readonly selectedCategoryId = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly composerOpen = signal(false);
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);

  protected readonly topics = computed<readonly MemberTopicSummary[]>(
    () => this._page()?.items ?? [],
  );
  protected readonly page = computed<number>(
    () => this._page()?.page ?? FIRST_PAGE,
  );
  protected readonly hasMore = computed<boolean>(
    () => this._page()?.hasMore ?? false,
  );

  /**
   * The pager is hidden on a single page. `hasMore` alone is not enough — a
   * member on the last page of three still needs "Previous".
   */
  protected readonly showPager = computed<boolean>(() => {
    const paged = this._page();
    if (!paged) return false;
    return paged.hasMore || paged.page > FIRST_PAGE;
  });

  protected readonly pageLabel = computed<string>(() => {
    const paged = this._page();
    if (!paged) return '';
    const size = paged.pageSize || DEFAULT_PAGE_SIZE;
    const first = (paged.page - 1) * size + 1;
    const last = Math.min(paged.page * size, paged.total);
    return `${first}-${last} of ${paged.total}`;
  });

  /** Names the filter when one is applied, so "nothing here" is not ambiguous. */
  protected readonly emptyMessage = computed<string>(() => {
    const id = this.selectedCategoryId();
    if (id === null) return 'No threads yet.';
    const name = this._categories().find((c) => c.id === id)?.name;
    return name ? `No threads in ${name} yet.` : 'No threads yet.';
  });

  public constructor() {
    this.loadCategories();
    this.loadTopics(FIRST_PAGE);
  }

  protected visibilityLabel(category: MemberCategory): string {
    return category.visibility === 'cohort' ? 'Cohort' : 'Staff';
  }

  protected selectCategory(id: string | null): void {
    if (this.selectedCategoryId() === id) return;
    this.selectedCategoryId.set(id);
    // Back to page 1: page 4 of "All threads" is not page 4 of one category,
    // and keeping the number would land the member on an empty page.
    this.loadTopics(FIRST_PAGE);
  }

  protected goToPage(page: number): void {
    if (page < FIRST_PAGE) return;
    this.loadTopics(page);
  }

  protected reload(): void {
    this.loadTopics(this.page());
  }

  protected toggleComposer(): void {
    this.composerOpen.update((open) => !open);
    this.createError.set(null);
  }

  protected openComposer(): void {
    this.composerOpen.set(true);
    this.createError.set(null);
  }

  protected createTopic(draft: TopicDraft): void {
    this.creating.set(true);
    this.createError.set(null);

    this.api
      .createTopic(draft)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.creating.set(false);
          this.composerOpen.set(false);
          // Re-read both lists: the new topic changes the feed AND the
          // category's `topicCount`. Patching them locally would be a second
          // derivation of two numbers the server already computes.
          this.loadCategories();
          this.loadTopics(FIRST_PAGE);
        },
        error: (error: unknown) => {
          this.creating.set(false);
          this.createError.set(
            describe(error, 'We could not post that thread.'),
          );
        },
      });
  }

  private loadCategories(): void {
    this.api
      .listCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (categories) => this._categories.set(categories),
        // A failed rail does NOT fail the page: the topic list is the content
        // and it loads independently. Blanking the feed because a nav sidebar
        // failed would be the section-status mistake `HubPage` documents.
        error: () => this._categories.set([]),
      });
  }

  private loadTopics(page: number): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.api
      .listTopics({
        categoryId: this.selectedCategoryId() ?? undefined,
        page,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (paged) => {
          this._page.set(paged);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.errorMessage.set(
            describe(error, 'We could not load the community feed.'),
          );
        },
      });
  }
}

/**
 * A member-facing sentence for a failure this page cannot act on.
 *
 * ⚠️ `HttpErrorResponse` IS NOT AN `Error` — it `implements` the interface but
 * does not extend the class — so an HTTP failure takes {@link fallback} and its
 * raw "Http failure response for /api/…: 500" never reaches a member. What DOES
 * pass the check is a boundary-parse failure from `validate()`, whose message
 * names the endpoint and the offending field. That asymmetry is the useful one
 * and it is the same test `HubPage` makes.
 *
 * ⚠️ IT DOES NOT INSPECT THE STATUS CODE. The page that must tell `404` ("this
 * does not exist") from `403` ("you may not") does it where the distinction is
 * actionable — the thread page. On a list both collapse to "we could not load
 * this", and branching here would put a second, weaker copy of that logic in
 * the file least able to use it.
 */
function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
