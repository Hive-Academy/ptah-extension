import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { MAX_PAGE_SIZE } from '@ptah-contracts/community';

import {
  liveFeedItem,
  memberLiveResponse,
  replayItem,
} from '../live/live-fixtures';
import {
  MemberLiveApiService,
  feedItemKey,
  formatDuration,
} from './member-live-api.service';

const LIVE = '/api/v1/members/live';

describe('MemberLiveApiService', () => {
  let service: MemberLiveApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MemberLiveApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /* ---------------------------------------------------------------------- */
  /* The boundary parse is LIVE, not decorative                              */
  /* ---------------------------------------------------------------------- */

  describe('the schema parse at the HTTP boundary', () => {
    it('a well-formed response parses', async () => {
      const promise = firstValueFrom(service.read());
      http.expectOne(LIVE).flush(memberLiveResponse());

      await expect(promise).resolves.toEqual(memberLiveResponse());
    });

    it('a response MISSING calendarAvailable throws — the parse is live', async () => {
      // Without this case the schema could be `z.any()` and every other test
      // here would still pass. `calendarAvailable` is the specific field
      // chosen because R3.6's whole degraded-render branch keys off it: a
      // response that silently lost it would render as "no sessions".
      const wire: Record<string, unknown> = { ...memberLiveResponse() };
      delete wire['calendarAvailable'];

      const promise = firstValueFrom(service.read());
      http.expectOne(LIVE).flush(wire);

      await expect(promise).rejects.toThrow(/GET \/members\/live/);
      await expect(promise).rejects.toThrow(/calendarAvailable/);
    });

    it('an UNKNOWN extra field is stripped rather than rejected', async () => {
      // `z.object()` strips. That asymmetry is why a client schema may omit a
      // field the server sends and may NEVER declare one the server does not
      // (RISK-C) — and it is why B13 follows B12 rather than running beside it.
      const promise = firstValueFrom(service.read());
      http
        .expectOne(LIVE)
        .flush({
          ...memberLiveResponse(),
          somethingNew: 'from a later server',
        });

      const result = await promise;
      expect('somethingNew' in result).toBe(false);
    });

    it('rejects an item whose `source` is outside the two-value union', async () => {
      const promise = firstValueFrom(service.read());
      http.expectOne(LIVE).flush(
        memberLiveResponse({
          // A third source would silently become an unhandled render branch.
          upcoming: [{ ...liveFeedItem(), source: 'zoom' }],
        }),
      );

      await expect(promise).rejects.toThrow(/GET \/members\/live/);
    });

    it('rejects an item whose `state` is outside the three-value union', async () => {
      const promise = firstValueFrom(service.read());
      http
        .expectOne(LIVE)
        .flush(
          memberLiveResponse({
            upcoming: [{ ...liveFeedItem(), state: 'soon' }],
          }),
        );

      await expect(promise).rejects.toThrow(/GET \/members\/live/);
    });

    it('accepts the WORKSPACE-DEFAULT shape: null video id AND null duration', async () => {
      // Measured 2026-08-09: all fifty upcoming items carry both as null,
      // because YOUTUBE_API_KEY is empty (ASSUMPTION-6). A schema that made
      // either required would reject every real response this product serves.
      const promise = firstValueFrom(service.read());
      http.expectOne(LIVE).flush(
        memberLiveResponse({
          upcoming: [
            liveFeedItem({ youtubeVideoId: null, durationSeconds: null }),
          ],
        }),
      );

      const result = await promise;
      expect(result.upcoming[0].youtubeVideoId).toBeNull();
      expect(result.upcoming[0].durationSeconds).toBeNull();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The request itself                                                      */
  /* ---------------------------------------------------------------------- */

  describe('read', () => {
    it('issues a GET with NO query parameters when none are supplied', async () => {
      // ⚠️ The server ECHOES the effective page/pageSize it used, so a client
      // that sends nothing learns the defaults from the response rather than
      // hard-coding 1 and 25. Sending them anyway would be a different request
      // from the one the contract describes.
      const promise = firstValueFrom(service.read());
      const request = http.expectOne(LIVE);

      expect(request.request.method).toBe('GET');
      expect(request.request.params.keys()).toEqual([]);
      expect(request.request.urlWithParams).toBe(LIVE);

      request.flush(memberLiveResponse());
      await promise;
    });

    it('sends page and pageSize when supplied', async () => {
      const promise = firstValueFrom(service.read(3, 10));
      const request = http.expectOne(
        (candidate) => candidate.url === LIVE && candidate.params.has('page'),
      );

      expect(request.request.params.get('page')).toBe('3');
      expect(request.request.params.get('pageSize')).toBe('10');

      request.flush(memberLiveResponse());
      await promise;
    });

    it('sends page alone without inventing a pageSize', async () => {
      const promise = firstValueFrom(service.read(2));
      const request = http.expectOne(
        (candidate) => candidate.url === LIVE && candidate.params.has('page'),
      );

      expect(request.request.params.keys()).toEqual(['page']);

      request.flush(memberLiveResponse());
      await promise;
    });

    it('preserves SERVER ORDER and re-sorts nothing', async () => {
      // Deliberately not chronological: a client-side sort would "fix" this
      // and would then reorder only the rows this page happens to hold.
      const wire = memberLiveResponse({
        upcoming: [
          liveFeedItem({ id: 'c', startsAt: '2026-09-01T10:00:00.000Z' }),
          liveFeedItem({ id: 'a', startsAt: '2026-08-10T10:00:00.000Z' }),
          liveFeedItem({ id: 'b', startsAt: '2026-08-20T10:00:00.000Z' }),
        ],
      });

      const promise = firstValueFrom(service.read());
      http.expectOne(LIVE).flush(wire);

      const result = await promise;
      expect(result.upcoming.map((item) => item.id)).toEqual(['c', 'a', 'b']);
    });

    it('carries calendarAvailable: false through UNINTERPRETED', async () => {
      // The service must not translate the flag into an error, a throw, or an
      // empty list. R3.6 belongs to the page, and it can only own it if the
      // value arrives intact.
      const promise = firstValueFrom(service.read());
      http
        .expectOne(LIVE)
        .flush(memberLiveResponse({ calendarAvailable: false }));

      await expect(promise).resolves.toMatchObject({
        calendarAvailable: false,
      });
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The paging guard — refused BEFORE a request the server would 400        */
  /* ---------------------------------------------------------------------- */

  describe('the page guard', () => {
    it.each([0, -1, 1.5, Number.NaN])(
      'refuses page=%p without issuing a request',
      (page) => {
        expect(() => service.read(page)).toThrow(RangeError);
        http.expectNone(LIVE);
      },
    );

    it.each([0, -1, 2.5, MAX_PAGE_SIZE + 1, 500])(
      'refuses pageSize=%p without issuing a request',
      (pageSize) => {
        expect(() => service.read(1, pageSize)).toThrow(RangeError);
        http.expectNone(LIVE);
      },
    );

    it('accepts pageSize exactly at the cap', async () => {
      // The boundary is INCLUSIVE server-side (`@Max(MAX_PAGE_SIZE)`), so an
      // off-by-one here would refuse a page the API happily serves.
      const promise = firstValueFrom(service.read(1, MAX_PAGE_SIZE));
      http
        .expectOne(
          (candidate) => candidate.url === LIVE && candidate.params.has('page'),
        )
        .flush(memberLiveResponse());

      await promise;
    });

    it('names the cap and says the server does not clamp', () => {
      // The message is the documentation a caller actually reads. A silent
      // clamp would make a client that asked for 500 rows believe it got them.
      expect(() => service.read(1, 500)).toThrow(
        new RegExp(`1\\.\\.${MAX_PAGE_SIZE}`),
      );
      expect(() => service.read(1, 500)).toThrow(/rather than clamping/);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* feedItemKey — RISK-AA                                                   */
  /* ---------------------------------------------------------------------- */

  describe('feedItemKey', () => {
    it('🔴 gives DIFFERENT keys to two items sharing an id across sources', () => {
      // This is the whole of RISK-AA. `LiveFeedItem.id` is a LiveSession cuid
      // OR a Google event id, in one field — and a LiveSession may CLAIM a
      // calendar event id, so the collision is reachable rather than
      // theoretical. Tracking a concatenated list by `item.id` is an Angular
      // duplicate-key error at best and a silently wrong DOM re-use at worst.
      const shared = 'qhfl5bspa1s0m6tfld2viphv35';

      expect(
        feedItemKey(liveFeedItem({ id: shared, source: 'calendar' })),
      ).not.toBe(feedItemKey(liveFeedItem({ id: shared, source: 'ptah' })));
    });

    it('is stable for the same item', () => {
      const item = liveFeedItem();
      expect(feedItemKey(item)).toBe(feedItemKey({ ...item }));
    });

    it('puts the source first so no two distinct pairs can collide', () => {
      // `source` is drawn from a two-value union containing no colon, so the
      // encoding is unambiguous in the direction that matters.
      expect(feedItemKey(liveFeedItem({ id: 'x', source: 'ptah' }))).toBe(
        'ptah:x',
      );
      expect(feedItemKey(liveFeedItem({ id: 'a:b', source: 'calendar' }))).toBe(
        'calendar:a:b',
      );
    });

    it('produces one key per item across a 43-instance recurring expansion', () => {
      // The real shape: every expanded instance has its own suffixed id.
      const items = Array.from({ length: 43 }, (_unused, index) =>
        liveFeedItem({ id: `master_2026080${index}T140000Z` }),
      );
      expect(new Set(items.map(feedItemKey)).size).toBe(43);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* formatDuration — RISK-AD / RISK-O                                       */
  /* ---------------------------------------------------------------------- */

  describe('formatDuration', () => {
    it.each([
      [0, '0:00'],
      [9, '0:09'],
      [59, '0:59'],
      [60, '1:00'],
      [212, '3:32'],
      [1800, '30:00'],
      [3599, '59:59'],
      [3600, '1:00:00'],
      [5432, '1:30:32'],
      [36_000, '10:00:00'],
    ])('formats %p seconds as %p', (seconds, expected) => {
      expect(formatDuration(seconds)).toBe(expected);
    });

    it('floors a fractional value rather than rendering a decimal', () => {
      expect(formatDuration(90.9)).toBe('1:30');
    });

    it('clamps a negative value to zero rather than rendering a minus sign', () => {
      expect(formatDuration(-5)).toBe('0:00');
    });

    it('takes the DURATION off a replay item, and the fixture proves the unit', () => {
      // RISK-O's frontend shape: a POSITION and a DURATION are both
      // non-negative integers ending in `Seconds` and swap without a type
      // error. Nothing on these three surfaces holds a position at all.
      const replay = replayItem();
      expect(replay.durationSeconds).not.toBeNull();
      expect(formatDuration(replay.durationSeconds as number)).toBe('30:00');
    });
  });
});
