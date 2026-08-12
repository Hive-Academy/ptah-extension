import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import type {
  LiveFeedItem,
  MemberLiveResponse,
} from '@ptah-contracts/community';

import { YouTubePlayer } from '../learning/youtube-player';
import {
  BORDER_FILL_MISUSE,
  MUTED_TOO_FAINT,
  liveFeedItem,
  memberLiveResponse,
  replayItem,
} from './live-fixtures';
import { ReplaysPage } from './replays-page';

const LIVE = '/api/v1/members/live';

/** A replay page envelope with sensible echoes. */
const paged = (
  items: LiveFeedItem[],
  overrides: Partial<MemberLiveResponse['replays']> = {},
): MemberLiveResponse['replays'] => ({
  items,
  page: 1,
  pageSize: 25,
  total: items.length,
  hasMore: false,
  ...overrides,
});

describe('ReplaysPage', () => {
  let fixture: ComponentFixture<ReplaysPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReplaysPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReplaysPage);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Expects the pending request, asserts its page, and flushes `feed`. */
  const settle = (
    feed: Partial<MemberLiveResponse> = {},
    expectedPage = '1',
  ): void => {
    fixture.detectChanges();
    const request = http.expectOne(
      (candidate) =>
        candidate.url === LIVE && candidate.params.get('page') === expectedPage,
    );
    request.flush(memberLiveResponse(feed));
    fixture.detectChanges();
  };

  const text = (): string =>
    (fixture.nativeElement as HTMLElement).textContent ?? '';

  const players = (): number =>
    fixture.debugElement.queryAll(By.directive(YouTubePlayer)).length;

  const buttonWith = (label: string): HTMLButtonElement | undefined =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((button) => button.textContent?.includes(label));

  /* ---------------------------------------------------------------------- */
  /* The request                                                             */
  /* ---------------------------------------------------------------------- */

  describe('the request', () => {
    it('asks for page 1 and sends NO pageSize', () => {
      // The server echoes the effective page size, so this page holds no
      // second copy of `DEFAULT_PAGE_SIZE` to drift from it.
      fixture.detectChanges();
      const request = http.expectOne(
        (candidate) => candidate.url === LIVE && candidate.params.has('page'),
      );

      expect(request.request.params.get('page')).toBe('1');
      expect(request.request.params.has('pageSize')).toBe(false);

      request.flush(memberLiveResponse());
      fixture.detectChanges();
    });

    it('renders ONLY the replays list, never upcoming or live', () => {
      // The same response carries all three lists. Rendering the wrong one
      // here would put tomorrow's session in the archive.
      settle({
        upcoming: [liveFeedItem({ id: 'up' })],
        live: [liveFeedItem({ id: 'now', state: 'live' })],
        replays: paged([replayItem({ id: 'rep' })]),
      });

      const states = fixture.debugElement
        .queryAll(By.css('[data-session-state]'))
        .map((element) =>
          element.nativeElement.getAttribute('data-session-state'),
        );

      expect(states).toEqual(['replay']);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 NFR-S3 / ASSUMPTION-16 — the player is the existing one              */
  /* ---------------------------------------------------------------------- */

  describe('🔴 NFR-S3 — the facade, reused', () => {
    it('mounts NO player until a replay is activated', () => {
      settle({ replays: paged([replayItem(), replayItem({ id: 'r2' })]) });
      expect(players()).toBe(0);
    });

    it('🔴 ONE click plays — the embed is built by the SHARED player, not here', () => {
      settle({ replays: paged([replayItem()]) });

      buttonWith('Watch replay')?.click();
      fixture.detectChanges();

      expect(players()).toBe(1);

      // 🔴 THE IFRAME LIVES INSIDE `ptah-youtube-player`, AND THAT IS THE
      // ASSERTION. An earlier version asserted the page's HTML contained no
      // `youtube-nocookie` at all — which passed only because the player was
      // mounted showing its OWN poster, i.e. because playing a replay silently
      // took TWO clicks, the second on a control labelled "Play lesson". The
      // structural question is the right one: does the embed come out of the
      // one chokepoint component, or did this page build a second one?
      const frames = fixture.debugElement.queryAll(By.css('iframe'));
      expect(frames).toHaveLength(1);
      expect(
        (frames[0].nativeElement as HTMLElement).closest('ptah-youtube-player'),
      ).not.toBeNull();
    });

    it('the mounted player is told the member ALREADY activated', () => {
      settle({ replays: paged([replayItem()]) });
      buttonWith('Watch replay')?.click();
      fixture.detectChanges();

      const player = fixture.debugElement.query(By.directive(YouTubePlayer))
        .componentInstance as YouTubePlayer;

      expect(player.startActivated()).toBe(true);
    });

    it('passes the persisted video id and the title through', () => {
      settle({ replays: paged([replayItem()]) });
      buttonWith('Watch replay')?.click();
      fixture.detectChanges();

      const player = fixture.debugElement.query(By.directive(YouTubePlayer))
        .componentInstance as YouTubePlayer;

      expect(player.videoId()).toBe('dQw4w9WgXcQ');
      expect(player.title()).toBe(
        'Week 3 build session — authentication and tenancy',
      );
    });

    it('🔴 mounts ONE player at a time — activating a second tears the first down', () => {
      // Twenty-five mounted iframes is exactly what the facade design exists to
      // prevent, and it is the failure mode a per-row boolean produces.
      settle({
        replays: paged([replayItem({ id: 'r1' }), replayItem({ id: 'r2' })]),
      });

      const buttons = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ).filter((button) => button.textContent?.includes('Watch replay'));

      buttons[0].click();
      fixture.detectChanges();
      expect(players()).toBe(1);

      buttons[1].click();
      fixture.detectChanges();
      expect(players()).toBe(1);
    });

    it('tears the player down when the page changes', () => {
      settle({
        replays: paged([replayItem()], { total: 30, hasMore: true }),
      });

      buttonWith('Watch replay')?.click();
      fixture.detectChanges();
      expect(players()).toBe(1);

      buttonWith('Older')?.click();
      fixture.detectChanges();

      http
        .expectOne(
          (candidate) =>
            candidate.url === LIVE && candidate.params.get('page') === '2',
        )
        .flush(
          memberLiveResponse({
            replays: paged([replayItem({ id: 'r9' })], { page: 2 }),
          }),
        );
      fixture.detectChanges();

      expect(players()).toBe(0);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Paging                                                                  */
  /* ---------------------------------------------------------------------- */

  describe('paging', () => {
    it('disables Newer on the first page and Older when hasMore is false', () => {
      settle({ replays: paged([replayItem()]) });

      expect(buttonWith('Newer')?.disabled).toBe(true);
      expect(buttonWith('Older')?.disabled).toBe(true);
    });

    it('enables Older when the server says there is more', () => {
      settle({ replays: paged([replayItem()], { total: 60, hasMore: true }) });
      expect(buttonWith('Older')?.disabled).toBe(false);
    });

    it('requests the next page and echoes the server range', () => {
      settle({
        replays: paged([replayItem()], { total: 61, hasMore: true }),
      });
      expect(text()).toContain('1–1 of 61');

      buttonWith('Older')?.click();
      fixture.detectChanges();

      http
        .expectOne(
          (candidate) =>
            candidate.url === LIVE && candidate.params.get('page') === '2',
        )
        .flush(
          memberLiveResponse({
            replays: paged([replayItem({ id: 'r2' })], {
              page: 2,
              total: 61,
              hasMore: true,
            }),
          }),
        );
      fixture.detectChanges();

      expect(text()).toContain('26–26 of 61');
    });

    it('renders no pager at all for an empty archive', () => {
      // ⚠️ SCOPED TO THE NAV. The first version asserted `' of '` was absent
      // from the whole page and failed on the page's own header prose
      // ("Recordings of past sessions") — a needle that matched copy rather
      // than the control it was aiming at.
      settle({ replays: paged([]) });

      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          'nav[aria-label="Replay pages"]',
        ),
      ).toBeNull();
    });

    it('never requests a page below the first', () => {
      settle({ replays: paged([replayItem()]) });

      // The button is disabled; calling through anyway must still refuse.
      fixture.componentInstance.goTo(0);
      http.expectNone(LIVE);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Empty, degraded and failed                                              */
  /* ---------------------------------------------------------------------- */

  describe('empty, degraded and failed', () => {
    it('an empty archive is an empty STATE, not an error', () => {
      // Measured live 2026-08-09: `replays.total = 0` in this workspace,
      // because no LiveSession row exists. This is the live path.
      settle({ replays: paged([]) });

      expect(text()).toContain('No replays have been published yet.');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]'),
      ).toBeNull();
    });

    it('a degraded calendar is role="status" and says nothing has been removed', () => {
      settle({ replays: paged([replayItem()]), calendarAvailable: false });

      const note = (fixture.nativeElement as HTMLElement).querySelector(
        '[role="status"]',
      );
      expect(note).not.toBeNull();
      expect(text()).toContain('Nothing has been removed.');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]'),
      ).toBeNull();
    });

    it('🔴 the fourth cell — degraded AND empty shows BOTH, and still no error', () => {
      // The two tests above each vary ONE axis, so the cross-product cell that
      // matters most on `LivePage` (RISK-Z) had no coverage here at all.
      //
      // ⚠️ THE CORRECT RENDER IS BOTH MESSAGES, NOT ONE. Unlike `LivePage` —
      // where "No sessions scheduled yet" beside a degraded note would be a
      // LIE, because the missing calendar is exactly where the sessions would
      // have come from — a replay archive is built from `LiveSession` rows we
      // own. Google contributes no replays, so "no replays yet" stays TRUE
      // whether or not the calendar answered, and the note explains the
      // schedule may be incomplete without retracting it.
      //
      // Suppressing either message would be the regression: dropping the note
      // hides a real degradation, dropping the empty state leaves a blank page.
      settle({ replays: paged([]), calendarAvailable: false });

      expect(text()).toContain('No replays have been published yet.');
      expect(text()).toContain('Nothing has been removed.');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[role="status"]'),
      ).not.toBeNull();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]'),
      ).toBeNull();
    });

    it('a FAILED request is a retryable alert that clears the list', () => {
      fixture.detectChanges();
      http
        .expectOne((candidate) => candidate.url === LIVE)
        .flush(
          { message: 'boom' },
          { status: 500, statusText: 'Server Error' },
        );
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]'),
      ).not.toBeNull();
      expect(text()).toContain('We could not load the replay archive.');
      expect(
        fixture.debugElement.queryAll(By.css('[data-session-state]')).length,
      ).toBe(0);
      expect(text()).not.toContain('No replays have been published yet.');
    });

    it('a retry re-requests the SAME page, not page 1', () => {
      settle({ replays: paged([replayItem()], { total: 60, hasMore: true }) });

      buttonWith('Older')?.click();
      fixture.detectChanges();
      http
        .expectOne(
          (candidate) =>
            candidate.url === LIVE && candidate.params.get('page') === '2',
        )
        .flush(
          { message: 'boom' },
          { status: 500, statusText: 'Server Error' },
        );
      fixture.detectChanges();

      buttonWith('Try again')?.click();
      fixture.detectChanges();

      http
        .expectOne(
          (candidate) =>
            candidate.url === LIVE && candidate.params.get('page') === '2',
        )
        .flush(
          memberLiveResponse({ replays: paged([replayItem()], { page: 2 }) }),
        );
      fixture.detectChanges();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Tokens                                                                  */
  /* ---------------------------------------------------------------------- */

  it('🔴 uses base-300 only as a FILL, and no muted token below the AA floor', () => {
    settle({ replays: paged([replayItem()]), calendarAvailable: false });

    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).not.toContain(BORDER_FILL_MISUSE);
    expect(html).not.toContain(MUTED_TOO_FAINT);
  });
});
