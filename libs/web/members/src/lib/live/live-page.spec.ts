import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import type { MemberLiveResponse } from '@ptah-contracts/community';

import { LivePage } from './live-page';
import {
  BORDER_FILL_MISUSE,
  MUTED_TOO_FAINT,
  liveFeedItem,
  liveNowItem,
  memberLiveResponse,
  recurringExpansion,
} from './live-fixtures';

const LIVE = '/api/v1/members/live';

describe('LivePage', () => {
  let fixture: ComponentFixture<LivePage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LivePage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LivePage);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Renders the page against `feed`, resolving the constructor's request. */
  const settle = (feed: Partial<MemberLiveResponse> = {}): void => {
    fixture.detectChanges();
    http.expectOne(LIVE).flush(memberLiveResponse(feed));
    fixture.detectChanges();
  };

  const text = (): string =>
    (fixture.nativeElement as HTMLElement).textContent ?? '';

  const cards = (): number =>
    fixture.debugElement.queryAll(By.css('[data-session-state]')).length;

  const roleOf = (role: string): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector(`[role="${role}"]`);

  /* ---------------------------------------------------------------------- */
  /* 🔴 RISK-Z — the four cells                                              */
  /* ---------------------------------------------------------------------- */

  describe('🔴 RISK-Z — calendarAvailable is checked BEFORE emptiness', () => {
    it('CELL 1 — unavailable + empty: says the calendar could not be read, NOT "no sessions"', () => {
      // This is the cell the whole task exists for. "No sessions scheduled
      // yet" here is a lie told to a paying member whose calendar we simply
      // could not read.
      settle({ upcoming: [], live: [], calendarAvailable: false });

      expect(text()).toContain(
        'We could not read the session calendar just now.',
      );
      expect(text()).not.toContain('No sessions scheduled yet.');
    });

    it('CELL 2 — unavailable + items: renders the list AND says it may be incomplete', () => {
      settle({
        upcoming: [liveFeedItem()],
        calendarAvailable: false,
      });

      expect(cards()).toBe(1);
      expect(text()).toContain('This schedule may be incomplete.');
      expect(text()).not.toContain('could not read the session calendar');
    });

    it('CELL 3 — available + empty: the ordinary empty state', () => {
      settle({ upcoming: [], live: [], calendarAvailable: true });

      expect(text()).toContain('No sessions scheduled yet.');
      expect(text()).not.toContain('could not read the session calendar');
      expect(text()).not.toContain('may be incomplete');
    });

    it('CELL 4 — available + items: the list and nothing else', () => {
      settle({ upcoming: [liveFeedItem()], calendarAvailable: true });

      expect(cards()).toBe(1);
      expect(text()).not.toContain('may be incomplete');
      expect(text()).not.toContain('No sessions scheduled yet.');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 R3.6 — the degraded note is NOT an error                             */
  /* ---------------------------------------------------------------------- */

  describe('🔴 R3.6 — no error is shown to the member', () => {
    it('the degraded note is role="status", never role="alert"', () => {
      settle({ upcoming: [], live: [], calendarAvailable: false });

      expect(roleOf('status')).not.toBeNull();
      expect(roleOf('alert')).toBeNull();
    });

    it('offers no retry button — there is nothing the member can retry', () => {
      settle({ upcoming: [], live: [], calendarAvailable: false });
      expect(text()).not.toContain('Try again');
    });

    it('uses none of the error vocabulary', () => {
      settle({ upcoming: [], live: [], calendarAvailable: false });

      for (const word of [
        'error',
        'failed',
        'something went wrong',
        'unavailable',
        'forbidden',
      ]) {
        expect(text().toLowerCase()).not.toContain(word);
      }
    });

    it('carries no error colour class', () => {
      settle({ upcoming: [], live: [], calendarAvailable: false });
      const note = roleOf('status');

      expect(note?.className).not.toContain('error');
      expect(note?.className).not.toContain('warning');
    });

    it('reassures rather than alarming', () => {
      settle({ upcoming: [], live: [], calendarAvailable: false });
      expect(text()).toContain('Nothing has been cancelled.');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* A FAILED REQUEST is a different thing entirely (R6.4)                   */
  /* ---------------------------------------------------------------------- */

  describe('R6.4 — a failed request IS an error, and is retryable', () => {
    const fail = (): void => {
      fixture.detectChanges();
      http
        .expectOne(LIVE)
        .flush(
          { message: 'boom' },
          { status: 500, statusText: 'Server Error' },
        );
      fixture.detectChanges();
    };

    it('renders a retryable alert, not an empty state', () => {
      fail();

      expect(roleOf('alert')).not.toBeNull();
      expect(text()).toContain('We could not load the session schedule.');
      expect(text()).not.toContain('No sessions scheduled yet.');
    });

    it('does NOT render the degraded-calendar note under the error', () => {
      // A request that failed outright told us nothing about the calendar.
      fail();
      expect(text()).not.toContain('could not read the session calendar');
    });

    it('CLEARS previous rows so a failed retry leaves nothing stale', () => {
      settle({ upcoming: [liveFeedItem()] });
      expect(cards()).toBe(1);

      (fixture.nativeElement as HTMLElement)
        .querySelectorAll('button')
        .forEach((button) => {
          if (button.textContent?.includes('Try again')) button.click();
        });

      // No button yet — the first load succeeded. Trigger a reload directly.
      fixture.componentInstance['reload']();
      fixture.detectChanges();
      http
        .expectOne(LIVE)
        .flush(
          { message: 'boom' },
          { status: 500, statusText: 'Server Error' },
        );
      fixture.detectChanges();

      expect(cards()).toBe(0);
      expect(roleOf('alert')).not.toBeNull();
    });

    it('the retry button issues a second request and recovers', () => {
      fail();

      const retry = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ).find((button) => button.textContent?.includes('Try again'));
      retry?.click();
      fixture.detectChanges();

      http
        .expectOne(LIVE)
        .flush(memberLiveResponse({ upcoming: [liveFeedItem()] }));
      fixture.detectChanges();

      expect(roleOf('alert')).toBeNull();
      expect(cards()).toBe(1);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 RISK-AB — the 44-identical-rows problem                              */
  /* ---------------------------------------------------------------------- */

  describe('🔴 RISK-AB — a populated feed', () => {
    it('groups a 43-instance recurring expansion into one heading per day', () => {
      settle({ upcoming: recurringExpansion(43) });

      const headings = fixture.debugElement.queryAll(By.css('h2 time'));
      // 25 revealed, one per day, and the fixture puts each on its own day.
      expect(headings.length).toBe(25);
      expect(cards()).toBe(25);
    });

    it('reveals 25 at a time and states the remaining count exactly', () => {
      settle({ upcoming: recurringExpansion(43) });

      expect(text()).toContain('Show 18 more');

      const more = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ).find((button) => button.textContent?.includes('Show'));
      more?.click();
      fixture.detectChanges();

      expect(cards()).toBe(43);
      expect(text()).not.toContain('Show');
    });

    it('renders NO reveal button when everything already fits', () => {
      settle({ upcoming: recurringExpansion(3) });
      expect(text()).not.toContain('Show');
    });

    it('issues exactly ONE request for the whole list — the reveal is client-side', () => {
      // `upcoming` is a bare array by contract; a page parameter would reach
      // `replays` and be a 400 for anything else.
      settle({ upcoming: recurringExpansion(43) });

      const more = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ).find((button) => button.textContent?.includes('Show'));
      more?.click();
      fixture.detectChanges();

      http.expectNone(LIVE);
    });

    it('groups two sessions on the SAME day under one heading', () => {
      settle({
        upcoming: [
          liveFeedItem({ id: 'a', startsAt: '2026-08-09T14:00:00.000Z' }),
          liveFeedItem({ id: 'b', startsAt: '2026-08-09T18:00:00.000Z' }),
          liveFeedItem({ id: 'c', startsAt: '2026-08-10T14:00:00.000Z' }),
        ],
      });

      expect(fixture.debugElement.queryAll(By.css('h2 time')).length).toBe(2);
      expect(cards()).toBe(3);
    });

    it('groups by the SERVER STRING, not a local Date — a 23:00 UTC session stays on its UTC day', () => {
      // A local reparse would move this to the 10th for any reader east of
      // London, so the same feed would break into different days per member.
      settle({
        upcoming: [
          liveFeedItem({ id: 'a', startsAt: '2026-08-09T23:30:00.000Z' }),
          liveFeedItem({ id: 'b', startsAt: '2026-08-09T00:30:00.000Z' }),
        ],
      });

      const headings = fixture.debugElement.queryAll(By.css('h2 time'));
      expect(headings.length).toBe(1);
      expect(headings[0].nativeElement.getAttribute('datetime')).toBe(
        '2026-08-09',
      );
    });

    it('preserves SERVER ORDER within a day and across days', () => {
      settle({
        upcoming: [
          liveFeedItem({ id: 'later', startsAt: '2026-09-01T10:00:00.000Z' }),
          liveFeedItem({ id: 'earlier', startsAt: '2026-08-10T10:00:00.000Z' }),
        ],
      });

      const keys = fixture.debugElement
        .queryAll(By.css('[data-session-key]'))
        .map((element) =>
          element.nativeElement.getAttribute('data-session-key'),
        );

      expect(keys).toEqual(['calendar:later', 'calendar:earlier']);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 RISK-AA — the tracking key                                           */
  /* ---------------------------------------------------------------------- */

  describe('🔴 RISK-AA — two sources may share one id', () => {
    it('renders BOTH items when a ptah and a calendar item share an id', () => {
      // Tracked by `item.id` this is an Angular duplicate-key error; tracked by
      // `source:id` both rows render.
      const shared = 'qhfl5bspa1s0m6tfld2viphv35';
      settle({
        live: [liveNowItem({ id: shared, source: 'ptah' })],
        upcoming: [liveFeedItem({ id: shared, source: 'calendar' })],
      });

      expect(cards()).toBe(2);

      const keys = fixture.debugElement
        .queryAll(By.css('[data-session-key]'))
        .map((element) =>
          element.nativeElement.getAttribute('data-session-key'),
        );

      expect(new Set(keys).size).toBe(2);
    });

    it('🔴 renders both when the collision is INSIDE ONE @for — same list, same day', () => {
      // 🔴 THE TEST ABOVE CANNOT FAIL AND THIS ONE CAN, WHICH IS WHY BOTH EXIST.
      // `live` and `upcoming` render through two SEPARATE `@for` blocks, and
      // Angular scopes `track` per block — so a colliding pair split across
      // them holds one item per block and never collides at all. That version
      // passes identically with `track item.id`.
      //
      // A duplicate key is only observable within a SINGLE `@for` over a list
      // holding both items. `upcoming` is grouped by calendar day, so putting
      // both on the SAME day puts them in the same inner `@for` — which is the
      // shape a claimed recurring master actually produces, since a
      // `LiveSession` may claim a Google event id and the two then share the
      // `id` field for the same slot in the schedule.
      const shared = 'qhfl5bspa1s0m6tfld2viphv35';
      settle({
        upcoming: [
          liveFeedItem({
            id: shared,
            source: 'calendar',
            title: 'The calendar copy',
            startsAt: '2026-08-09T14:00:00.000Z',
          }),
          liveFeedItem({
            id: shared,
            source: 'ptah',
            title: 'The claimant',
            startsAt: '2026-08-09T16:00:00.000Z',
          }),
        ],
      });

      // One day heading, two cards under it — i.e. one `@for`, two items.
      expect(cards()).toBe(2);
      expect(text()).toContain('The calendar copy');
      expect(text()).toContain('The claimant');

      const keys = fixture.debugElement
        .queryAll(By.css('[data-session-key]'))
        .map((element) =>
          element.nativeElement.getAttribute('data-session-key'),
        );

      expect(keys).toEqual([
        'calendar:qhfl5bspa1s0m6tfld2viphv35',
        'ptah:qhfl5bspa1s0m6tfld2viphv35',
      ]);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The live-now section                                                    */
  /* ---------------------------------------------------------------------- */

  describe('the live-now section (R3.5)', () => {
    it('renders "Happening now" above the schedule when something is live', () => {
      settle({ live: [liveNowItem()], upcoming: [liveFeedItem()] });

      expect(text()).toContain('Happening now');
      expect(cards()).toBe(2);
    });

    it('renders no "Happening now" heading when nothing is live', () => {
      settle({ live: [], upcoming: [liveFeedItem()] });
      expect(text()).not.toContain('Happening now');
    });

    it('a live session with NO upcoming ones is not an empty state', () => {
      // The empty state must not fire just because the future is clear.
      settle({ live: [liveNowItem()], upcoming: [] });

      expect(cards()).toBe(1);
      expect(text()).not.toContain('No sessions scheduled yet.');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Loading, tokens, and what this page does NOT do                         */
  /* ---------------------------------------------------------------------- */

  describe('the rest', () => {
    it('renders a busy skeleton before the response arrives', () => {
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[aria-busy]'),
      ).not.toBeNull();
      expect(text()).toContain('Loading the session schedule');

      http.expectOne(LIVE).flush(memberLiveResponse());
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[aria-busy]'),
      ).toBeNull();
    });

    it('does NOT render replays — they have their own route', () => {
      settle({
        replays: {
          items: [liveFeedItem({ id: 'r1', state: 'replay' })],
          page: 1,
          pageSize: 25,
          total: 1,
          hasMore: false,
        },
      });

      expect(
        fixture.debugElement.queryAll(By.css('[data-session-state="replay"]'))
          .length,
      ).toBe(0);
    });

    it('sends NO query parameters — page params reach `replays` only', () => {
      fixture.detectChanges();
      const request = http.expectOne(LIVE);

      expect(request.request.params.keys()).toEqual([]);

      request.flush(memberLiveResponse());
      fixture.detectChanges();
    });

    it('🔴 uses base-300 only as a FILL, and no muted token below the AA floor', () => {
      settle({
        upcoming: [liveFeedItem()],
        live: [liveNowItem()],
        calendarAvailable: false,
      });

      const html = (fixture.nativeElement as HTMLElement).innerHTML;
      expect(html).not.toContain(BORDER_FILL_MISUSE);
      expect(html).not.toContain(MUTED_TOO_FAINT);
    });
  });
});
