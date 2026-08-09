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
  ChevronLeft,
  ChevronRight,
  CloudOff,
  LucideAngularModule,
  Video,
} from 'lucide-angular';

import {
  FIRST_PAGE,
  type LiveFeedItem,
  type Paged,
} from '@ptah-contracts/community';
import { EmptyState } from '@ptah-web/panel-ui';

import { describeLoadFailure } from '../learning/courses-page';
import { YouTubePlayer } from '../learning/youtube-player';
import {
  MemberLiveApiService,
  feedItemKey,
} from '../services/member-live-api.service';
import { SessionCard } from './components/session-card';

/** An empty archive page, so the template never branches on `null`. */
const EMPTY_PAGE: Paged<LiveFeedItem> = {
  items: [],
  page: FIRST_PAGE,
  pageSize: 25,
  total: 0,
  hasMore: false,
};

/**
 * ReplaysPage — `/members/live/replays` (R3.4, NFR-S3, NFR-P5).
 *
 * ── 🔴 THE PLAYER IS THE EXISTING ONE, REUSED (ASSUMPTION-16, NFR-S3) ─────
 * `YouTubePlayer` in `../learning/youtube-player` is the ONE component in this
 * lib allowed to construct an embed, and `youtube-embed-chokepoint.spec.ts`
 * pins that by name — the bypass call site is `lib/learning/youtube-player.ts`
 * and the URL builder is `lib/learning/youtube-embed-url.ts`, and no other file
 * may carry a YouTube hostname. **Nothing in this file constructs an iframe, a
 * URL or a `SafeResourceUrl`.** A second embed constructor would fail that
 * spec, which is the good outcome.
 *
 * It stays in `learning/` and is imported across directories rather than being
 * moved: a move would churn six specs and the chokepoint's two path constants
 * for no behaviour change.
 *
 * ⚠️ ONE PLAYER AT A TIME. Activating a second replay tears the first down —
 * the facade design (NFR-S3) is what keeps a page of replay cards from loading
 * twenty-five YouTube iframes, and mounting several at once would give that
 * back.
 *
 * ── 🔴 THIS IS THE ONLY PAGED LIST ON THE LIVE SURFACE ────────────────────
 * `MemberLiveResponse` carries three lists and `replays` is the only
 * {@link Paged} one, because a replay archive accumulates for ever while the
 * schedule does not. `?page`/`?pageSize` therefore narrow ONLY this list — the
 * same request returns the whole `upcoming` array every time, which is a
 * deliberate contract decision rather than a wasted payload.
 *
 * ⚠️ `pageSize` IS NEVER SENT. The server's default (25) is used and echoed
 * back, so this page has no page-size number of its own to drift from
 * `DEFAULT_PAGE_SIZE`.
 *
 * ── R3.6 APPLIES HERE TOO, IN ITS QUIET FORM ──────────────────────────────
 * A degraded Calendar cannot remove a Ptah-authored replay, but it CAN remove
 * a calendar-sourced one, so the same non-error note is rendered — `role=
 * "status"`, no error colour. It is never rendered as a failure.
 *
 * ⚠️ IN THIS WORKSPACE THE ARCHIVE IS EMPTY. Measured 2026-08-09:
 * `replays.total = 0`, because there is not a single `LiveSession` row in this
 * database and a calendar event only becomes a replay once a `LiveSession`
 * claims it and carries a recording. The empty state is the live path here; the
 * populated path is proved by fixture and by a seeded e2e row.
 */
@Component({
  selector: 'ptah-replays-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    LucideAngularModule,
    EmptyState,
    SessionCard,
    YouTubePlayer,
  ],
  template: `
    <div class="flex flex-col gap-6">
      <header class="flex flex-col gap-1">
        <h1
          class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl"
        >
          Replays
        </h1>
        <p class="text-sm text-base-content/60">
          Recordings of past sessions.
          <a
            class="link link-hover font-medium text-base-content"
            routerLink="/members/live"
            >The upcoming schedule</a
          >
          is on the sessions page.
        </p>
      </header>

      <section aria-label="Session replays">
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
              class="btn btn-primary btn-sm mt-4 min-h-11 normal-case"
              (click)="reload()"
            >
              Try again
            </button>
          </div>
        } @else if (loading()) {
          <div class="flex flex-col gap-3" aria-busy="true" aria-live="polite">
            <span class="sr-only">Loading replays</span>
            @for (row of skeletonRows; track row) {
              <div class="h-28 animate-pulse rounded-xl bg-base-200"></div>
            }
          </div>
        } @else {
          <div class="flex flex-col gap-6">
            @if (!calendarAvailable()) {
              <!--
                Same non-error posture as the sessions page (R3.6). A degraded
                calendar cannot hide a Ptah-authored replay but it can hide a
                calendar-sourced one, so the list may be short.
              -->
              <div
                class="flex items-start gap-3 rounded-xl border border-hairline bg-base-200 p-4"
                role="status"
              >
                <lucide-angular
                  [img]="CloudOffIcon"
                  class="mt-0.5 h-5 w-5 shrink-0 text-base-content/60"
                  aria-hidden="true"
                />
                <p class="text-sm text-base-content/60">
                  This archive may be incomplete while the session calendar is
                  out of reach. Nothing has been removed.
                </p>
              </div>
            }

            @if (page().items.length === 0) {
              <div class="rounded-xl border border-hairline bg-base-200">
                <ptah-empty-state
                  [icon]="VideoIcon"
                  message="No replays have been published yet."
                  hint="Recordings appear here after a session is over and the host has uploaded it."
                />
              </div>
            } @else {
              <!--
                🔴 A REAL AXE FINDING, NOT A FORMALITY. Without this the page
                went from the h1 (Replays) straight to the h3 each SessionCard
                renders, and axe reported heading-order (moderate) on
                /members/live/replays. The sessions page passes because its day
                groupings and its "Happening now" section are already h2s; this
                list had no intermediate level at all. It is sr-only because the
                visible h1 already names the page — a second visible heading
                saying almost the same thing would be noise for sighted readers,
                and the fix is for the outline, not for the layout.
                (NO BACKTICKS IN AN INLINE-TEMPLATE COMMENT — B7's F-8. One
                terminates the template literal and the error names neither the
                file nor the cause. This batch hit it twice.)
              -->
              <h2 class="sr-only">Published replays</h2>
              <ul class="flex flex-col gap-3">
                @for (item of page().items; track key(item)) {
                  <li class="flex flex-col gap-3">
                    @if (playingKey() === key(item)) {
                      <!--
                        startActivated: the member ALREADY activated, on the
                        card's "Watch replay" control. Without it the recording
                        takes two clicks, the second on a poster labelled "Play
                        lesson". NFR-S3 is intact — the player is mounted only
                        in response to that click, and nothing YouTube-shaped is
                        requested before it.
                      -->
                      <ptah-youtube-player
                        [videoId]="item.youtubeVideoId"
                        [title]="item.title"
                        [startActivated]="true"
                      />
                    }
                    <ptah-session-card
                      [item]="item"
                      (playRequested)="playReplay($event)"
                    />
                  </li>
                }
              </ul>

              <nav
                class="flex items-center justify-between gap-3"
                aria-label="Replay pages"
              >
                <button
                  type="button"
                  class="btn btn-outline btn-sm min-h-11 gap-1 normal-case"
                  [disabled]="page().page <= 1"
                  (click)="goTo(page().page - 1)"
                >
                  <lucide-angular
                    [img]="ChevronLeftIcon"
                    class="h-4 w-4"
                    aria-hidden="true"
                  />
                  Newer
                </button>

                <p
                  class="font-mono text-xs text-base-content/60"
                  aria-live="polite"
                >
                  {{ rangeLabel() }}
                </p>

                <button
                  type="button"
                  class="btn btn-outline btn-sm min-h-11 gap-1 normal-case"
                  [disabled]="!page().hasMore"
                  (click)="goTo(page().page + 1)"
                >
                  Older
                  <lucide-angular
                    [img]="ChevronRightIcon"
                    class="h-4 w-4"
                    aria-hidden="true"
                  />
                </button>
              </nav>
            }
          </div>
        }
      </section>
    </div>
  `,
})
export class ReplaysPage {
  private readonly api = inject(MemberLiveApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly ChevronLeftIcon = ChevronLeft;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly CloudOffIcon = CloudOff;
  protected readonly VideoIcon = Video;
  protected readonly skeletonRows = [0, 1];

  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly calendarAvailable = signal(true);
  protected readonly page = signal<Paged<LiveFeedItem>>(EMPTY_PAGE);

  /**
   * The `feedItemKey` of the replay currently mounted, or `null`.
   *
   * ⚠️ A KEY, NOT AN INDEX AND NOT A BOOLEAN PER ROW. An index would point at
   * a different row after a page change, and RISK-AA means the bare `id` is
   * not a safe identity either.
   */
  protected readonly playingKey = signal<string | null>(null);

  /**
   * The page this component ASKED for, which is not the same fact as the page
   * it is currently showing.
   *
   * 🔴 A SPEC CAUGHT THIS AND IT WAS A REAL DEFECT. `reload()` originally read
   * `this.page().page` — but the error branch resets the envelope to
   * {@link EMPTY_PAGE}, whose `page` is `1`. So a failure on page 4 followed by
   * "Try again" silently sent the member back to the newest replays and looked
   * like a successful retry. The requested page has to survive an error the
   * response envelope does not.
   */
  private readonly requestedPage = signal(FIRST_PAGE);

  protected readonly key = feedItemKey;

  /** "1–25 of 61" — the count the server reported, never a local tally. */
  protected readonly rangeLabel = computed(() => {
    const current = this.page();
    if (current.total === 0) return '';
    const first = (current.page - 1) * current.pageSize + 1;
    const last = Math.min(first + current.items.length - 1, current.total);
    return `${first}–${last} of ${current.total}`;
  });

  public constructor() {
    this.load(FIRST_PAGE);
  }

  protected reload(): void {
    this.load(this.requestedPage());
  }

  protected goTo(page: number): void {
    if (page < FIRST_PAGE) return;
    // ⚠️ TEARS THE PLAYER DOWN BEFORE NAVIGATING. Leaving it mounted across a
    // page change would keep a video playing under a list it no longer belongs
    // to.
    this.playingKey.set(null);
    this.load(page);
  }

  protected playReplay(item: LiveFeedItem): void {
    this.playingKey.set(feedItemKey(item));
  }

  private load(page: number): void {
    this.requestedPage.set(page);
    this.loading.set(true);
    this.errorMessage.set(null);

    // ⚠️ `pageSize` IS OMITTED. The server's default is echoed back in the
    // response, so this page never holds a second copy of that number.
    this.api
      .read(page)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (feed) => {
          this.page.set(feed.replays);
          this.calendarAvailable.set(feed.calendarAvailable);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.page.set(EMPTY_PAGE);
          this.playingKey.set(null);
          this.calendarAvailable.set(true);
          this.errorMessage.set(
            describeLoadFailure(error, 'We could not load the replay archive.'),
          );
        },
      });
  }
}
