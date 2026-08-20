import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { MemberHubResponse } from '@ptah-contracts/community';

import { HubPage } from '../hub/hub-page';
import { MemberHubApiService } from './member-hub-api.service';

const HUB_URL = '/api/v1/members/hub';

/**
 * The Phase-1 hub envelope: `sessions` populated from Google Calendar, the
 * other four sections declared and reporting `'empty'` (member-hub.contract.ts
 * — "all five sections are declared now, even though four of them report
 * 'empty' until their phase lands").
 */
function hubResponse(
  overrides: Partial<MemberHubResponse['sections']> = {},
): MemberHubResponse {
  return {
    member: {
      firstName: 'Ada',
      cohorts: [{ key: 'builders', name: 'Builders Lounge' }],
    },
    sections: {
      learning: { status: 'empty', data: null },
      community: { status: 'empty', data: [] },
      sessions: {
        status: 'ok',
        data: {
          id: 'evt_1',
          kind: 'calendar',
          title: 'Ptah Builders — Weekly Live Session',
          startsAt: '2026-08-05T17:00:00.000Z',
          endsAt: '2026-08-05T19:00:00.000Z',
          meetLink: 'https://meet.google.com/abc-defg-hij',
          youtubeVideoId: null,
        },
      },
      packs: { status: 'empty', data: [] },
      notifications: { status: 'empty', data: { unreadCount: 0 } },
      ...overrides,
    },
  };
}

describe('MemberHubApiService', () => {
  let httpMock: HttpTestingController;
  let api: MemberHubApiService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    api = TestBed.inject(MemberHubApiService);
  });

  afterEach(() => httpMock.verify());

  it('GETs the aggregate endpoint and returns the parsed envelope', async () => {
    const pending = firstValueFrom(api.getHub());
    const request = httpMock.expectOne(HUB_URL);

    expect(request.request.method).toBe('GET');
    request.flush(hubResponse());

    await expect(pending).resolves.toEqual(hubResponse());
  });

  it('rejects a malformed envelope at the boundary rather than passing it on', async () => {
    // `validate()` throws a single located error. Without this, a server-side
    // envelope change reaches a template as `undefined` and fails somewhere
    // that says nothing about the real cause.
    const pending = firstValueFrom(api.getHub());
    httpMock.expectOne(HUB_URL).flush({ member: { firstName: 'Ada' } });

    await expect(pending).rejects.toThrow(/GET \/members\/hub/);
  });

  it('installs no cache: a second call re-fetches (freshness is the point)', () => {
    firstValueFrom(api.getHub());
    httpMock.expectOne(HUB_URL).flush(hubResponse());

    firstValueFrom(api.getHub());
    httpMock.expectOne(HUB_URL).flush(hubResponse());
    // `expectOne` twice, each satisfied, is the assertion: a `shareReplay`
    // would have made the second subscribe issue no request at all and would
    // have handed the member a stale "next session".
  });
});

/**
 * R6.2 — THE REQUEST-COUNT ASSERTION.
 *
 * This is the test the aggregate endpoint exists for. `GET /members/hub`
 * composes five sections server-side specifically so the first screen a paying
 * member sees costs ONE round trip instead of five. That property is invisible
 * in code review — it degrades when some future section card quietly injects
 * its own service — so it is asserted on the count of requests the whole page
 * issues, not on the hub service in isolation.
 *
 * ⚠️ `match(() => true)` IS DELIBERATE. Asserting `expectOne(HUB_URL)` would
 * only prove the hub call happened; it would say nothing about a SECOND,
 * different call a child made. The assertion has to be over every request the
 * page made, whatever its URL.
 */
describe('HubPage — exactly one data request on initial render (R6.2)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      // `provideRouter([])` is required, not incidental: the stat tiles and the
      // section cards link into the member tree with `routerLink`, so the page
      // does not instantiate without it. An empty route table is enough — this
      // spec never navigates.
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('issues one request, and it is the hub aggregate', () => {
    const fixture = TestBed.createComponent(HubPage);
    fixture.detectChanges();

    const all = httpMock.match(() => true);
    expect(all).toHaveLength(1);
    expect(all[0].request.url).toBe(HUB_URL);

    all[0].flush(hubResponse());
    fixture.detectChanges();

    // Still one after the response renders every section — no child fetched.
    expect(httpMock.match(() => true)).toHaveLength(0);
  });

  it('renders the member greeting and cohort from that one response', () => {
    const fixture = TestBed.createComponent(HubPage);
    fixture.detectChanges();
    httpMock.expectOne(HUB_URL).flush(hubResponse());
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Welcome back, Ada');
    expect(text).toContain('Builders Lounge');
  });

  it('a degraded section degrades ONE card, not the page (R6.4, NFR-R3)', () => {
    const fixture = TestBed.createComponent(HubPage);
    fixture.detectChanges();
    httpMock.expectOne(HUB_URL).flush(
      hubResponse({
        sessions: { status: 'unavailable', data: null },
        community: { status: 'unavailable', data: [] },
      }),
    );
    fixture.detectChanges();

    // The page still rendered its header — an unavailable dependency must never
    // turn into the whole-page error state, which says "we could not load your
    // hub" and is reserved for the hub REQUEST failing.
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Welcome back, Ada');
    expect(text).not.toContain("We couldn't load your hub");
  });

  it('a failed hub request shows the page error state, not five empty cards', () => {
    const fixture = TestBed.createComponent(HubPage);
    fixture.detectChanges();
    httpMock
      .expectOne(HUB_URL)
      .flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    // Five empty cards would read as "you have nothing" to someone who is
    // paying. Saying the load failed is the honest message.
    expect(fixture.nativeElement.textContent).toContain(
      "We couldn't load your hub",
    );
  });
});
