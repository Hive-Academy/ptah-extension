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
  GraduationCap,
  LucideAngularModule,
  MessageSquare,
  MessagesSquare,
  Search,
} from 'lucide-angular';

import {
  FIRST_PAGE,
  type MemberSearchResults,
} from '@ptah-contracts/community';
import { EmptyState, TagChip } from '@ptah-web/panel-ui';

import { MemberSearchApiService } from '../services/member-search-api.service';
import { HighlightTextPipe } from '../shared/highlight-text.pipe';

/** The server's `@MinLength(2)` on `q`, mirrored as a UI affordance. */
const MIN_QUERY_LENGTH = 2;

/**
 * SearchPage — `/members/search` (R1.7).
 *
 * ⚠️ RESULTS ARE GROUPED BY KIND, AND ALL THREE GROUPS ALWAYS EXIST (R1.7.1).
 * The response carries `topics`, `posts` and `lessons` as three independently
 * paged sets with one `?page`, deliberately: a single merged relevance-ranked
 * list across three domains needs a scoring model RK-1 explicitly does not
 * build, and the UI renders three labelled groups anyway.
 *
 * ⚠️ THE `lessons` GROUP RENDERS AN `EmptyState` IN PHASE 2 AND IS FILLED BY
 * BATCH 10. The server already returns the key as a well-formed empty `Paged`
 * (Task 6.11), so nothing about this page's shape changes when courses exist —
 * only the values. Hiding the group until then would mean adding it back later,
 * which is the shape-change R6.6 exists to prevent on the hub envelope.
 *
 * ⚠️ EXCERPTS ARE PLAIN TEXT AND HIGHLIGHTING IS TEXT NODES (R1.7.5, NFR-S2).
 * `HighlightTextPipe` turns the server's `{ text, matches }` into a list of runs
 * rendered as sibling `<span>`s with `{{ }}` interpolation. Every character
 * reaches the DOM as a text node that Angular escapes. There is no `[innerHTML]`
 * here and there must never be one — see the pipe's docblock for the concrete
 * XSS this design forecloses.
 *
 * ⚠️ NO MARKDOWN RENDERER ON THIS PAGE AT ALL. An excerpt is displayed as-is,
 * markdown syntax included, precisely so a search result never runs a second
 * rendering pipeline. Splitting rendered HTML on character offsets would cut
 * through tags.
 *
 * ⚠️ NO RESULTS RENDERS AN `EmptyState`, NEVER "0 results" (R1.7.3). And a
 * failed request renders an error, not an empty state — "nothing matched" and
 * "we could not search" are different facts and a member acts on them
 * differently.
 */
@Component({
  selector: 'ptah-search-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    LucideAngularModule,
    EmptyState,
    TagChip,
    HighlightTextPipe,
  ],
  template: `
    <div class="flex flex-col gap-6">
      <header>
        <h1
          class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl"
        >
          Search
        </h1>
        <p class="mt-1 text-sm text-base-content/60">
          Threads, replies and — from phase 3 — course lessons.
        </p>
      </header>

      <form class="flex flex-wrap items-center gap-2" (submit)="submit($event)">
        <label class="sr-only" [attr.for]="queryFieldId">Search query</label>
        <div class="relative min-w-0 flex-1">
          <lucide-angular
            [img]="SearchIcon"
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/60"
            aria-hidden="true"
          />
          <input
            [id]="queryFieldId"
            type="search"
            class="input input-bordered w-full bg-base-100 pl-9 text-sm"
            placeholder="What are you looking for?"
            [value]="query()"
            (input)="onQueryInput($event)"
          />
        </div>
        <button
          type="submit"
          class="btn btn-primary btn-sm normal-case"
          [disabled]="!canSearch()"
        >
          {{ searching() ? 'Searching…' : 'Search' }}
        </button>
      </form>

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
        </div>
      } @else if (searching()) {
        <div class="flex flex-col gap-2" aria-busy="true" aria-live="polite">
          <span class="sr-only">Searching</span>
          @for (row of skeletonRows; track row) {
            <div class="h-16 animate-pulse rounded-lg bg-base-200"></div>
          }
        </div>
      } @else if (results(); as found) {
        @if (totalHits() === 0) {
          <div class="rounded-xl border border-hairline bg-base-200">
            <ptah-empty-state
              [icon]="SearchIcon"
              [message]="'Nothing matched “' + lastQuery() + '”.'"
              hint="Try a shorter phrase, or a word you remember from the thread title."
            />
          </div>
        } @else {
          <!-- Threads ------------------------------------------------------ -->
          <section class="flex flex-col gap-3" aria-labelledby="search-topics">
            <h2
              id="search-topics"
              class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-base-content/60"
            >
              <lucide-angular
                [img]="MessagesSquareIcon"
                class="h-4 w-4"
                aria-hidden="true"
              />
              Threads ({{ found.topics.total }})
            </h2>

            @if (found.topics.items.length === 0) {
              <p class="text-sm text-base-content/60">
                No thread titles matched.
              </p>
            } @else {
              <ul
                class="divide-y divide-hairline rounded-xl border border-hairline bg-base-200 px-4"
              >
                @for (hit of found.topics.items; track hit.id) {
                  <li class="py-3">
                    <a
                      class="-mx-2 block rounded-lg px-2 py-1 transition-colors hover:bg-surface-high"
                      [routerLink]="['/members/community/topics', hit.slug]"
                    >
                      <p class="text-sm font-semibold text-base-content">
                        <!--
                          Sibling spans over TEXT NODES. Never an HTML string.
                        -->
                        @for (
                          segment of hit.titleExcerpt | highlightText;
                          track $index
                        ) {
                          <span [class]="segment.match ? highlightClass : ''">{{
                            segment.text
                          }}</span>
                        }
                      </p>
                      <p
                        class="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-base-content/60"
                      >
                        <span>{{ hit.authorName ?? 'Unknown' }}</span>
                        <span aria-hidden="true">·</span>
                        <ptah-tag-chip [label]="hit.categoryName" />
                        <span aria-hidden="true">·</span>
                        <span>{{ hit.replyCount }} replies</span>
                        <span aria-hidden="true">·</span>
                        <time [attr.datetime]="hit.lastPostedAt">
                          {{ hit.lastPostedAt | date: 'MMM d, HH:mm' }}
                        </time>
                      </p>
                    </a>
                  </li>
                }
              </ul>
            }
          </section>

          <!-- Replies ------------------------------------------------------ -->
          <section class="flex flex-col gap-3" aria-labelledby="search-posts">
            <h2
              id="search-posts"
              class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-base-content/60"
            >
              <lucide-angular
                [img]="MessageSquareIcon"
                class="h-4 w-4"
                aria-hidden="true"
              />
              Replies ({{ found.posts.total }})
            </h2>

            @if (found.posts.items.length === 0) {
              <p class="text-sm text-base-content/60">
                No post bodies matched.
              </p>
            } @else {
              <ul
                class="divide-y divide-hairline rounded-xl border border-hairline bg-base-200 px-4"
              >
                @for (hit of found.posts.items; track hit.id) {
                  <li class="py-3">
                    <a
                      class="-mx-2 block rounded-lg px-2 py-1 transition-colors hover:bg-surface-high"
                      [routerLink]="[
                        '/members/community/topics',
                        hit.topicSlug,
                      ]"
                    >
                      <p class="text-sm font-semibold text-base-content">
                        {{ hit.topicTitle }}
                      </p>
                      <p class="mt-1 text-sm text-base-content/60">
                        @for (
                          segment of hit.bodyExcerpt | highlightText;
                          track $index
                        ) {
                          <span [class]="segment.match ? highlightClass : ''">{{
                            segment.text
                          }}</span>
                        }
                      </p>
                      <p
                        class="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-base-content/60"
                      >
                        <span>{{ hit.authorName ?? 'Unknown' }}</span>
                        <span aria-hidden="true">·</span>
                        <ptah-tag-chip [label]="hit.categoryName" />
                        <span aria-hidden="true">·</span>
                        <time [attr.datetime]="hit.createdAt">
                          {{ hit.createdAt | date: 'MMM d, HH:mm' }}
                        </time>
                      </p>
                    </a>
                  </li>
                }
              </ul>
            }
          </section>

          <!-- Lessons — declared now, filled by Batch 10 -------------------- -->
          <section class="flex flex-col gap-3" aria-labelledby="search-lessons">
            <h2
              id="search-lessons"
              class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-base-content/60"
            >
              <lucide-angular
                [img]="GraduationCapIcon"
                class="h-4 w-4"
                aria-hidden="true"
              />
              Lessons ({{ found.lessons.total }})
            </h2>

            @if (found.lessons.items.length === 0) {
              <div class="rounded-xl border border-hairline bg-base-200">
                <ptah-empty-state
                  [icon]="GraduationCapIcon"
                  message="No lessons to search yet."
                  hint="Course content is published from phase 3. This group already reads the same response, so it fills in without a change here."
                />
              </div>
            } @else {
              <ul
                class="divide-y divide-hairline rounded-xl border border-hairline bg-base-200 px-4"
              >
                @for (hit of found.lessons.items; track hit.id) {
                  <li class="py-3">
                    <p class="text-sm font-semibold text-base-content">
                      @for (
                        segment of hit.titleExcerpt | highlightText;
                        track $index
                      ) {
                        <span [class]="segment.match ? highlightClass : ''">{{
                          segment.text
                        }}</span>
                      }
                    </p>
                    <p class="mt-1 font-mono text-xs text-base-content/60">
                      {{ hit.courseTitle }} · {{ hit.moduleTitle }}
                    </p>
                  </li>
                }
              </ul>
            }
          </section>
        }
      } @else {
        <div class="rounded-xl border border-hairline bg-base-200">
          <ptah-empty-state
            [icon]="SearchIcon"
            message="Search the community."
            hint="Two characters or more. Results are grouped by threads, replies and lessons."
          />
        </div>
      }
    </div>
  `,
})
export class SearchPage {
  private readonly api = inject(MemberSearchApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly GraduationCapIcon = GraduationCap;
  protected readonly MessageSquareIcon = MessageSquare;
  protected readonly MessagesSquareIcon = MessagesSquare;
  protected readonly SearchIcon = Search;
  protected readonly skeletonRows = [0, 1, 2];
  protected readonly queryFieldId = 'member-search-query';

  /**
   * The emphasis applied to a matched run.
   *
   * A single literal class string rather than four `[class.x]` bindings per
   * span: Tailwind's content scanner needs the literals, and there are three
   * result groups each rendering this in a loop — four bindings times three
   * groups is twelve places for one of them to be forgotten.
   */
  protected readonly highlightClass = 'rounded bg-primary px-0.5 text-base-100';

  protected readonly query = signal('');
  protected readonly lastQuery = signal('');
  protected readonly searching = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  private readonly _results = signal<MemberSearchResults | null>(null);
  protected readonly results = this._results.asReadonly();

  /**
   * Mirrors the server's `@MinLength(2)` as a disabled button. The query itself
   * is still sent exactly as typed — re-validating member input client-side
   * would be a second definition of a valid query, and the two would disagree
   * the first time either moved.
   */
  protected readonly canSearch = computed<boolean>(
    () => !this.searching() && this.query().trim().length >= MIN_QUERY_LENGTH,
  );

  protected readonly totalHits = computed<number>(() => {
    const found = this._results();
    if (!found) return 0;
    return found.topics.total + found.posts.total + found.lessons.total;
  });

  protected onQueryInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (!this.canSearch()) return;

    const q = this.query().trim();
    this.searching.set(true);
    this.errorMessage.set(null);
    this.lastQuery.set(q);

    this.api
      .search({ q, page: FIRST_PAGE })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (results) => {
          this._results.set(results);
          this.searching.set(false);
        },
        error: (error: unknown) => {
          this.searching.set(false);
          // ⚠️ The previous results are CLEARED. Leaving them on screen under a
          // new query's error would show a member hits for something they did
          // not ask for.
          this._results.set(null);
          this.errorMessage.set(
            error instanceof Error && error.message
              ? error.message
              : 'We could not run that search. Try again in a moment.',
          );
        },
      });
  }
}
