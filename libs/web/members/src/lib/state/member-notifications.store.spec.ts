import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  Injector,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import {
  MAX_BULK_MARK_READ_IDS,
  MAX_PAGE_SIZE,
} from '@ptah-contracts/community';

import {
  emptyNotificationPage,
  memberNotification,
  notificationPage,
} from '../notifications/notification-fixtures';
import {
  MemberNotificationsStore,
  POLL_INTERVAL_MS,
} from './member-notifications.store';

const NOTIFICATIONS = '/api/v1/members/notifications';
const UNREAD_COUNT = `${NOTIFICATIONS}/unread-count`;
const READ_ALL = `${NOTIFICATIONS}/read-all`;
/** "Mark THESE" — four segments, distinct from `${NOTIFICATIONS}/:id/read`. */
const BULK_READ = `${NOTIFICATIONS}/read`;

describe('MemberNotificationsStore (R10.4, R10.5, RISK-AM/AO/AP)', () => {
  let http: HttpTestingController;
  let navigate: jest.SpyInstance;

  /**
   * The store is provided in a CHILD ENVIRONMENT INJECTOR rather than in
   * `TestBed`'s root, so `destroy()` on that injector is a REAL teardown of
   * exactly this instance — which is what RISK-AM's assertion needs. Destroying
   * the whole `TestBed` would also tear down `HttpTestingController` and make
   * "no request after teardown" unfalsifiable.
   */
  let scope: ReturnType<typeof createEnvironmentInjector>;

  function makeStore(): MemberNotificationsStore {
    scope = createEnvironmentInjector(
      [MemberNotificationsStore],
      TestBed.inject(Injector) as never,
    );
    return runInInjectionContext(scope, () =>
      scope.get(MemberNotificationsStore),
    );
  }

  beforeEach(() => {
    jest.useFakeTimers();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    navigate = jest
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
  });

  afterEach(() => {
    http.verify();
    jest.useRealTimers();
  });

  /* ---------------------------------------------------------------------- */
  /* Construction is inert                                                   */
  /* ---------------------------------------------------------------------- */

  describe('🔴 the timer is started by start(), NEVER by the constructor', () => {
    it('constructing the store issues NO request', () => {
      makeStore();

      // A constructor-started poll makes every `inject()` of this class begin
      // making requests, so an unrelated spec fails on a request it never
      // asked for. `http.verify()` in `afterEach` is what proves the silence.
      http.verify();
    });

    it('constructing the store starts NO interval', () => {
      makeStore();

      jest.advanceTimersByTime(POLL_INTERVAL_MS * 3);
      http.verify();
    });

    it('start() fetches the count eagerly, once', () => {
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 4 });

      expect(store.unreadCount()).toBe(4);
    });

    it('start() twice does NOT create a second timer', () => {
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 1 });

      // The second call is a no-op — no eager fetch, no second interval. Two
      // timers is two cadences, and the symptom is a badge that is merely
      // "sometimes fast", which nobody files a bug for.
      store.start();
      http.verify();

      jest.advanceTimersByTime(POLL_INTERVAL_MS);
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 1 });
      http.verify();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* RISK-AM — the timer dies with the store                                 */
  /* ---------------------------------------------------------------------- */

  describe('🔴 RISK-AM — teardown clears the handle', () => {
    it('polls every 60 s while alive', () => {
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 0 });

      jest.advanceTimersByTime(POLL_INTERVAL_MS);
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 2 });
      expect(store.unreadCount()).toBe(2);

      jest.advanceTimersByTime(POLL_INTERVAL_MS);
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 3 });
      expect(store.unreadCount()).toBe(3);
    });

    it('does NOT poll before the interval elapses — the cadence is real', () => {
      // Anti-vacuity for the case above: without this, a poll that fired on
      // every timer tick of any length would satisfy it.
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 0 });

      jest.advanceTimersByTime(POLL_INTERVAL_MS - 1);
      http.verify();
    });

    it('🔴 after destroy, advancing PAST 60 s issues NO request', () => {
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 1 });

      scope.destroy();

      // A leaked 60 s poll fires after sign-out (a 401 loop against an
      // endpoint that will never succeed again) and after the member leaves
      // /members. `http.verify()` is what turns a stray request into a failure.
      jest.advanceTimersByTime(POLL_INTERVAL_MS * 5);
      http.verify();
    });

    it('🔴 after destroy, a NavigationEnd issues no request either', () => {
      // The interval is the obvious leak. The router subscription is the one
      // that arrives through a different door: `Router.events` never
      // completes, so an unbound subscription outlives the panel just as
      // surely as the timer does.
      const store = makeStore();
      const router = TestBed.inject(Router);

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 1 });

      scope.destroy();

      void router.navigateByUrl('/members/hub');
      jest.advanceTimersByTime(1);
      http.verify();
    });

    it('stop() is safe when nothing is running', () => {
      const store = makeStore();

      expect(() => store.stop()).not.toThrow();
      expect(() => store.stop()).not.toThrow();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The count never lies                                                    */
  /* ---------------------------------------------------------------------- */

  describe('🔴 a failed refresh must not clear the count', () => {
    it('a poll error leaves unreadCount() exactly as it was', () => {
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 7 });
      expect(store.unreadCount()).toBe(7);

      jest.advanceTimersByTime(POLL_INTERVAL_MS);
      http
        .expectOne(UNREAD_COUNT)
        .flush(null, { status: 500, statusText: 'Server Error' });

      // Zeroing here would be the badge lying about the member's inbox because
      // OUR request failed. A failed refresh tells us nothing about the count.
      expect(store.unreadCount()).toBe(7);
    });

    it('a malformed count body also leaves the count alone', () => {
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 5 });

      jest.advanceTimersByTime(POLL_INTERVAL_MS);
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 'many' });

      expect(store.unreadCount()).toBe(5);
    });

    it('the poll recovers on the NEXT tick after a failure', () => {
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 7 });

      jest.advanceTimersByTime(POLL_INTERVAL_MS);
      http
        .expectOne(UNREAD_COUNT)
        .flush(null, { status: 500, statusText: 'Server Error' });

      jest.advanceTimersByTime(POLL_INTERVAL_MS);
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 1 });

      expect(store.unreadCount()).toBe(1);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R10.5 / AD-14 — the eager fetch on navigation                           */
  /* ---------------------------------------------------------------------- */

  describe('R10.5 / AD-14 — an eager fetch on every navigation', () => {
    it('a NavigationEnd refreshes the count without waiting for the poll', async () => {
      const store = makeStore();
      const router = TestBed.inject(Router);
      navigate.mockRestore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 0 });

      await router.navigateByUrl('/');
      // Not a second timer — the same subscription. A `refresh()` sprinkled
      // through page constructors is how a count acquires several callers and
      // then several truths.
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 9 });

      expect(store.unreadCount()).toBe(9);
    });

    it('navigation before start() refreshes nothing', async () => {
      makeStore();
      const router = TestBed.inject(Router);
      navigate.mockRestore();

      await router.navigateByUrl('/');
      http.verify();
    });

    /* -- 🔴 The double-fetch this batch found with an e2e request census -- */

    it('🔴 start() PLUS an immediate NavigationEnd costs ONE request, not two', () => {
      // 🔴 THE BUG THIS GUARDS, AND IT SHIPPED. In the real panel `start()` runs
      // during route activation — so its eager fetch is still in flight when
      // the router emits `NavigationEnd` for that SAME navigation, and the
      // count was fetched twice on every entry to the panel. Measured live on
      // `/members/hub`, the member API calls read
      // `[unread-count, unread-count, hub]`.
      //
      // Neither half could be deleted: without the eager fetch the badge is
      // blank until the next navigation, and without the subscription it goes
      // up to 60 s stale. So they de-duplicate.
      const store = makeStore();

      store.start();
      // The eager fetch, deliberately NOT flushed — it is still outstanding,
      // exactly as it is when the router emits.
      const first = http.expectOne(UNREAD_COUNT);

      store.refreshCount();

      // 🔴 STILL EXACTLY ONE. A second request here is the defect.
      expect(http.match(UNREAD_COUNT)).toHaveLength(0);

      first.flush({ unreadCount: 4 });
      expect(store.unreadCount()).toBe(4);
    });

    it('once the first settles, a later refresh DOES issue a new request', () => {
      // Anti-vacuity, and the assertion that stops the guard becoming a
      // permanent mute: de-duplication must last exactly as long as the
      // request, not for the life of the store.
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 1 });

      store.refreshCount();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 2 });

      expect(store.unreadCount()).toBe(2);
    });

    it('🔴 a FAILED count clears the guard — one failure cannot wedge the badge', () => {
      // 🔴 THE FAILURE MODE OF THE FIX ITSELF. Clearing the flag only on
      // success would mean a single 500 left every later refresh returning
      // early: the poll would fire forever and the badge would never move
      // again. That is worse than the double request it replaced.
      const store = makeStore();

      store.start();
      http
        .expectOne(UNREAD_COUNT)
        .flush(null, { status: 500, statusText: 'Server Error' });

      store.refreshCount();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 7 });

      expect(store.unreadCount()).toBe(7);
    });

    it('🔴 the POLL is not swallowed by a stuck guard either', () => {
      // The same property, reached through the timer rather than through an
      // explicit call — this is the path that would silently stop working.
      const store = makeStore();

      store.start();
      http
        .expectOne(UNREAD_COUNT)
        .flush(null, { status: 503, statusText: 'Unavailable' });

      jest.advanceTimersByTime(POLL_INTERVAL_MS);
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 3 });

      expect(store.unreadCount()).toBe(3);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 A STALE COUNT READ CANNOT OVERWRITE A POST-WRITE COUNT               */
  /* ---------------------------------------------------------------------- */

  describe('🔴 the de-duplication must not DROP a refresh that is needed', () => {
    /** Loads `ids` as unread rows so the bulk paths have something to act on. */
    function load(
      store: MemberNotificationsStore,
      ids: readonly string[],
      paging?: { total?: number; hasMore?: boolean; page?: number },
    ): void {
      store.refresh();
      http.expectOne(NOTIFICATIONS).flush(
        notificationPage(
          ids.map((id) => memberNotification({ id })),
          paging,
        ),
      );
    }

    it('🔴 an in-flight count read at the moment of a write cannot land as the badge', () => {
      // 🔴 THE ORDERING THE REVIEW REPRODUCED, AND THE REASON THE DE-DUP GUARD
      // IS A GENERATION RATHER THAN A BARE BOOLEAN. With a bare `countInFlight`
      // this sequence ended with the badge reading 99 — the PRE-WRITE count —
      // and nothing corrected it until the next poll tick (up to 60 s) or the
      // next navigation. A guard that suppresses a needed fetch is worse than
      // the duplicate it replaced.
      const store = makeStore();

      store.start();
      // The eager fetch, deliberately left OUTSTANDING — exactly where it is
      // when a member acts on a notification just after the panel opens.
      const stale = http.expectOne(UNREAD_COUNT);

      store.markRead('n1');
      http.expectOne(`${NOTIFICATIONS}/n1/read`).flush({ readAt: 'x' });

      // The write's own `refreshCount()` is still suppressed here — two
      // concurrent reads of the same endpoint remain exactly what the guard is
      // for, and 15B's measured `[unread-count, unread-count, hub]` must not
      // come back.
      expect(http.match(UNREAD_COUNT)).toHaveLength(0);

      stale.flush({ unreadCount: 99 });

      // 🔴 DISCARDED, NOT DISPLAYED. It never reaches the badge, so there is no
      // flicker to correct either.
      expect(store.unreadCount()).not.toBe(99);

      // 🔴 AND THE SUPPRESSED REFRESH IS RE-ISSUED — EXACTLY ONCE.
      const followUp = http.match(UNREAD_COUNT);
      expect(followUp).toHaveLength(1);

      followUp[0].flush({ unreadCount: 2 });
      expect(store.unreadCount()).toBe(2);
    });

    it('🔴 the same ordering through the BULK write', () => {
      // The generation is bumped by `beginWrite`/`endWrite`, so every write
      // path inherits the property. Asserted per path rather than argued: a
      // future path that increments the write counter directly would pass a
      // structural check on `markRead` alone.
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 5 });
      load(store, ['n1', 'n2', 'n3'], { total: 30, hasMore: true });

      // A poll read, in flight and unanswered.
      jest.advanceTimersByTime(POLL_INTERVAL_MS);
      const stale = http.expectOne(UNREAD_COUNT);

      store.markSelectedRead(['n1']);
      expect(store.unreadCount()).toBe(4);
      http.expectOne(BULK_READ).flush({ marked: 1 });

      // The server's pre-write answer arrives late. Accepting it would tick the
      // badge back up to 5 with the row already struck through.
      stale.flush({ unreadCount: 5 });
      expect(store.unreadCount()).toBe(4);

      const followUp = http.match(UNREAD_COUNT);
      expect(followUp).toHaveLength(1);
      followUp[0].flush({ unreadCount: 4 });
      expect(store.unreadCount()).toBe(4);
    });

    it('🔴 the same ordering through markAllRead', () => {
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 6 });

      jest.advanceTimersByTime(POLL_INTERVAL_MS);
      const stale = http.expectOne(UNREAD_COUNT);

      store.markAllRead();
      http.expectOne(READ_ALL).flush({ marked: 6 });

      stale.flush({ unreadCount: 6 });
      // "Read all" is unambiguous about what the count becomes; a late 6 would
      // be the badge claiming the inbox the member just emptied is still full.
      expect(store.unreadCount()).toBe(0);

      const followUp = http.match(UNREAD_COUNT);
      expect(followUp).toHaveLength(1);
      followUp[0].flush({ unreadCount: 0 });
    });

    it('🔴 a stale read that lands DURING the write is discarded and NOT re-issued (RISK-AP)', () => {
      // The follow-up yields to an outstanding write for the same reason the
      // poll does: a read between the optimistic decrement and the server's
      // commit reads the OLD count. The write's own success handler is what
      // re-reads, so nothing is owed here.
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 5 });

      jest.advanceTimersByTime(POLL_INTERVAL_MS);
      const stale = http.expectOne(UNREAD_COUNT);

      store.markRead('n1');
      const write = http.expectOne(`${NOTIFICATIONS}/n1/read`);
      expect(store.unreadCount()).toBe(4);

      stale.flush({ unreadCount: 5 });
      expect(store.unreadCount()).toBe(4);
      http.expectNone(UNREAD_COUNT);

      write.flush({ readAt: 'x' });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 4 });
      expect(store.unreadCount()).toBe(4);
    });

    it('🔴 a stale read that FAILS still owes the follow-up', () => {
      // The write's authoritative re-read must not be lost merely because the
      // unrelated request that was suppressing it happened to 500.
      const store = makeStore();

      store.start();
      const stale = http.expectOne(UNREAD_COUNT);

      store.markRead('n1');
      http.expectOne(`${NOTIFICATIONS}/n1/read`).flush({ readAt: 'x' });

      stale.flush(null, { status: 500, statusText: 'Server Error' });

      const followUp = http.match(UNREAD_COUNT);
      expect(followUp).toHaveLength(1);
      followUp[0].flush({ unreadCount: 3 });
      expect(store.unreadCount()).toBe(3);
    });

    it('🔴 the follow-up settles the matter — it does not re-issue forever', () => {
      // Anti-loop. A follow-up is stamped with the CURRENT generation, so it is
      // only ever stale again if the member writes again. `http.verify()` in
      // `afterEach` is what proves the chain stopped.
      const store = makeStore();

      store.start();
      const stale = http.expectOne(UNREAD_COUNT);

      store.markRead('n1');
      http.expectOne(`${NOTIFICATIONS}/n1/read`).flush({ readAt: 'x' });
      stale.flush({ unreadCount: 99 });

      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 1 });
      expect(store.unreadCount()).toBe(1);
      http.verify();
    });

    it('🔴 the write counter and the generation are mutated in ONE place each', () => {
      // 🔴 THE INVARIANT A FUTURE WRITE PATH COULD BREAK SILENTLY. The poll
      // yields to `inFlightWrites`; a suppressed count read is rescued by
      // `writeGeneration`. A path that bumped one and forgot the other would
      // reintroduce exactly the dropped-refresh bug — so both live in
      // `beginWrite`/`endWrite` and nowhere else.
      const { readFileSync } = require('node:fs') as typeof import('node:fs');
      const source = readFileSync(
        `${__dirname}/member-notifications.store.ts`,
        'utf8',
      );
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      const occurrences = (pattern: RegExp): number =>
        (code.match(pattern) ?? []).length;

      // Anti-vacuity: a rename that made every pattern below zero would
      // otherwise pass the whole test.
      expect(occurrences(/this\.inFlightWrites/g)).toBeGreaterThan(1);
      expect(occurrences(/this\.writeGeneration/g)).toBeGreaterThan(1);

      expect(occurrences(/this\.inFlightWrites \+= 1/g)).toBe(1);
      expect(occurrences(/this\.inFlightWrites -= 1/g)).toBe(1);
      expect(occurrences(/this\.writeGeneration \+= 1/g)).toBe(2);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* RISK-AO — a stored route is not a trusted route                         */
  /* ---------------------------------------------------------------------- */

  describe('🔴 RISK-AO — openRoute refuses a route outside /members/', () => {
    // The refusal LOGS by design, and these cases exercise it deliberately.
    // Silenced here so the intended warnings do not drown the run; the one
    // test that asserts the log installs its own spy.
    let quiet: jest.SpyInstance;

    beforeEach(() => {
      quiet = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => quiet.mockRestore());

    const cases: ReadonlyArray<{
      readonly route: string;
      readonly navigatesTo: string;
      readonly why: string;
    }> = [
      {
        route: 'https://evil.example',
        navigatesTo: '/members/notifications',
        why: 'an absolute URL stored in the row is an open redirect',
      },
      {
        route: '//evil.example',
        navigatesTo: '/members/notifications',
        why: 'protocol-relative — a browser reads this as absolute, not as a path',
      },
      {
        route: '/admin/users',
        navigatesTo: '/members/notifications',
        why: 'inside the app but outside the member panel',
      },
      {
        route: '/members-evil/x',
        navigatesTo: '/members/notifications',
        why: 'the trailing slash is what stops a prefix match admitting this',
      },
      {
        route: '/members/community/topics/b15a-topic',
        navigatesTo: '/members/community/topics/b15a-topic',
        why: 'the real value the live producer wrote — measured on :3011',
      },
    ];

    it.each(cases)(
      'route $route → $navigatesTo ($why)',
      ({ route, navigatesTo }) => {
        const store = makeStore();

        store.openRoute(memberNotification({ id: 'n1', route }));
        http.expectOne(`${NOTIFICATIONS}/n1/read`).flush({ readAt: 'x' });
        http.expectOne(UNREAD_COUNT).flush({ unreadCount: 0 });

        expect(navigate).toHaveBeenCalledWith(navigatesTo);
      },
    );

    it('a refused route is LOGGED, not swallowed', () => {
      // A refused route means a producer wrote something it should not have.
      // Silently redirecting hides a server-side defect that the two-ended
      // defence exists to make survivable, not invisible.
      const store = makeStore();

      store.openRoute(
        memberNotification({ id: 'n1', route: '//evil.example' }),
      );
      http.expectOne(`${NOTIFICATIONS}/n1/read`).flush({ readAt: 'x' });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 0 });

      expect(quiet).toHaveBeenCalledWith(
        expect.stringContaining('//evil.example'),
      );
    });

    it('an ACCEPTED route logs nothing — the warning is not unconditional', () => {
      // Anti-vacuity for the case above: a `console.warn` on every open would
      // satisfy it and would make the log useless as a signal.
      const store = makeStore();

      store.openRoute(memberNotification({ id: 'n1' }));
      http.expectOne(`${NOTIFICATIONS}/n1/read`).flush({ readAt: 'x' });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 0 });

      expect(quiet).not.toHaveBeenCalled();
    });

    it('a refused route STILL marks the notification read', () => {
      // The member did open it. Refusing the navigation must not also refuse
      // the read, or the badge would stay lit for a row they have seen.
      const store = makeStore();

      store.openRoute(
        memberNotification({ id: 'n1', route: 'https://evil.example' }),
      );

      http.expectOne(`${NOTIFICATIONS}/n1/read`).flush({ readAt: 'x' });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 0 });
    });

    it('marks read BEFORE navigating (R10.3 order)', () => {
      // 🔴 ASSERTED FROM INSIDE THE NAVIGATION, NOT BY BOOKKEEPING AFTERWARDS.
      // Recording "navigate happened" and "write happened" into an array from
      // the test body proves only the order the TEST did things in. The real
      // question is whether the write had already been ISSUED at the moment
      // navigation was requested — because navigating first is how a member
      // leaves the page before the mark-read is sent, and the row stays unread.
      const store = makeStore();
      let writePendingAtNavigation: number | null = null;

      navigate.mockImplementation(() => {
        writePendingAtNavigation = http.match(
          `${NOTIFICATIONS}/n1/read`,
        ).length;
        return Promise.resolve(true);
      });

      store.openRoute(memberNotification({ id: 'n1' }));

      expect(writePendingAtNavigation).toBe(1);

      // `http.match` above already consumed the request, so only the
      // count re-read remains outstanding once it is answered.
      http.expectNone(`${NOTIFICATIONS}/n1/read`);
      http.verify();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* RISK-AP — the count cannot flicker                                      */
  /* ---------------------------------------------------------------------- */

  describe('🔴 RISK-AP — markRead is optimistic and the poll yields to it', () => {
    it('decrements the moment the member acts, before the server answers', () => {
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 3 });

      store.markRead('n1');

      // Not "after the round trip" — immediately. If the badge only moved on
      // the 60 s poll it would stay stale for up to a minute after the member
      // acted, which reads as the product ignoring them.
      expect(store.unreadCount()).toBe(2);

      http.expectOne(`${NOTIFICATIONS}/n1/read`).flush({ readAt: 'x' });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 2 });
      expect(store.unreadCount()).toBe(2);
    });

    it('🔴 the poll is SKIPPED while a write is in flight — no flicker', () => {
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 3 });

      store.markRead('n1');
      expect(store.unreadCount()).toBe(2);

      // The write is left UNFLUSHED — B13's F-4 regression shape. A poll that
      // landed here would read the server's PRE-write count of 3, tick the
      // badge back up, and then down again when the write committed.
      const write = http.expectOne(`${NOTIFICATIONS}/n1/read`);
      jest.advanceTimersByTime(POLL_INTERVAL_MS * 2);

      http.verify();
      expect(store.unreadCount()).toBe(2);

      write.flush({ readAt: 'x' });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 2 });
      expect(store.unreadCount()).toBe(2);
    });

    it('the server REPLACES the count on success — it is the authority', () => {
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 3 });

      store.markRead('n1');
      expect(store.unreadCount()).toBe(2);

      http.expectOne(`${NOTIFICATIONS}/n1/read`).flush({ readAt: 'x' });
      // Another tab marked two more read in the meantime. The optimistic value
      // was a guess that kept the UI honest for one round trip; this is truth.
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 0 });

      expect(store.unreadCount()).toBe(0);
    });

    it('🔴 a FAILED write restores the count', () => {
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 3 });

      store.markRead('n1');
      expect(store.unreadCount()).toBe(2);

      http
        .expectOne(`${NOTIFICATIONS}/n1/read`)
        .flush(null, { status: 500, statusText: 'Server Error' });

      // Without the restore, a failed write leaves the badge permanently one
      // too low and the member never learns the row is still unread.
      expect(store.unreadCount()).toBe(2 + 1);
    });

    it('a failed write restores the row to unread as well', () => {
      const store = makeStore();

      store.refresh();
      http
        .expectOne(NOTIFICATIONS)
        .flush(notificationPage([memberNotification({ id: 'n1' })]));

      store.markRead('n1');
      expect(store.items()[0].readAt).not.toBeNull();

      http
        .expectOne(`${NOTIFICATIONS}/n1/read`)
        .flush(null, { status: 500, statusText: 'Server Error' });

      expect(store.items()[0].readAt).toBeNull();
    });

    it('the poll resumes after the write settles', () => {
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 3 });

      store.markRead('n1');
      http.expectOne(`${NOTIFICATIONS}/n1/read`).flush({ readAt: 'x' });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 2 });

      jest.advanceTimersByTime(POLL_INTERVAL_MS);
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 2 });
      http.verify();
    });

    it('the count never goes below zero', () => {
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 0 });

      store.markRead('n1');
      expect(store.unreadCount()).toBe(0);

      http.expectOne(`${NOTIFICATIONS}/n1/read`).flush({ readAt: 'x' });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 0 });
    });

    it('🔴 an ALREADY-READ row does not decrement', () => {
      // `readAt !== null` means the row was never contributing to the count.
      // Decrementing for it would drift the badge below the truth — opening
      // the same notification twice would take two from a count owing one.
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 3 });

      store.refresh();
      http
        .expectOne(NOTIFICATIONS)
        .flush(
          notificationPage([
            memberNotification({
              id: 'n1',
              readAt: '2026-08-10T00:00:00.000Z',
            }),
          ]),
        );

      store.markRead('n1');

      expect(store.unreadCount()).toBe(3);
      http.verify();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Bulk mark-read                                                          */
  /* ---------------------------------------------------------------------- */

  describe('markAllRead (R9.7)', () => {
    it('issues ONE request, not one per row', () => {
      const store = makeStore();

      store.refresh();
      http
        .expectOne(NOTIFICATIONS)
        .flush(
          notificationPage([
            memberNotification({ id: 'n1' }),
            memberNotification({ id: 'n2' }),
            memberNotification({ id: 'n3' }),
          ]),
        );

      store.markAllRead();

      // N requests would spend the member's throttle budget on one click and
      // could leave the inbox partially read if any of them failed.
      http.expectOne(`${NOTIFICATIONS}/read-all`).flush({ marked: 3 });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 0 });
      http.verify();
    });

    it('zeroes optimistically and still re-reads the server', () => {
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 4 });

      store.markAllRead();
      expect(store.unreadCount()).toBe(0);

      http.expectOne(`${NOTIFICATIONS}/read-all`).flush({ marked: 4 });
      // Another tab, or a reply that arrived a second ago, may have made the
      // true answer non-zero — so the server still gets the last word.
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 1 });

      expect(store.unreadCount()).toBe(1);
    });

    it('a failure restores both the count and the rows', () => {
      const store = makeStore();

      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 2 });

      store.refresh();
      const before = notificationPage([
        memberNotification({ id: 'n1' }),
        memberNotification({ id: 'n2' }),
      ]);
      http.expectOne(NOTIFICATIONS).flush(before);

      store.markAllRead();
      http
        .expectOne(`${NOTIFICATIONS}/read-all`)
        .flush(null, { status: 500, statusText: 'Server Error' });

      expect(store.unreadCount()).toBe(2);
      expect(store.items().every((item) => item.readAt === null)).toBe(true);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 markSelectedRead — "these N", in ONE request (R9.7, Batch 15B)        */
  /* ---------------------------------------------------------------------- */

  describe('🔴 markSelectedRead — the bulk endpoint and the kept guard', () => {
    /** Loads `ids` as unread rows, with paging the caller controls. */
    function load(
      store: MemberNotificationsStore,
      ids: readonly string[],
      paging?: { total?: number; hasMore?: boolean; page?: number },
    ): void {
      store.refresh();
      http.expectOne(NOTIFICATIONS).flush(
        notificationPage(
          ids.map((id) => memberNotification({ id })),
          paging,
        ),
      );
    }

    it('🔴 a PARTIAL selection is ONE request naming exactly those ids', () => {
      const store = makeStore();
      load(store, ['n1', 'n2', 'n3']);

      store.markSelectedRead(['n1', 'n3']);

      // 🔴 NOT `read-all`, and NOT one `:id/read` per row. Both of those were
      // the shapes this endpoint replaced.
      http.expectNone(READ_ALL);
      http.expectNone(`${NOTIFICATIONS}/n1/read`);
      http.expectNone(`${NOTIFICATIONS}/n3/read`);

      const bulk = http.expectOne(BULK_READ);
      expect(bulk.request.method).toBe('POST');
      expect(bulk.request.body).toEqual({ ids: ['n1', 'n3'] });
      bulk.flush({ marked: 2 });

      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 1 });
    });

    it('🔴 the SELECTION ORDER does not leak — the ids follow the loaded rows', () => {
      // The page hands over a `Set`'s iteration order, which is insertion
      // order, i.e. the order the member ticked boxes. The request is built
      // from `items()` instead, so the body is stable for a given page
      // regardless of how the member got there. A body that varied with click
      // order would make this assertion — and any server-side log diffing —
      // flaky for no reason.
      const store = makeStore();
      load(store, ['n1', 'n2', 'n3']);

      store.markSelectedRead(['n3', 'n1']);

      expect(http.expectOne(BULK_READ).request.body).toEqual({
        ids: ['n1', 'n3'],
      });
    });

    it('ids that are not on the page are dropped before the request', () => {
      // The store filters the selection against the rows it actually holds, so
      // a stale id from a previous page can never reach the server. It would be
      // harmless there (absent ids contribute zero and are not an error), but
      // sending it would be the client describing something the member did not
      // do.
      const store = makeStore();
      load(store, ['n1', 'n2', 'n3']);

      store.markSelectedRead(['n1', 'ghost-id']);

      expect(http.expectOne(BULK_READ).request.body).toEqual({ ids: ['n1'] });
    });

    it('already-read rows are dropped — they were never in the count', () => {
      const store = makeStore();
      store.refresh();
      http
        .expectOne(NOTIFICATIONS)
        .flush(
          notificationPage(
            [
              memberNotification({ id: 'n1' }),
              memberNotification({
                id: 'n2',
                readAt: '2026-08-01T00:00:00.000Z',
              }),
              memberNotification({ id: 'n3' }),
            ],
            { total: 3 },
          ),
        );

      store.markSelectedRead(['n1', 'n2']);

      // `n2` is already read. Including it would not corrupt anything server
      // side, but the optimistic decrement below would be one too large.
      expect(http.expectOne(BULK_READ).request.body).toEqual({ ids: ['n1'] });
    });

    it('🔴 the count drops by the SELECTION SIZE, not to zero', () => {
      const store = makeStore();
      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 9 });
      load(store, ['n1', 'n2', 'n3'], { total: 9, hasMore: true });

      store.markSelectedRead(['n1', 'n2']);

      // 🔴 Zeroing here would claim an inbox the member never emptied and
      // cannot restore — there is no mark-unread.
      expect(store.unreadCount()).toBe(7);

      http.expectOne(BULK_READ).flush({ marked: 2 });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 7 });
      expect(store.unreadCount()).toBe(7);
    });

    it('🔴 `{ marked }` is NOT read as the new count — the server is re-read', () => {
      const store = makeStore();
      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 5 });
      load(store, ['n1', 'n2', 'n3'], { total: 5, hasMore: true });

      store.markSelectedRead(['n1']);

      // A deliberately absurd `marked`. If anything parsed it as the count,
      // the badge would read 99 instead of the server's 4.
      http.expectOne(BULK_READ).flush({ marked: 99 });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 4 });

      expect(store.unreadCount()).toBe(4);
    });

    it('a failure restores BOTH the count and the rows', () => {
      const store = makeStore();
      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 6 });
      load(store, ['n1', 'n2', 'n3'], { total: 6, hasMore: true });

      store.markSelectedRead(['n1', 'n2']);
      expect(store.unreadCount()).toBe(4);

      http
        .expectOne(BULK_READ)
        .flush(null, { status: 500, statusText: 'Server Error' });

      expect(store.unreadCount()).toBe(6);
      expect(store.items().every((item) => item.readAt === null)).toBe(true);
    });

    it('🔴 the poll is SKIPPED while the bulk write is in flight (RISK-AP)', () => {
      const store = makeStore();
      store.start();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 4 });
      load(store, ['n1', 'n2', 'n3'], { total: 4, hasMore: true });

      store.markSelectedRead(['n1']);
      const bulk = http.expectOne(BULK_READ);

      // A poll landing between the optimistic decrement and the server's
      // commit reads the OLD count: the badge ticks back up, then down.
      jest.advanceTimersByTime(POLL_INTERVAL_MS);
      http.expectNone(UNREAD_COUNT);

      bulk.flush({ marked: 1 });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 3 });
    });

    it('an empty selection issues NOTHING — it never becomes "mark all"', () => {
      // 🔴 The server answers `400` to an empty array on purpose, and the API
      // service throws before sending one. Neither may ever be reached from
      // here: "these, where these is empty" must not become "all".
      const store = makeStore();
      load(store, ['n1', 'n2']);

      expect(() => store.markSelectedRead([])).not.toThrow();

      http.expectNone(BULK_READ);
      http.expectNone(READ_ALL);
    });

    /* -- 🔴 THE KEPT EQUIVALENCE GUARD (user decision) -------------------- */

    describe('🔴 the read-all guard is KEPT even though the bulk endpoint exists', () => {
      it('every unread row on a WHOLE-INBOX page still uses read-all', () => {
        const store = makeStore();
        load(store, ['n1', 'n2'], { total: 2, hasMore: false, page: 1 });

        store.markSelectedRead(['n1', 'n2']);

        http.expectNone(BULK_READ);
        http.expectOne(READ_ALL).flush({ marked: 2 });
        http.expectOne(UNREAD_COUNT).flush({ unreadCount: 0 });
      });

      it('🔴 hasMore:true defeats it — unseen pages hold unread rows', () => {
        const store = makeStore();
        load(store, ['n1', 'n2'], { total: 30, hasMore: true });

        store.markSelectedRead(['n1', 'n2']);

        http.expectNone(READ_ALL);
        expect(http.expectOne(BULK_READ).request.body).toEqual({
          ids: ['n1', 'n2'],
        });
      });

      it('🔴 a total larger than the rows held defeats it', () => {
        // `hasMore` alone is not enough. A page that is honestly the last one
        // but does not hold the whole inbox must not be treated as "all".
        const store = makeStore();
        load(store, ['n1', 'n2'], { total: 9, hasMore: false });

        store.markSelectedRead(['n1', 'n2']);

        http.expectNone(READ_ALL);
        expect(http.expectOne(BULK_READ).request.body).toEqual({
          ids: ['n1', 'n2'],
        });
      });

      it('🔴 page 2 defeats it even when it holds every remaining row', () => {
        const store = makeStore();
        load(store, ['n1', 'n2'], { total: 2, hasMore: false, page: 2 });

        store.markSelectedRead(['n1', 'n2']);

        http.expectNone(READ_ALL);
        expect(http.expectOne(BULK_READ).request.body).toEqual({
          ids: ['n1', 'n2'],
        });
      });
    });

    /* -- The cap, which cannot be exceeded from here ---------------------- */

    it('🔴 a FULL page selection is one request and sits exactly at the cap', () => {
      // 🔴 THE DERIVATION, ASSERTED RATHER THAN ARGUED. `MAX_BULK_MARK_READ_IDS`
      // is `MAX_PAGE_SIZE`, and a selection is a subset of ONE page — so the
      // largest selection reachable from this store is exactly the cap, never
      // more, and no chunk loop is needed (one would be untestable dead code).
      expect(MAX_BULK_MARK_READ_IDS).toBe(MAX_PAGE_SIZE);

      const ids = Array.from({ length: MAX_PAGE_SIZE }, (_, i) => `n${i}`);
      const store = makeStore();
      load(store, ids, { total: 120, hasMore: true });

      store.markSelectedRead(ids);

      const bulk = http.expectOne(BULK_READ);
      expect((bulk.request.body as { ids: string[] }).ids).toHaveLength(
        MAX_BULK_MARK_READ_IDS,
      );
      bulk.flush({ marked: MAX_PAGE_SIZE });
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: 70 });
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The list                                                                */
  /* ---------------------------------------------------------------------- */

  describe('refresh — the inbox list', () => {
    it('holds the server order and the server’s echoed paging', () => {
      const store = makeStore();

      store.refresh(2, 10);
      http.expectOne(`${NOTIFICATIONS}?page=2&pageSize=10`).flush(
        notificationPage([memberNotification()], {
          page: 2,
          pageSize: 10,
          total: 30,
          hasMore: true,
        }),
      );

      expect(store.items()).toHaveLength(1);
      expect(store.page()).toEqual({
        page: 2,
        pageSize: 10,
        total: 30,
        hasMore: true,
      });
      expect(store.error()).toBeNull();
      expect(store.loading()).toBe(false);
    });

    it('🔴 a failure sets an error and CLEARS the rows — never an empty inbox', () => {
      const store = makeStore();

      store.refresh();
      http.expectOne(NOTIFICATIONS).flush(notificationPage());
      expect(store.items()).toHaveLength(1);

      store.refresh();
      http
        .expectOne(NOTIFICATIONS)
        .flush(null, { status: 500, statusText: 'Server Error' });

      // Stale rows under an error banner is B7.1's My Threads rule, and
      // "you have no notifications" after a 500 is the same lie in the other
      // direction.
      expect(store.items()).toEqual([]);
      expect(store.error()).toBe('We could not load your notifications.');
    });

    it('an empty inbox is data, not an error', () => {
      const store = makeStore();

      store.refresh();
      http.expectOne(NOTIFICATIONS).flush(emptyNotificationPage());

      expect(store.items()).toEqual([]);
      expect(store.error()).toBeNull();
    });

    it('a boundary-parse failure names the endpoint', () => {
      const store = makeStore();

      store.refresh();
      http.expectOne(NOTIFICATIONS).flush({ items: 'not an array' });

      expect(store.error()).toMatch(/GET \/members\/notifications/);
    });

    it('loading is true while the request is in flight', () => {
      const store = makeStore();

      store.refresh();
      expect(store.loading()).toBe(true);

      http.expectOne(NOTIFICATIONS).flush(emptyNotificationPage());
      expect(store.loading()).toBe(false);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* AD-14 — poll only                                                       */
  /* ---------------------------------------------------------------------- */

  describe('🔴 AD-14 — poll only, no live channel', () => {
    it('the store source names no websocket, SSE, push or Notification API', () => {
      // RK-1's scope boundary, asserted rather than merely stated.
      // `libs/api/licensing` HAS an `@Sse` endpoint; the temptation is real and
      // a live channel would be a SECOND delivery mechanism for one count.
      const { readFileSync } = require('node:fs') as typeof import('node:fs');
      const source = readFileSync(
        `${__dirname}/member-notifications.store.ts`,
        'utf8',
      );
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

      for (const forbidden of [
        'EventSource',
        'WebSocket',
        'ServiceWorker',
        'new Notification',
        'PushManager',
      ]) {
        expect(code).not.toContain(forbidden);
      }
    });

    it('the poll interval is exactly 60 s and is not derived', () => {
      expect(POLL_INTERVAL_MS).toBe(60_000);
    });
  });
});
