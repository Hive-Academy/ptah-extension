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
  PenLine,
  Plus,
} from 'lucide-angular';

import {
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  type MemberTopicSummary,
  type Paged,
} from '@ptah-contracts/community';
import { EmptyState, TagChip, ThreadRow } from '@ptah-web/panel-ui';

import { MemberCommunityApiService } from '../services/member-community-api.service';

/**
 * MyThreadsPage — `/members/community/my-threads` (R9.2, R1.7.3, NFR-U6).
 *
 * ⚠️ IT IS THE FEED WITH AN AUTHOR FILTER, DELIBERATELY THIN. Task 7.6's own
 * words: "not a second list implementation". So it reuses `ThreadRow` — the
 * third consumer, and the reason that primitive was promoted into
 * `@ptah-web/panel-ui` at all — reuses the same `Paged` pagination, and reuses
 * the same one service method the feed calls. What it does NOT reuse is
 * `FeedPage` itself: that page owns a category rail, a category filter and the
 * topic composer, none of which belong here, and subclassing or `@Input`-ing
 * those away would make one component answer to two screens.
 *
 * ⚠️ ONE REQUEST, NOT TWO. `FeedPage` issues two because it renders a category
 * rail alongside the list. This page renders no rail — a member's own threads
 * are already a small, self-describing set and the category is on every row as
 * a `TagChip` — so the rail's request would buy nothing. That also keeps the
 * page inside the server's five-query budget (NFR-P4) without a second call to
 * decorate rows: `MemberTopicSummary` already carries `categoryName`,
 * `replyCount` and `unreadCount`.
 *
 * ⚠️ `mine=true` IS A SERVER-SIDE `where` CLAUSE AND THE CLIENT RE-FILTERS
 * NOTHING. The author id comes from `req.memberContext.userId`, which
 * `MemberGuard` resolved before the handler ran — the browser never sends an
 * identity, and `ListTopicsQueryDto` has no field that could carry one (an
 * `?authorId=` is a `400`). Critically the clause is ADDED to the visibility
 * and soft-delete restrictions rather than standing in for them, which is the
 * mistake a "my stuff" filter invites: a member does not get back their own
 * soft-deleted topic, and does not get back their own topic in a category they
 * can no longer see. Both are proven against the live server; neither is
 * re-implemented here, because a second copy of an access rule in a browser is
 * a rule that can be turned off with devtools.
 *
 * ⚠️ IT LISTS TOPICS THIS MEMBER AUTHORED — NOT TOPICS THEY REPLIED IN. Task
 * 7.6 asks for both. The shipped parameter is a single `authorId` clause on
 * `Topic`, and `Post.@@index([authorId])` still has no reader, so "threads I
 * participated in" cannot be expressed today. The page says what it shows
 * rather than implying the wider set, and the gap is reported rather than
 * approximated — a client-side union would mean paging the whole feed, which is
 * the fan-out Task 7.6's validation note forbids.
 *
 * ⚠️ EMPTY AND UNAVAILABLE ARE DIFFERENT SIGNALS AND NEVER RENDER THE SAME
 * (R6.4, R1.7.3). "You have not started a thread yet" is a true statement about
 * a member with no threads and a LIE about a member whose request failed —
 * it would tell them their writing is gone. So a failure renders a retryable
 * alert and an empty result renders an `EmptyState` whose copy points at the
 * composer instead of reporting a zero. The genuinely-empty case is the
 * expected one on a new account, not an edge case, and it must resolve to that
 * state rather than to a spinner that never stops.
 *
 * ⚠️ NO MARKDOWN RENDERER LIVES ON THIS PAGE (NFR-S2, PRE-4). A row is a title
 * and metadata; `MemberTopicSummary` carries no body at all, so there is
 * nothing here to render and nothing here may acquire a renderer.
 * `markdown-chokepoint.spec.ts` globs this file and asserts the shared
 * component is imported by exactly three files, none of them this one.
 *
 * NFR-U2: `base-100`/`base-200` surfaces, `border-hairline` boundaries,
 * `bg-surface-high` hover, `base-content/60` for muted text (NFR-U3's floor).
 * No `border-base-300` anywhere — `base-300` is a FILL. The Task 4.7 lint rule
 * polices `libs/web/members/**` and fails the build on that.
 */
@Component({
  selector: 'ptah-my-threads-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    LucideAngularModule,
    EmptyState,
    TagChip,
    ThreadRow,
  ],
  template: `
    <div class="flex flex-col gap-6">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1
            class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl"
          >
            My threads
          </h1>
          <p class="mt-1 text-sm text-base-content/60">
            Threads you started, newest activity first.
          </p>
        </div>
        <!--
          The composer lives on the feed and stays there — one composer, one
          place a thread is written. This is a link to it, not a second copy.
        -->
        <a
          class="btn btn-primary btn-sm gap-1 normal-case"
          routerLink="/members/community"
        >
          <lucide-angular [img]="PlusIcon" class="h-4 w-4" aria-hidden="true" />
          Start a thread
        </a>
      </header>

      <section aria-label="My threads">
        @if (errorMessage(); as message) {
          <!--
            R6.4 — a failure is NOT an empty state. Telling a member "you have
            not started a thread yet" after a 500 says their writing is gone.
          -->
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
          <div class="flex flex-col gap-2" aria-busy="true" aria-live="polite">
            <span class="sr-only">Loading your threads</span>
            @for (row of skeletonRows; track row) {
              <div class="h-16 animate-pulse rounded-lg bg-base-200"></div>
            }
          </div>
        } @else if (topics().length === 0) {
          <!--
            The expected state on a new account, and it RESOLVES — never a
            spinner that hangs. The copy points at the composer rather than
            reporting a zero (R1.7.3, R6.3).
          -->
          <div class="rounded-xl border border-hairline bg-base-200">
            <ptah-empty-state
              [icon]="PenLineIcon"
              message="You have not started a thread yet."
              hint="Ask a question or share what you are building — the composer is on the community feed, and anything you post shows up here."
            >
              <a
                class="btn btn-primary btn-sm normal-case"
                routerLink="/members/community"
              >
                Start your first thread
              </a>
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
  `,
})
export class MyThreadsPage {
  private readonly api = inject(MemberCommunityApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly PenLineIcon = PenLine;
  protected readonly PlusIcon = Plus;
  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  protected readonly firstPage = FIRST_PAGE;

  private readonly _page = signal<Paged<MemberTopicSummary> | null>(null);

  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

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
   * Hidden on a single page. `hasMore` alone is not enough — a member on the
   * last page of three still needs "Previous".
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

  public constructor() {
    this.load(FIRST_PAGE);
  }

  protected goToPage(page: number): void {
    if (page < FIRST_PAGE) return;
    this.load(page);
  }

  protected reload(): void {
    this.load(this.page());
  }

  private load(page: number): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.api
      .listTopics({ mine: true, page })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (paged) => {
          this._page.set(paged);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          // ⚠️ The previous page is CLEARED, so a retry that fails cannot leave
          // stale rows sitting under an error banner.
          this._page.set(null);
          this.errorMessage.set(
            describe(error, 'We could not load your threads.'),
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
 * raw "Http failure response for /api/…: 500" never reaches a member. A
 * boundary-parse failure from `validate()` DOES pass the check, and its message
 * names the endpoint and the offending field, which is the one case where the
 * detail is worth showing. The same asymmetry `FeedPage` and `HubPage` rely on.
 */
function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
