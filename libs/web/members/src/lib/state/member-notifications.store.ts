import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

import type { MemberNotification } from '@ptah-contracts/community';

import { MemberNotificationsApiService } from '../services/member-notifications-api.service';

/**
 * The unread-count poll cadence (R10.5, AD-14, ASSUMPTION-29).
 *
 * ⚠️ R10.5 SAYS "≥ 60 s" AND THIS IS EXACTLY 60 s, WITH NO BACKOFF. Adaptive
 * backoff is a second piece of state that disagrees with the first the moment a
 * tab is restored from the background — the interval says one thing, the last
 * successful fetch says another, and the badge is whichever one lost. The whole
 * design is this constant plus an eager fetch on every navigation.
 */
export const POLL_INTERVAL_MS = 60_000;

/**
 * The only route shape a stored notification is allowed to navigate to
 * (RISK-AO).
 *
 * ⚠️ IT REQUIRES THE TRAILING SLASH, AND THAT IS THE WHOLE POINT.
 * `/^\/members/` alone would admit `/members-evil` and — far worse —
 * `//evil.example`, which a browser reads as a PROTOCOL-RELATIVE ABSOLUTE URL,
 * not a path. Anchoring on `/members/` refuses both.
 */
const MEMBER_ROUTE_PREFIX = /^\/members\//;

/** Where a refused route lands instead. */
const NOTIFICATIONS_ROUTE = '/members/notifications';

/**
 * MemberNotificationsStore — ONE count, ONE timer, ONE route guard
 * (R10.4, R10.5, AD-14, RISK-AM, RISK-AO, RISK-AP).
 *
 * ⚠️ 🔴 THIS IS THE ONLY WRITER OF THE UNREAD COUNT IN THE PRODUCT (R9.3).
 * The nav badge reads `unreadCount()` through `MemberLayout`'s existing
 * `navGroups` computed and NOTHING ELSE reads it. `member-nav.config.ts` states
 * the prohibition in terms: a second badge mechanism means two things claim to
 * be "the unread count" and they disagree the first time one of them is missed.
 * `member-nav-badge.spec.ts` asserts the single reader structurally.
 *
 * ── 🔴 NO `providedIn`, AND THE RULE IS DISABLED FOR ONE LINE (RISK-AM) ────
 * A root-provided store with a 60 s timer OUTLIVES EVERYTHING: it fires after
 * sign-out (a `401` loop against an endpoint that will never succeed again), it
 * fires after the member leaves `/members` (a request from a page that is
 * gone), and in Jest it is an open handle that turns a suite which passes
 * locally into one that hangs in CI. This store is listed in the `/members`
 * route's own `providers`, so it dies with the panel. `providedIn: 'any'` would
 * be worse than `'root'`, because it would silently give each lazy route its
 * own copy — and its own poll — while looking global.
 *
 * ── 🔴 THE TIMER IS STARTED BY AN EXPLICIT `start()`, NEVER BY THE CONSTRUCTOR
 * A constructor-started poll means every `TestBed.inject` of this class begins
 * making requests, so a spec for something else fails on an unexpected request
 * it never asked for. `MemberLayout` calls `start()`; nothing else does, and
 * calling it twice is a no-op rather than a second timer.
 *
 * ── 🔴 AN EAGER FETCH ON EVERY NAVIGATION, FROM THE SAME SUBSCRIPTION ──────
 * R10.5/AD-14 want the count fresh when a member moves, not up to 60 s stale.
 * That is a `NavigationEnd` subscription inside this store — NOT a second timer,
 * and NOT a `refresh()` sprinkled through page constructors, which is how a
 * count acquires several callers and then several truths.
 *
 * ── 🔴 POLL ONLY. NO WEBSOCKET, NO SSE, NO PUSH (AD-14, RK-1) ─────────────
 * `libs/api/licensing` has an `@Sse` endpoint. It is neither imported nor
 * extended here, deliberately: the scope boundary is a poll, and a live channel
 * would be a second delivery mechanism for the same count.
 *
 * ── RISK-AP — the count cannot flicker ────────────────────────────────────
 * `markRead` decrements OPTIMISTICALLY, issues the write, and on success
 * REPLACES the count from the server's `unread-count`; on failure it restores
 * what it had. While a write is in flight the poll is SKIPPED — otherwise a
 * poll landing between the optimistic decrement and the server's commit reads
 * the old count, the badge ticks back up, and then down again a moment later.
 *
 * ── A FAILED REFRESH TELLS US NOTHING ABOUT THE COUNT ──────────────────────
 * An error from the poll leaves `unreadCount()` exactly as it was. Zeroing it
 * on failure would be the badge lying about the member's inbox because OUR
 * request failed.
 */
/*
 * ⚠️ NO `providedIn`, DELIBERATELY, AND THE RULE IS DISABLED FOR ONE LINE
 * RATHER THAN LOOSENED. `@angular-eslint/use-injectable-provided-in` exists to
 * stop a service being registered in an NgModule out of habit. This store is
 * the legitimate exception the rule cannot express — see RISK-AM in the class
 * docblock above, and `CoursePlayerStore`, which carries the same disable for
 * the same reason.
 */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- panel-scoped, provided by the /members route; a root singleton would outlive sign-out. See RISK-AM above.
@Injectable()
export class MemberNotificationsStore {
  private readonly api = inject(MemberNotificationsApiService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** The 60 s poll. `null` when not started, or after teardown. */
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * How many mark-read writes are in flight.
   *
   * ⚠️ A COUNTER, NOT A BOOLEAN, AND IT IS STILL NOT PREMATURE GENERALITY NOW
   * THAT THE BULK PATH IS ONE REQUEST. Concurrency did not go away, it moved:
   * a member opening several notifications quickly issues one `markRead` per
   * row, and those overlap. With a boolean the FIRST response would clear the
   * flag while the others were still outstanding, the poll would resume
   * mid-batch, and it would read a count the remaining writes had not yet
   * reduced — RISK-AP's flicker, arriving by the one door a boolean leaves
   * open. `openRoute` makes that the ordinary case, not an edge one.
   *
   * ⚠️ NOT A SIGNAL. Nothing renders it; making it one would invite a template
   * to show a spinner for a write the member should never have to wait on.
   */
  private inFlightWrites = 0;

  /**
   * A monotonic stamp that changes EVERY TIME THE SET OF IN-FLIGHT WRITES DOES
   * — one bump when a write is issued, one when it settles.
   *
   * ⚠️ 🔴 THIS IS WHAT MAKES "A COUNT READ IS ALREADY RUNNING" MEAN "IT IS
   * ABOUT TO DELIVER **THE SAME ANSWER**". The de-duplication below is only
   * sound for reads that are asking the SAME QUESTION. A read issued before a
   * write is asking a question the member has since changed the answer to, and
   * treating it as interchangeable with a read issued after that write is how
   * the badge ends up displaying the PRE-WRITE count.
   *
   * It is bumped on the write's ISSUE as well as its settle, deliberately: a
   * count read that was already outstanding when the member acted cannot be
   * trusted either, because the server may have committed the write before it
   * answered — and the two orderings are indistinguishable from here.
   *
   * ⚠️ IT IS ONLY EVER TOUCHED BY {@link beginWrite} AND {@link endWrite},
   * beside `inFlightWrites` itself, so a write path added later cannot acquire
   * one without the other. `member-notifications.store.spec.ts` asserts that
   * structurally.
   */
  private writeGeneration = 0;

  /** RISK-AP: the poll yields while any write is outstanding. */
  private get writing(): boolean {
    return this.inFlightWrites > 0;
  }

  /**
   * The generation the OUTSTANDING count read was issued in, or `null` when no
   * count read is in flight.
   *
   * ⚠️ 🔴 A GENERATION, NOT A BARE BOOLEAN, AND THE DIFFERENCE IS A REAL BUG.
   * This field exists because the panel fetched the count **TWICE** on every
   * entry, and only an e2e request census could see it: `start()` fetches
   * eagerly so the badge is populated on first paint, and it ALSO subscribes to
   * `NavigationEnd` so the count is fresh on every move. On the first load both
   * fire — the layout is constructed during route activation, and the router
   * emits `NavigationEnd` for that same navigation a moment later. Measured on
   * `/members/hub`, the member API call list read
   * `[unread-count, unread-count, hub]`.
   *
   * Neither half can simply be deleted — without the eager fetch the badge is
   * blank until the next navigation, and without the subscription it goes up to
   * 60 s stale. So the two are DE-DUPLICATED.
   *
   * 🔴 BUT A BARE `countInFlight` BOOLEAN SUPPRESSED A REFRESH THAT WAS NEEDED.
   * Shipped, reviewed, and reproduced: an eager count read is still outstanding
   * when the member marks something read; the write succeeds and asks for the
   * authoritative count; that ask is dropped because "one is already running";
   * the older read then lands and OVERWRITES THE BADGE WITH THE PRE-WRITE
   * NUMBER, where it stays for up to 60 s. A guard that suppresses a needed
   * fetch is worse than the duplicate it replaced.
   *
   * Stamping the read with {@link writeGeneration} is what tells the two cases
   * apart at the only moment the answer is knowable — when the response lands:
   *
   *   • SAME generation → the read answers the question that was asked, and a
   *     concurrent request would have returned the same number. Use it.
   *   • DIFFERENT generation → the write set changed underneath it, so the
   *     value is known-stale. DISCARD it (it never reaches the badge, so there
   *     is no flicker either) and re-issue EXACTLY ONE follow-up.
   *
   * The re-issue is bounded: a follow-up is stamped with the CURRENT generation
   * and can only be stale again if the member performs another write, so this
   * cannot loop.
   *
   * ⚠️ IT IS CLEARED IN BOTH THE `next` AND THE `error` PATH. Clearing only on
   * success would let one failed request wedge the badge permanently — the poll
   * would fire forever and return early every time.
   */
  private countReadGeneration: number | null = null;

  private readonly _unreadCount = signal(0);
  private readonly _items = signal<readonly MemberNotification[] | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  /**
   * The unread badge number (R10.4).
   *
   * 🔴 READ IN EXACTLY ONE PLACE — `MemberLayout`'s `navGroups` computed. See
   * the class docblock and `member-nav-badge.spec.ts`.
   */
  public readonly unreadCount = this._unreadCount.asReadonly();

  /** The current page of the inbox, in the SERVER'S order. Never re-sorted. */
  public readonly items = computed<readonly MemberNotification[]>(
    () => this._items() ?? [],
  );

  public readonly loading = this._loading.asReadonly();
  public readonly error = this._error.asReadonly();

  /** The server's echoed paging, or `null` before the first successful list. */
  private readonly _page = signal<{
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  } | null>(null);

  public readonly page = this._page.asReadonly();

  public constructor() {
    // ⚠️ TEARDOWN CLEARS THE HANDLE (RISK-AM). Without this the interval
    // survives the panel, the sign-out and the Jest suite.
    this.destroyRef.onDestroy(() => this.stop());
  }

  /**
   * Starts the count poll and the navigation-triggered refresh.
   *
   * ⚠️ CALLED BY `MemberLayout` AND BY NOTHING ELSE. Idempotent: a second call
   * does not create a second timer, because two timers is two cadences and the
   * failure would look like a badge that is merely "sometimes fast".
   */
  public start(): void {
    if (this.pollHandle !== null) return;

    this.refreshCount();
    this.pollHandle = setInterval(() => this.pollTick(), POLL_INTERVAL_MS);

    // 🔴 THE EAGER FETCH (R10.5, AD-14). ONE subscription, and it is bound to
    // THIS INSTANCE'S `DestroyRef` explicitly — `Router.events` never
    // completes, so an unbound subscription would keep firing `refreshCount()`
    // for a panel that no longer exists. That is the same leak class as the
    // interval, arriving through a different door.
    this.router.events
      .pipe(
        filter(
          (event): event is NavigationEnd => event instanceof NavigationEnd,
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.refreshCount());
  }

  /** Stops the poll. Safe to call when none is running. */
  public stop(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  /**
   * Loads a page of the inbox (R10.3).
   *
   * ⚠️ A FAILURE CLEARS THE ROWS AND SETS AN ERROR — it never renders as an
   * empty inbox. "You have no notifications" after a 500 tells a member nothing
   * happened; something may well have. `NotificationsPage` branches
   * error → loading → empty → list on exactly these three signals.
   */
  public refresh(page?: number, pageSize?: number): void {
    this._loading.set(true);
    this._error.set(null);

    this.api.list(page, pageSize).subscribe({
      next: (result) => {
        this._items.set(result.items);
        this._page.set({
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          hasMore: result.hasMore,
        });
        this._loading.set(false);
      },
      error: (error: unknown) => {
        this._loading.set(false);
        // Cleared, so a failed retry cannot leave stale rows under an error.
        this._items.set(null);
        this._error.set(
          error instanceof Error && error.message
            ? error.message
            : 'We could not load your notifications.',
        );
      },
    });
  }

  /**
   * Marks one notification read (R10.3), optimistically (RISK-AP).
   *
   * ⚠️ THE ORDER IS: DECREMENT, WRITE, RE-READ. The decrement is what makes the
   * badge move the instant the member acts rather than up to 60 s later; the
   * re-read is what makes the server the final authority; the restore on
   * failure is what stops a failed write leaving a count that is permanently
   * one too low.
   *
   * ⚠️ ALREADY-READ ROWS DO NOT DECREMENT. `readAt !== null` means this row was
   * never contributing to the count, and decrementing for it would drift the
   * badge below the truth — a member who opens the same notification twice
   * would lose two from a count that only ever owed one.
   */
  public markRead(id: string): void {
    const target = this.items().find((item) => item.id === id);
    if (target && target.readAt !== null) return;

    const before = this._unreadCount();

    this._unreadCount.set(Math.max(0, before - 1));
    this.markLocallyRead(id);
    this.beginWrite();

    this.api.markRead(id).subscribe({
      next: () => {
        this.endWrite();
        // The server is the authority. The optimistic value was a guess that
        // kept the UI honest for one round trip.
        this.refreshCount();
      },
      error: () => {
        this.endWrite();
        this._unreadCount.set(before);
        this.restoreLocallyUnread(id);
      },
    });
  }

  /**
   * Bulk mark-read (R9.7) — ONE request, not one per row.
   *
   * ⚠️ IT ZEROES THE COUNT OPTIMISTICALLY, because "read all" is unambiguous
   * about what the count becomes. It still re-reads afterwards: another tab, or
   * a reply that arrived a second ago, may have made the true answer non-zero.
   *
   * @param onSettled Called ONCE when the write settles — see
   * {@link markSelectedRead} for why a callback rather than a returned stream.
   */
  public markAllRead(onSettled?: (succeeded: boolean) => void): void {
    const before = this._unreadCount();
    const previous = this._items();

    this._unreadCount.set(0);
    this._items.set(
      this.items().map((item) =>
        item.readAt === null
          ? { ...item, readAt: new Date().toISOString() }
          : item,
      ),
    );
    this.beginWrite();

    this.api.markAllRead().subscribe({
      next: () => {
        this.endWrite();
        this.refreshCount();
        onSettled?.(true);
      },
      error: () => {
        this.endWrite();
        this._unreadCount.set(before);
        this._items.set(previous);
        onSettled?.(false);
      },
    });
  }

  /**
   * Marks a SELECTED SUBSET read — the notifications page's bulk action (R9.7).
   *
   * ── 🔴 THE PARTIAL SELECTION NOW COSTS ONE REQUEST, NOT N ─────────────────
   * `POST /v1/members/notifications/read` takes an id array and marks EXACTLY
   * those rows. Before it existed the server offered only `POST :id/read` (one
   * row) and `POST read-all` (THE ENTIRE INBOX), so a control whose entire
   * semantic is "act on the N things I selected" had no API that could honour
   * it, and the only safe implementation was N round trips.
   *
   * ── 🔴 THE EQUIVALENCE GUARD IS DELIBERATELY KEPT (USER DECISION) ─────────
   * `read-all` is STILL used when it is PROVABLY equivalent to the selection —
   * every unread row is selected AND the loaded page is the whole inbox
   * (`page 1`, `hasMore: false`, `total === items.length`).
   *
   * It would now be defensible to delete this branch and send every selection
   * through the bulk endpoint. It is kept because MARK-UNREAD WAS EXPLICITLY
   * CONSIDERED AND NOT ADDED, so every write on this path is IRREVERSIBLE, and
   * the two branches fail in opposite directions:
   *
   *   • `read-all` over-reaches if the page is not the whole inbox — which is
   *     exactly what the guard's three conditions test.
   *   • the bulk endpoint under-reaches harmlessly: an id that is absent,
   *     already read, or another member's contributes zero and is not an error.
   *
   * So the guard costs one comparison and its three pinning tests, and it means
   * the whole-inbox case is expressed as "all" to a server that can do it in
   * one statement, while every narrower case is expressed as "these" and can
   * touch nothing else. On an operation with no undo, belt-and-braces is the
   * correct trade, and deleting a working guard buys nothing but a smaller
   * diff.
   *
   * ── THE CAP CANNOT BE EXCEEDED FROM HERE, BY CONSTRUCTION ─────────────────
   * `targets` is a subset of `items()`, which is ONE page, and the server's
   * `MAX_BULK_MARK_READ_IDS` is DERIVED from `MAX_PAGE_SIZE` — so the largest
   * possible selection is exactly the cap and never more. No chunking is
   * written here, because a chunk loop on this path could never execute and
   * would be untestable dead code. {@link MemberNotificationsApiService}
   * nonetheless throws a `RangeError` on an over-cap array, so if that
   * derivation is ever broken the failure is loud rather than a silent `400`.
   *
   * ── 🔴 `onSettled` EXISTS SO THE SELECTION CAN OUTLIVE A FAILED WRITE ─────
   * The page used to clear the checkboxes SYNCHRONOUSLY on click. On a `500`
   * this store correctly restores the rows to unread and repairs the count —
   * but by then the toolbar was already gone, so the member watched the rows
   * silently un-strike-through with no control left to retry from and had to
   * re-select from scratch.
   *
   * ⚠️ A CALLBACK, NOT A RETURNED `Observable`. This method already subscribes
   * on the member's behalf; handing back a second cold stream would either
   * issue the write TWICE or require a `share()` whose lifetime is a third
   * thing to get wrong. It is optional, so every existing caller — and the
   * whole `markRead` path — stays fire-and-forget.
   *
   * @param onSettled Called ONCE with `true` when the rows are read on the
   * server (including the case where there was nothing to send), `false` when
   * the write failed and the optimistic state has been rolled back.
   */
  public markSelectedRead(
    ids: readonly string[],
    onSettled?: (succeeded: boolean) => void,
  ): void {
    const selected = new Set(ids);
    const unread = this.items().filter((item) => item.readAt === null);
    const targets = unread.filter((item) => selected.has(item.id));

    // Nothing to send is a SUCCESS, not a silent no-op: the selected rows are
    // already read, so there is nothing for the member to retry.
    if (targets.length === 0) {
      onSettled?.(true);
      return;
    }

    const paging = this._page();
    const pageIsWholeInbox =
      paging !== null &&
      paging.page === 1 &&
      !paging.hasMore &&
      paging.total === this.items().length;

    if (targets.length === unread.length && pageIsWholeInbox) {
      this.markAllRead(onSettled);
      return;
    }

    this.markManyRead(targets, onSettled);
  }

  /**
   * The bulk write for a PARTIAL selection — one request, optimistic, restored
   * on failure (RISK-AP).
   *
   * ⚠️ THE COUNT DROPS BY `targets.length`, NOT TO ZERO. This path exists
   * precisely because unread rows remain that the member did NOT select —
   * either elsewhere on this page or on a page they have never seen — so
   * zeroing here would be the badge claiming an empty inbox the member never
   * asked for and cannot restore.
   *
   * ⚠️ THE ROW SNAPSHOT IS TAKEN BEFORE ANY LOCAL MUTATION and restored whole
   * on failure, the way {@link markAllRead} does it. Restoring row by row would
   * have to know which rows this call changed, which is the state this snapshot
   * replaces.
   */
  private markManyRead(
    targets: readonly MemberNotification[],
    onSettled?: (succeeded: boolean) => void,
  ): void {
    const before = this._unreadCount();
    const previous = this._items();

    this._unreadCount.set(Math.max(0, before - targets.length));
    for (const target of targets) this.markLocallyRead(target.id);
    this.beginWrite();

    this.api.markManyRead(targets.map((target) => target.id)).subscribe({
      next: () => {
        this.endWrite();
        // The server is the authority; the optimistic value kept the UI honest
        // for one round trip. `{ marked }` is NOT read — it counts rows this
        // call moved, not the new unread total.
        this.refreshCount();
        onSettled?.(true);
      },
      error: () => {
        this.endWrite();
        this._unreadCount.set(before);
        this._items.set(previous);
        onSettled?.(false);
      },
    });
  }

  /**
   * Opens a notification: mark read, THEN navigate (R10.3).
   *
   * ── 🔴 RISK-AO — A STORED `route` IS NOT A TRUSTED ROUTE ──────────────────
   * `notification.route` is a SERVER-STORED STRING written at produce time and
   * FROZEN IN THE ROW. A stored absolute URL (`https://evil.example`), a
   * protocol-relative value (`//evil.example`, which a browser resolves as an
   * absolute cross-origin URL rather than a path), or any path outside
   * `/members/` would turn the inbox into an open redirect — and because the
   * value is frozen, every historical row would keep the hole open long after
   * the producer was fixed.
   *
   * This is the CLIENT half of a two-ended defence. The server builds the value
   * through `buildNotificationRoute` (RISK-AJ). NEITHER END MAY BE DROPPED ON
   * THE GROUNDS THAT THE OTHER EXISTS: a producer added later that forgets the
   * builder is one commit, and this check is what makes that commit harmless.
   *
   * A refused route still marks the notification read — the member DID open it
   * — and lands on the inbox rather than nowhere.
   */
  public openRoute(notification: MemberNotification): void {
    this.markRead(notification.id);

    const target = MEMBER_ROUTE_PREFIX.test(notification.route)
      ? notification.route
      : NOTIFICATIONS_ROUTE;

    if (target !== notification.route) {
      // Logged, not swallowed: a refused route means a producer wrote something
      // it should not have, and that is worth finding in a console.
      console.warn(
        `[notifications] refused a stored route outside /members/: ${notification.route}`,
      );
    }

    void this.router.navigateByUrl(target);
  }

  /**
   * Re-reads the badge from the server. The ONLY place the count is set from.
   *
   * ⚠️ CONCURRENT CALLS FOR THE SAME QUESTION COLLAPSE TO ONE REQUEST — see
   * {@link countReadGeneration}. The eager fetch in `start()` and the
   * `NavigationEnd` refresh both fire on the first panel load, and this is what
   * stops that costing two requests.
   *
   * 🔴 A CALL THAT IS SUPPRESSED IS NOT LOST. If the outstanding read was
   * issued in an older generation — i.e. the member has written something since
   * — that read is discarded when it lands and exactly one follow-up is issued
   * in its place. Dropping it outright is what left the badge showing the
   * pre-write count for up to 60 s.
   */
  public refreshCount(): void {
    if (this.countReadGeneration !== null) return;

    const generation = this.writeGeneration;
    this.countReadGeneration = generation;

    this.api.unreadCount().subscribe({
      next: (summary) => {
        this.countReadGeneration = null;
        if (generation !== this.writeGeneration) {
          // Known-stale: it was issued before a write the member has since
          // made. It never reaches the badge, so there is no flicker to
          // correct — only a re-read to issue.
          this.reissueStaleCount();
          return;
        }
        this._unreadCount.set(summary.unreadCount);
      },
      // ⚠️ THE VALUE IS DELIBERATELY UNTOUCHED. A failed refresh tells us
      // nothing about the count; zeroing it here would be the badge lying
      // because OUR request failed. The previous value stands until a request
      // succeeds. Only the stamp is cleared.
      error: () => {
        this.countReadGeneration = null;
        // A failed read still owes a follow-up if it was suppressing one: the
        // member's write must not lose its authoritative re-read merely
        // because an unrelated request happened to fail.
        if (generation !== this.writeGeneration) this.reissueStaleCount();
      },
    });
  }

  /* ---------------------------------------------------------------------- */

  /**
   * The single follow-up owed to a count read that turned out to be stale.
   *
   * ⚠️ IT YIELDS TO AN IN-FLIGHT WRITE, EXACTLY LIKE THE POLL DOES (RISK-AP).
   * Re-reading between a write's optimistic mutation and the server's commit is
   * the flicker this store exists to prevent — and it is not needed, because
   * that write's own success handler re-reads when it lands.
   */
  private reissueStaleCount(): void {
    if (this.writing) return;
    this.refreshCount();
  }

  /**
   * One write starts.
   *
   * ⚠️ 🔴 THE TWO COUNTERS MOVE TOGETHER, AND THAT IS THE WHOLE POINT OF THE
   * HELPER. `inFlightWrites` is what the poll yields to; `writeGeneration` is
   * what tells an outstanding count read that its answer is out of date. A
   * write path that incremented one and forgot the other would reintroduce
   * exactly the bug this pair fixes, and it would do it silently.
   */
  private beginWrite(): void {
    this.inFlightWrites += 1;
    this.writeGeneration += 1;
  }

  /** One write settles — success or failure, both change what the count is. */
  private endWrite(): void {
    this.inFlightWrites -= 1;
    this.writeGeneration += 1;
  }

  /** One poll tick — skipped entirely while a write is in flight (RISK-AP). */
  private pollTick(): void {
    if (this.writing) return;
    this.refreshCount();
  }

  private markLocallyRead(id: string): void {
    const current = this._items();
    if (current === null) return;

    this._items.set(
      current.map((item) =>
        item.id === id && item.readAt === null
          ? { ...item, readAt: new Date().toISOString() }
          : item,
      ),
    );
  }

  private restoreLocallyUnread(id: string): void {
    const current = this._items();
    if (current === null) return;

    this._items.set(
      current.map((item) =>
        item.id === id ? { ...item, readAt: null } : item,
      ),
    );
  }
}
