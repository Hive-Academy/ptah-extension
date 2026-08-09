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
  CalendarClock,
  CloudOff,
  LucideAngularModule,
  Radio,
} from 'lucide-angular';

import type { LiveFeedItem } from '@ptah-contracts/community';
import { EmptyState } from '@ptah-web/panel-ui';

import { describeLoadFailure } from '../learning/courses-page';
import {
  MemberLiveApiService,
  feedItemKey,
} from '../services/member-live-api.service';
import { SessionCard } from './components/session-card';

/**
 * How many upcoming sessions are revealed at once.
 *
 * 🔴 THIS IS A CLIENT-SIDE REVEAL, NOT A PAGE REQUEST (RISK-AB). `upcoming` is
 * a BARE ARRAY by contract — only `replays` is paged — and `ListLiveQueryDto`
 * runs under `forbidNonWhitelisted`, so an invented parameter for this list
 * would be a `400`, not an ignored hint. The whole list is already in memory;
 * this constant governs how much of it is in the DOM.
 *
 * It exists because a real recurring master expands to 43 instances. Measured
 * 2026-08-09: fifty upcoming items across forty-four distinct days carrying
 * only TWO distinct titles — forty-four of them reading `PRO ESTATE MEETING`.
 * A flat list of forty-four identical rows reads as a rendering bug.
 *
 * 25 matches `DEFAULT_PAGE_SIZE`, so the two lists on this surface reveal at
 * the same rate even though only one of them is paged.
 */
const REVEAL_STEP = 25;

/** One calendar day's worth of sessions, in the order the server sent them. */
interface SessionDay {
  /** `YYYY-MM-DD`, taken from the ISO string — never recomputed from a clock. */
  readonly key: string;
  /** The first item's `startsAt`, for the heading's `DatePipe` and `<time>`. */
  readonly startsAt: string;
  readonly items: readonly LiveFeedItem[];
}

/**
 * LivePage — `/members/live` (R3.3, R3.5, R3.6, R6.4, R9.7).
 *
 * ── 🔴 THE BRANCH ORDER IS THE WHOLE TASK (RISK-Z) ────────────────────────
 * error → loading → `calendarAvailable === false` → empty → list.
 *
 * The cell that matters is `calendarAvailable: false` **with an empty feed**.
 * Rendered naively it says *"No sessions scheduled yet"* — which is a LIE told
 * to a paying member whose calendar we simply could not read, and it is the
 * exact inverse of B7's rule that a failure is not an empty state. Getting it
 * right costs one branch; getting it wrong is invisible in every test that
 * fixes the flag to `true`.
 *
 * The four cells, each with its own copy:
 *
 * | `calendarAvailable` | items | render                                    |
 * | ------------------- | ----- | ----------------------------------------- |
 * | `false`             | none  | "could not read the calendar" + reassurance |
 * | `false`             | some  | the list, plus the same quiet note         |
 * | `true`              | none  | "No sessions scheduled yet"                |
 * | `true`              | some  | the list, no note                          |
 *
 * ── 🔴 R3.6: THE DEGRADED NOTE IS NOT AN ERROR ────────────────────────────
 * `role="status"`, **not** `role="alert"`. No error colour, no warning icon
 * with an alarm, no "something went wrong". R3.6 requires the surface to
 * render *"and SHALL show no error to the member"* — an unconfigured or
 * unreachable Calendar is a fact about our integration, not a failure the
 * member caused or can fix. A failure of the request ITSELF is a different
 * thing and does get a retryable error (R6.4).
 *
 * ⚠️ IN THIS WORKSPACE THE FLAG IS `true`. `GOOGLE_OAUTH_*` IS configured
 * (B12's F-1 killed ASSUMPTION-10), so the degraded cells are reachable only
 * by stubbing the response — which the spec and the e2e run both do
 * explicitly. Nothing here assumes the empty, calendar-less feed the plan was
 * written against.
 *
 * ── 🔴 `@for` TRACKS `feedItemKey`, NEVER `item.id` (RISK-AA) ─────────────
 * `LiveFeedItem.id` is a `LiveSession` cuid OR a Google event id, in one
 * field, and the contract says so. A `LiveSession` may CLAIM a calendar event
 * id, so a collision across the concatenated lists is reachable.
 *
 * ── `state` IS THE SERVER'S (RISK-AC) ─────────────────────────────────────
 * No `new Date()`, no `Date.now()`. The day grouping slices the ISO string the
 * server sent; it never parses it against a local clock.
 *
 * ⚠️ REPLAYS ARE NOT RENDERED HERE. They have their own route, their own
 * paging and their own player. This page links to them.
 */
@Component({
  selector: 'ptah-live-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, LucideAngularModule, EmptyState, SessionCard],
  template: `
    <div class="flex flex-col gap-6">
      <header class="flex flex-col gap-1">
        <h1
          class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl"
        >
          Sessions
        </h1>
        <p class="text-sm text-base-content/60">
          Everything on the schedule, in one place.
          <a
            class="link link-hover font-medium text-base-content"
            routerLink="/members/live/replays"
            >Past sessions and replays</a
          >
          have their own page.
        </p>
      </header>

      <section aria-label="Live and upcoming sessions">
        @if (errorMessage(); as message) {
          <!--
            R6.4 — a FAILED REQUEST is not an empty state and not a degraded
            calendar. It is the only one of the three that offers a retry.
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
              class="btn btn-primary btn-sm mt-4 min-h-11 normal-case"
              (click)="reload()"
            >
              Try again
            </button>
          </div>
        } @else if (loading()) {
          <div class="flex flex-col gap-3" aria-busy="true" aria-live="polite">
            <span class="sr-only">Loading the session schedule</span>
            @for (row of skeletonRows; track row) {
              <div class="h-28 animate-pulse rounded-xl bg-base-200"></div>
            }
          </div>
        } @else {
          <div class="flex flex-col gap-6">
            @if (!calendarAvailable()) {
              <!--
                🔴 RISK-Z. role="status", NOT role="alert" — R3.6 forbids
                showing the member an error here. No error colour and no alarm
                icon: the schedule may be incomplete, nothing has gone wrong
                that they can act on.
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
                <div class="flex flex-col gap-1">
                  <p class="text-sm font-medium text-base-content">
                    {{
                      hasAnySession()
                        ? 'This schedule may be incomplete.'
                        : 'We could not read the session calendar just now.'
                    }}
                  </p>
                  <p class="text-sm text-base-content/60">
                    Nothing has been cancelled. Scheduled sessions will reappear
                    here as soon as the calendar responds, and anything already
                    listed is up to date.
                  </p>
                </div>
              </div>
            }

            @if (liveNow().length > 0) {
              <div class="flex flex-col gap-3">
                <h2
                  class="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-primary"
                >
                  <lucide-angular
                    [img]="RadioIcon"
                    class="h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                  Happening now
                </h2>
                <ul class="flex flex-col gap-3">
                  @for (item of liveNow(); track key(item)) {
                    <li><ptah-session-card [item]="item" /></li>
                  }
                </ul>
              </div>
            }

            @if (visibleDays().length > 0) {
              <div class="flex flex-col gap-5">
                @for (day of visibleDays(); track day.key) {
                  <div class="flex flex-col gap-3">
                    <!--
                      RISK-AB — a day heading is what turns forty-four rows of
                      the same recurring title into a schedule a member can
                      read. The grouping key is a SLICE of the ISO string the
                      server sent, never a local-clock reparse.
                    -->
                    <h2
                      class="border-b border-hairline pb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-base-content/60"
                    >
                      <time [attr.datetime]="day.key">{{
                        day.startsAt | date: 'EEEE, d MMMM y'
                      }}</time>
                    </h2>
                    <ul class="flex flex-col gap-3">
                      @for (item of day.items; track key(item)) {
                        <li><ptah-session-card [item]="item" /></li>
                      }
                    </ul>
                  </div>
                }
              </div>

              @if (hiddenCount() > 0) {
                <button
                  type="button"
                  class="btn btn-outline btn-sm min-h-11 self-center normal-case"
                  (click)="revealMore()"
                >
                  Show {{ hiddenCount() }} more
                </button>
              }
            } @else if (liveNow().length === 0 && calendarAvailable()) {
              <div class="rounded-xl border border-hairline bg-base-200">
                <ptah-empty-state
                  [icon]="CalendarClockIcon"
                  message="No sessions scheduled yet."
                  hint="Live sessions are announced in the community; the next one will appear here."
                />
              </div>
            }
          </div>
        }
      </section>
    </div>
  `,
})
export class LivePage {
  private readonly api = inject(MemberLiveApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly CalendarClockIcon = CalendarClock;
  protected readonly CloudOffIcon = CloudOff;
  protected readonly RadioIcon = Radio;
  protected readonly skeletonRows = [0, 1, 2];

  private readonly upcoming = signal<readonly LiveFeedItem[]>([]);
  private readonly revealed = signal(REVEAL_STEP);

  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly liveNow = signal<readonly LiveFeedItem[]>([]);

  /**
   * ⚠️ DEFAULTS TO `true` SO A PRE-RESPONSE RENDER DOES NOT FLASH THE DEGRADED
   * NOTE. The `loading` branch runs first anyway, but a default of `false`
   * would make the note the resting state of a component that had never spoken
   * to the server — which is the opposite of what it means.
   */
  protected readonly calendarAvailable = signal(true);

  protected readonly key = feedItemKey;

  /** True when the feed carried anything at all — changes only the copy. */
  protected readonly hasAnySession = computed(
    () => this.liveNow().length + this.upcoming().length > 0,
  );

  /**
   * The upcoming list, grouped by calendar day and truncated to the revealed
   * count.
   *
   * ⚠️ THE TRUNCATION IS APPLIED TO THE ITEMS, THEN GROUPED — not the other
   * way round. Grouping first and then taking N groups would reveal a variable
   * number of sessions per click, which makes "Show 18 more" a number that
   * does not match what happens.
   */
  protected readonly visibleDays = computed<readonly SessionDay[]>(() =>
    groupByDay(this.upcoming().slice(0, this.revealed())),
  );

  protected readonly hiddenCount = computed(() =>
    Math.max(0, this.upcoming().length - this.revealed()),
  );

  public constructor() {
    this.load();
  }

  protected reload(): void {
    this.load();
  }

  protected revealMore(): void {
    this.revealed.update((current) => current + REVEAL_STEP);
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    // ⚠️ NO PAGE ARGUMENTS. They would reach `replays` only, which this page
    // does not render.
    this.api
      .read()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (feed) => {
          this.liveNow.set(feed.live);
          this.upcoming.set(feed.upcoming);
          this.calendarAvailable.set(feed.calendarAvailable);
          this.revealed.set(REVEAL_STEP);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          // ⚠️ CLEARED, so a failed retry cannot leave stale rows sitting under
          // an error banner (B7.1's rule, carried by every member page).
          this.liveNow.set([]);
          this.upcoming.set([]);
          // ⚠️ RESET TO `true` DELIBERATELY. A request that failed outright
          // told us NOTHING about the calendar, and leaving a stale `false`
          // here would render the degraded note under the error.
          this.calendarAvailable.set(true);
          this.errorMessage.set(
            describeLoadFailure(
              error,
              'We could not load the session schedule.',
            ),
          );
        },
      });
  }
}

/**
 * Group an already-ordered list into consecutive same-day runs.
 *
 * 🔴 THE KEY IS `startsAt.slice(0, 10)` — A SLICE OF THE STRING THE SERVER
 * SENT, NOT A PARSED DATE (RISK-AC). Parsing to a local `Date` would group by
 * the READER's timezone, so the same feed would break into different days for
 * two members, and a session at 23:00 UTC would jump a day for anyone east of
 * London. The server's own ordering already agrees with the UTC key, which is
 * what makes a single pass correct.
 *
 * ⚠️ CONSECUTIVE RUNS, NOT A `Map` OVER THE WHOLE LIST. The server's order is
 * authoritative (R2.1.4's rule, applied here) and a keyed regroup would
 * silently re-sort. If the server ever emitted a day out of order, this
 * produces two adjacent groups with the same heading — visible, rather than
 * quietly corrected.
 */
function groupByDay(items: readonly LiveFeedItem[]): readonly SessionDay[] {
  const days: SessionDay[] = [];

  for (const item of items) {
    const key = item.startsAt.slice(0, 10);
    const current = days[days.length - 1];

    if (current !== undefined && current.key === key) {
      (current.items as LiveFeedItem[]).push(item);
      continue;
    }

    days.push({ key, startsAt: item.startsAt, items: [item] });
  }

  return days;
}
