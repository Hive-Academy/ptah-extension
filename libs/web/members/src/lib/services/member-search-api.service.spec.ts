import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import type { MemberSearchResults } from '@ptah-contracts/community';
import { isMembershipRequiredError } from '@ptah-web/core';

import { MemberSearchApiService } from './member-search-api.service';

const SEARCH_URL = '/api/v1/members/search';

const emptyPage = {
  items: [],
  page: 1,
  pageSize: 25,
  total: 0,
  hasMore: false,
};

function results(
  overrides: Partial<MemberSearchResults> = {},
): MemberSearchResults {
  return {
    topics: { ...emptyPage },
    posts: { ...emptyPage },
    lessons: { ...emptyPage },
    ...overrides,
  };
}

describe('MemberSearchApiService', () => {
  let httpMock: HttpTestingController;
  let api: MemberSearchApiService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    api = TestBed.inject(MemberSearchApiService);
  });

  afterEach(() => httpMock.verify());

  it('GETs the search endpoint with q and returns the parsed groups', async () => {
    const pending = firstValueFrom(api.search({ q: 'signals' }));
    const request = httpMock.expectOne((r) => r.url === SEARCH_URL);

    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('q')).toBe('signals');
    request.flush(results());

    await expect(pending).resolves.toEqual(results());
  });

  it('comma-joins `kinds` rather than repeating the parameter', async () => {
    // The server DTO's `@Transform` splits a STRING on ','. Repeated
    // `?kinds=a&kinds=b` params arrive as an array that skips the transform.
    firstValueFrom(api.search({ q: 'signals', kinds: ['topics', 'posts'] }));
    const request = httpMock.expectOne((r) => r.url === SEARCH_URL);

    expect(request.request.params.get('kinds')).toBe('topics,posts');
    request.flush(results());
  });

  it('omits `kinds` entirely for an empty array (the server 400s on it)', async () => {
    // `@ArrayMinSize(1)` rejects an empty list, and "search nothing" is not
    // something a caller means — omitting searches all three.
    firstValueFrom(api.search({ q: 'signals', kinds: [] }));
    const request = httpMock.expectOne((r) => r.url === SEARCH_URL);

    expect(request.request.params.has('kinds')).toBe(false);
    request.flush(results());
  });

  it('sends `q` exactly as typed — no client-side length rejection', async () => {
    // The 2..200 cap is the server's and re-implementing it here would be a
    // second definition of a valid query. A one-character `q` therefore goes to
    // the wire and comes back a 400; the UI affordance is a disabled button,
    // not a thrown error.
    firstValueFrom(api.search({ q: 'x' })).catch(() => undefined);
    const request = httpMock.expectOne((r) => r.url === SEARCH_URL);

    expect(request.request.params.get('q')).toBe('x');
    request.flush(null, { status: 400, statusText: 'Bad Request' });
  });

  it('returns a well-formed EMPTY lessons page, not an absent key', async () => {
    // All three groups are always present. `lessons` is empty until Batch 9, so
    // a caller reads `results.lessons.total` unconditionally and Batch 9 is a
    // change in values, not in shape.
    const pending = firstValueFrom(
      api.search({ q: 'signals', kinds: ['lessons'] }),
    );
    httpMock.expectOne((r) => r.url === SEARCH_URL).flush(results());

    const parsed = await pending;
    expect(parsed.lessons).toEqual(emptyPage);
    expect(parsed.lessons.total).toBe(0);
  });

  it('parses an excerpt as PLAIN TEXT PLUS OFFSETS', async () => {
    const pending = firstValueFrom(api.search({ q: 'bug' }));
    httpMock
      .expectOne((r) => r.url === SEARCH_URL)
      .flush(
        results({
          posts: {
            items: [
              {
                id: 'post_1',
                postNumber: 3,
                topicId: 'top_1',
                topicSlug: 'welcome',
                topicTitle: 'Welcome',
                categoryName: 'Announcements',
                bodyExcerpt: {
                  text: 'the bug in the parser',
                  matches: [{ start: 4, length: 3 }],
                },
                authorName: 'Ada',
                createdAt: '2026-08-01T10:00:00.000Z',
              },
            ],
            page: 1,
            pageSize: 25,
            total: 1,
            hasMore: false,
          },
        }),
      );

    const parsed = await pending;
    const excerpt = parsed.posts.items[0].bodyExcerpt;
    expect(excerpt.text).toBe('the bug in the parser');
    expect(excerpt.matches).toEqual([{ start: 4, length: 3 }]);
    // The security property this whole design exists for: no markup anywhere.
    expect(excerpt.text).not.toContain('<');
  });

  it('THROWS on a response missing a required group', async () => {
    // Anti-decoration for the parse. Without it, `validate()` could be a no-op.
    const pending = firstValueFrom(api.search({ q: 'signals' }));
    httpMock
      .expectOne((r) => r.url === SEARCH_URL)
      .flush({ topics: { ...emptyPage }, posts: { ...emptyPage } });

    await expect(pending).rejects.toThrow(/GET \/members\/search/);
  });

  it('THROWS on an excerpt missing its offsets', async () => {
    const pending = firstValueFrom(api.search({ q: 'signals' }));
    httpMock
      .expectOne((r) => r.url === SEARCH_URL)
      .flush(
        results({
          topics: {
            items: [
              {
                id: 'top_1',
                slug: 'welcome',
                titleExcerpt: { text: 'Welcome' },
                categoryName: 'Announcements',
                authorName: 'Ada',
                replyCount: 0,
                lastPostedAt: '2026-08-01T10:00:00.000Z',
              },
            ],
            page: 1,
            pageSize: 25,
            total: 1,
            hasMore: false,
          },
        }),
      );

    await expect(pending).rejects.toThrow(/GET \/members\/search/);
  });

  it('REFUSES to express a pageSize above the NFR-P5 cap', () => {
    expect(() => api.search({ q: 'signals', pageSize: 51 })).toThrow(
      RangeError,
    );
    expect(() => api.search({ q: 'signals', page: 0 })).toThrow(RangeError);
  });

  it('a 403 membership gate is recognised by the SHARED helper', async () => {
    const pending = firstValueFrom(api.search({ q: 'signals' })).catch(
      (error: unknown) => error,
    );
    httpMock
      .expectOne((r) => r.url === SEARCH_URL)
      .flush(
        { reason: 'membership_required' },
        { status: 403, statusText: 'Forbidden' },
      );

    expect(isMembershipRequiredError(await pending)).toBe(true);
  });
});
